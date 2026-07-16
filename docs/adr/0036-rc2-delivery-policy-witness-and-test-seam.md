# ADR 0036: delivery policyのproduction／test seamと3-TODO witnessを分離する

- Status: Accepted
- Date: 2026-07-16
- Scope: RC2-E以降の3-TODO input、fixture front-end、registry-shard transform
- Related: [ADR 0032](0032-rc2-bounded-graph-compiler-and-three-way-seam.md)、
  [ADR 0034](0034-rc2-provenance-bundle-and-v2-artifact-validation.md)、
  [ADR 0035](0035-rc2-transfer-front-end-and-delivery-policy-fixture-contract.md)

## Context

ADR 0035でmonolithic `resolveDeliveryPolicy`と6-case fixed oracleをtransform前に固定した。次に3 TODOを置くだけでは、
productionを3 shardへ分けても`test/rc2-delivery-policy-fixture.test.mjs`が全channelのexact期待値を持つため、future TODOが同じ
testを編集する。shared testをcandidateから黙って除外すれば、Codegraph上の実編集境界をmanual witnessで隠す偽の0 conflictになる。

一方、fixed black-box oracle自身をtransformしてexpected outputも分割すると、sourceと期待値を同時変更して挙動変化を自己承認できる。
oracleはseam transactionの外に固定し、post-transform planの通常test ownershipとは分ける必要がある。

またcurrent snapshotでは、future behavior TODOをseamなしで実行すると、production entry、monolithic source、shared exact testに加え、
shared testから呼ぶfixed oracleの期待値も変更対象になる。したがって4 shared resourcesを3 TODOが所有する。unordered TODO pairは3だが、
resource単位のconflict recordは`4 resources × C(3, 2) = 12`である。この二つをともに「conflict 3」と呼ぶと実験metricが
非識別になる。

## Decision

### 1. plan inputは3つのfuture behavior TODOを持つ

RC2はseam変換後に実行可能になる次のTODOをcompile対象にする。RC2 campaign自身はこれらの挙動変更を実行せず、
behavior-preserving seamとnew plan versionまでを扱う。

| TODO ID | outcome |
|---|---|
| `email-policy` | email routine retry limitを3から4へ変更する |
| `sms-policy` | sms routine delayを30秒から20秒へ変更する |
| `push-policy` | push urgent retry limitを3から4へ変更する |

plan inputは`lattice.plan_input.v1`を加算利用し、writer capacityを3にする。candidateは
`lattice.rc2.boundary_candidate_spec.v1`、candidate IDは`shard-delivery-policy-registry-by-channel`とする。
proposed ownershipはmanual design witnessであり、要求からの自動発見またはCodegraph由来semantic ownershipと呼ばない。

RC2 inputは`research/campaigns/rc2/inputs/`へ次を固定する。

- `plan-input.json`
- `candidate-spec-v1.json`
- `query-set-v2.json`
- `manual-evidence.normal.json`
- `manual-evidence.partial-state-negative.json`
- `manual-evidence.third-only-unknown.json`

candidate specは各TODOへ次のoracle case IDをexact partitionとして割り当てる。

| TODO | case IDs |
|---|---|
| `email-policy` | `email-routine`, `email-urgent` |
| `sms-policy` | `sms-routine`, `sms-urgent` |
| `push-policy` | `push-routine`, `push-urgent` |

期待outputの唯一の正本はADR 0035で固定済みの`src/rc2-delivery-policy-oracle.mjs`とする。期待値を複製する
`behavior-oracle-v1.json`は作らない。candidate specのfixed oracle entryはpathとsource content digestだけを持ち、case ID集合はoracle receiptの
case ID集合とexact一致させる。

### 2. current／proposed ownershipをexact surfaceで固定する

currentでは全TODOが次の4 resourcesを所有する。

- symbol `resolveDeliveryPolicy`
- path `research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs`
- path `test/rc2-delivery-policy-fixture.test.mjs`
- path `src/rc2-delivery-policy-oracle.mjs`

proposedではTODOごとに次の4 resourcesを所有する。

| TODO | production symbol／path | test symbol／path |
|---|---|---|
| email | `resolveEmailPolicy`／`research/fixtures/delivery-policy-registry/src/email-policy.mjs` | `emailPolicyContract`／`test/rc2-delivery-policy-email.test.mjs` |
| sms | `resolveSmsPolicy`／`research/fixtures/delivery-policy-registry/src/sms-policy.mjs` | `smsPolicyContract`／`test/rc2-delivery-policy-sms.test.mjs` |
| push | `resolvePushPolicy`／`research/fixtures/delivery-policy-registry/src/push-policy.mjs` | `pushPolicyContract`／`test/rc2-delivery-policy-push.test.mjs` |

`resolveDeliveryPolicy`はpost-transform composition entry、既存shared testの`deliveryPolicyCompositionContract`はshape／routing／
fail-loud invariantだけを持つstable surfaceにする。fixed oracle sourceもseam transaction gateとして同じbytesを保持するstable surfaceにする。
これらはseam transformが一度作るpredecessorで、future channel TODOのwrite ownershipへ入れない。proposed productionのactivationには、
各resolverがexact pathに存在するだけでなく、composition entryからのexact caller linkを要求する。

### 3. shared testもbehavior-preserving seamで分割する

transformは既存shared testからchannel別exact値とoracle呼出しを除き、composition invariantとinput error contractだけを残す。
6 exact current valuesは3 dedicated testへchannel単位で移す。future TODOは自分のproduction shardとdedicated testだけを変更できる。

proposed activationは各`*PolicyContract` symbol／pathの存在だけでは成立しない。Codegraphで各contractから対応channel resolverへのexact
callee linkと、composition entryから各resolverへのexact callee linkを要求する。transform acceptanceではoracle receiptの6 case ID集合と
candidateの3分割がexact partitionであることを検査し、6つのsingle-case behavior mutationを一件ずつ隔離worktreeへ一時適用する。各mutationで
owner dedicated testだけが失敗し、他2 dedicated testsとshared composition contractが成功しなければrejectする。mutation後はaccepted
post-transform bytesへ復元し、diff leakが0であることを再確認する。これにより空／常時passのdedicated testで作る偽の0 conflictを拒否する。

`src/rc2-delivery-policy-oracle.mjs`はtransform allowed pathに含めない。adapterはtransform前後にこのfixed oracleを直接実行する。
oracle receiptはaccepted seamのbehavior envelopeであり、future behavior TODOのpost-change acceptance testではない。shared testからoracle呼出しを
外すのは、future TODOが意図的挙動変更を行う時にpre-seam期待値を通常test dependencyとして残さないためである。

### 4. metricはresource recordとdistinct pairを分ける

| condition | resources | conflict records | distinct pairs | minimum waves |
|---|---:|---:|---:|---:|
| current control | 4 shared | 12 | 3（K3） | 3 |
| proposed treatment | 12 disjoint | 0 | 0 | 1 |
| proposed partial-state negative | 13 | 1 state | 1 | 2 |
| proposed capacity 2 | 12 disjoint | 0 | 0 | 2 |

partial-state negativeは`email-policy`と`sms-policy`だけがstate `delivery-policy-registry`へwriteし、`push-policy`を片方のwaveへ
co-scheduleする。third-only unknownは`push-policy`だけのmanual dynamic unknownとし、planなしのtyped unknownを要求する。

### 5. fixture front-endはbundleだけを作る

`src/rc2-delivery-policy-front-end.mjs`は次のexact APIだけを公開する。

```js
compileDeliveryPolicyBoundaryBundleV2({
  planInput,
  candidateSpec,
  manualEvidence,
  querySet,
  sourceSnapshot,
  codegraphEvidence,
})
```

front-endはinput／TODO集合／query参照をcross-bindし、exact Codegraph resultとmanual evidenceを
`compileBoundaryObservationV2`へ渡して`normalized_boundary_bundle.v2`だけを返す。plan、verdict、expected conflict数、expected waves、
condition selectorを返さず、callerが同じ`compileSchedulabilityGraphV2`へbundle graphを渡す。

`sourceSnapshot`はcandidateが列挙するcurrent／proposed／stable pathのpresent／absentとpresent fileのcontent digestを持つcanonical preimageで、
front-endはそのdigestをbundleの`source.snapshot_digest`へ渡す。fixed oracle entryは両modeでpresentかつcandidateのcontent digestと一致しなければ
ならない。candidate witness digest、source snapshot object／digest、Codegraph evidence digestは別々に保存し、digestだけの自己申告を受理しない。

control modeはfixed oracleを含む全current surface readyかつ全proposed surface absent、treatment modeは全proposed surface、composition／
dedicated-test callee link、fixed oracleのexact stable pathがreadyの時だけ選ぶ。oracle sourceのbyte identityはCodegraphへ推定させず、
candidate digest、control／treatment source snapshot、transformのallowed-path検査、pre／post receipt identityで別に証明する。partial transform、
fuzzy path mismatch、empty／failureをcurrentへfallbackせずtyped unknownまたはfail-loudにする。
resourceのCodegraph provenance digestはmode判定に使ったquery／impact／link outcomeを結合し、candidate provenance digestとは分離する。

### 6. transformのallowed pathsを8件に固定する

accepted registry-shard transformが変更できるのは次だけである。

1. `research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs`
2. `research/fixtures/delivery-policy-registry/src/email-policy.mjs`
3. `research/fixtures/delivery-policy-registry/src/sms-policy.mjs`
4. `research/fixtures/delivery-policy-registry/src/push-policy.mjs`
5. `test/rc2-delivery-policy-fixture.test.mjs`
6. `test/rc2-delivery-policy-email.test.mjs`
7. `test/rc2-delivery-policy-sms.test.mjs`
8. `test/rc2-delivery-policy-push.test.mjs`

adapterはcompiled conflict、expected waves、proposed ownershipを供給しない。incomplete shard、scope外write、fixed oracle failure、focused test failure、
case partition／mutation sensitivity failure、cleanup failureはrejected transformにし、treatment plan versionを発行しない。

### 7. oracle identityをartifact-onlyで再計算可能にする

transform／campaign artifactは、fixed oracleのpath、candidateに固定したsource digest、control／treatment snapshot内のsource digest、pre／post receiptの
ordered `{ id, output_digest }`から作るcase-set digestを別々に保存する。さらにoracle source bytesを実行しないsnapshotとしてartifact setへ保存する。
artifact-only verifierは保存bytesをhashし、candidate＝保存source＝control snapshot＝treatment snapshotのsource digestと、pre＝postのcase-set digestを
再計算する。Codegraph `ready`、allowed-path宣言、receiptの`outcome: passed`だけをbyte identityの代用にしない。

## Rejected alternatives

- productionだけをshardしshared exact testをstable扱いする: future TODOの実編集点を隠す。
- fixed oracleのexpected tableもtransformする: sourceと期待値の同時変更でbehavior preservationが自己成就する。
- oracle期待値をJSONへ複製する: 実行runnerとdescriptorが二重の正本になり、共有resource数も4か5か識別不能になる。
- oracleをfuture TODOの共通testとして残す: 3 TODOを再び一つの更新点へ結合する。
- Codegraph上のdedicated test symbol／path存在だけでtest seamをacceptする: 空または常時passのtestでも偽の0 conflictを作れる。
- Codegraph `ready`だけでoracle source不変を主張する: path存在はcontrol／treatmentのbyte identityを証明しない。
- 12 resource recordsを3 conflictsと記録する: record数とpair topologyを混同する。
- front-endにcondition名またはexpected wavesを渡す: treatment効果をhard-codeできる。
- Codegraphでproposed semantic ownershipを発見したと主張する: candidate specに答えがmanual witnessとして入っている。

## Consequences

- seamはproductionとtestの両方を分け、fixed oracleはseam transaction外の不変検査器として残る。
- oracle expected outputの正本はrunner source一つで、candidate／snapshot／artifactはそのidentityをdigestで参照する。
- dedicated test ownershipは6-case mutation sensitivity matrixにより、単なるfile／symbol存在より強く検査される。
- RC2がsupportするのはmanual witnessからの3-way schedulability compileであり、semantic ownership discoveryではない。
- future behavior TODOはRC2中に実行しないため、pre-seam oracle receiptとpost-change期待値を混同しない。
- このADRをTask finalizationに使った後は、本pathへ実験結果や可変TODOを追記しない。
