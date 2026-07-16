# ADR 0037: delivery policy seamをsnapshot／mutation matrix付き隔離transactionにする

- Status: Accepted
- Date: 2026-07-16
- Scope: RC2-Fのregistry-shard writer、隔離transform、accepted／rejected evidence
- Related: [ADR 0032](0032-rc2-bounded-graph-compiler-and-three-way-seam.md)、
  [ADR 0036](0036-rc2-delivery-policy-witness-and-test-seam.md)

## Context

ADR 0036は、delivery policyのproductionとtestを3 channelへ分け、fixed oracleをtransaction外に保持し、proposed ownershipを
Codegraph exact linkと6-case mutation sensitivityでacceptすることを決めた。これを単に8 filesへ定型文字列を書いてfocused testをgreenに
するだけでは、次を識別できない。

- canonical repoを直接変更したのか、disposable worktreeだけを変更したのか。
- fixed oracle source、candidate witness、実行adapter、実patchのどれがacceptanceへ使われたのか。
- dedicated testがownerの2 casesを検出するのか、空または常時passなのか。
- mutation後に元bytesへ戻ったのか、次のmutationまたはaccepted snapshotへleakしたのか。
- verifier failure、scope violation、cleanup failureをaccepted artifactへ丸めたのか。

既存`runIsolatedTransform`はclean source invariant、detached worktree、allowed-path検査、verifier後のsnapshot不変、cleanupを実証済みである。
一方、RC1のtransform artifactは2-way seamと別oracle contractを前提にしており、3 TODO×6 casesのtest ownership matrix、fixed oracle
source bytes、RC2 candidate digestを表現しない。RC2を旧schemaへ押し込めると必要な証拠が失われる。

## Decision

### 1. RC2専用moduleと3 exportsに分ける

`src/rc2-delivery-policy-transform.mjs`は次だけをexportする。

```js
RC2_DELIVERY_POLICY_TRANSFORM_PATHS
applyRc2DeliveryPolicyTransform({ worktreePath })
runRc2DeliveryPolicySeamTransform({
  repoRoot,
  baseRef,
  candidateSpec,
  transform, // optional rejection／equivalent-writer injection
})
```

`applyRc2DeliveryPolicyTransform`はdeterministic writerであり、worktree以外のrepo、oracle、scheduler、plan、Codegraphを知らない。
`runRc2DeliveryPolicySeamTransform`はtransaction ownerであり、入力検証、actual preimage、隔離、oracle、verifier、mutation matrix、artifact、
cleanupを所有する。optional `transform`は同じ全gateを通るwriter差替えで、functionの自己申告を証拠にしない。acceptanceはactual patch bytesと
transaction adapterのruntime source bytesへbindする。

### 2. allowed pathsはADR 0036の8件だけにする

定数は次をlexical sortしたfrozen arrayとする。

1. `research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs`
2. `research/fixtures/delivery-policy-registry/src/email-policy.mjs`
3. `research/fixtures/delivery-policy-registry/src/sms-policy.mjs`
4. `research/fixtures/delivery-policy-registry/src/push-policy.mjs`
5. `test/rc2-delivery-policy-fixture.test.mjs`
6. `test/rc2-delivery-policy-email.test.mjs`
7. `test/rc2-delivery-policy-sms.test.mjs`
8. `test/rc2-delivery-policy-push.test.mjs`

`src/rc2-delivery-policy-oracle.mjs`はallowed pathに含めない。symlink、submodule、special file、8件外のwriteはscope rejectionにする。
accepted default writerのchanged pathsは8件exactでなければならない。

### 3. writerはproductionとtestの両seamを作る

productionは`resolveEmailPolicy`、`resolveSmsPolicy`、`resolvePushPolicy`をchannel別fileへ置き、既存
`resolveDeliveryPolicy`をinput validationと3 resolverへのcomposition entryにする。外部input、error class、6 outputsは変えない。

testは各`*PolicyContract`がowner channelの2 exact casesだけを検査する。shared
`deliveryPolicyCompositionContract`はentryのrouting、public shape、fail-loudだけを検査し、6 exact valuesとfixed oracle importを持たない。
writerは同じworktreeへ二回適用して同bytesになる。

### 4. accepted inputをactual preimageへbindする

runnerは次をtransform前に確定する。

- clean canonical repoの`HEAD`と、`baseRef^{commit}`のexact一致。
- accepted `lattice.rc2.boundary_candidate_spec.v1` full digest、candidate ID、fixed oracle path／source digest、6 case partition。
- candidateが列挙する9 pathのactual current snapshot。current 3 filesだけがpresent、proposed 6 filesはabsentでなければならない。
- `src/rc2-delivery-policy-transform.mjs`自身のruntime source bytesとSHA-256。
- fixed oracle actual source bytesのSHA-256。candidate digestと一致しなければtransformを始めない。
- fixed oracleをfresh child processで実行したordered 6-case pre receipt。

caller supplied snapshot digest、oracle pass boolean、adapter digestは受理しない。runnerがfull preimageから再計算する。

### 5. isolation sequenceを固定する

runnerは既存`runIsolatedTransform`を使い、次の順で一回のtransactionを行う。

1. detached worktreeをexact base SHAから作る。
2. writerを適用し、8-path scopeとbinary patchをcaptureする。
3. 3 dedicated tests＋shared composition testを個別または固定集合でgreenにする。
4. fixed oracleをpost snapshotへ実行し、pre／postのordered `{id, output_digest}`をexact一致させる。
5. post 9-path snapshotをactual bytesから作り、9 files present、oracle digest不変、candidate proposed surfaceと一致させる。
6. 6-case mutation matrixを実行する。
7. matrix後のpatch、changed paths、全9 file digestsがaccepted post snapshotへexact復元したことを確認する。
8. detached worktreeを削除し、canonical HEAD、visible／ignored status、protected `src/`／`test/` bytesが不変であることを確認する。

verifier、oracle、matrix observerはaccepted patchを変更してはならない。各段階の失敗を別段階のpassで上書きしない。

### 6. mutation matrixは6 cases × 4 testsをexact検査する

candidateのfixed oracle orderで6 casesを一件ずつ処理する。各mutationはowner production shardの一つのcase outputだけを変え、次を要求する。

- fixed oracleはそのcase IDのbehavior mismatchを検出する。
- owner dedicated testだけがnon-zeroになる。
- 他2 dedicated testsとshared composition testはzeroのままになる。
- mutationの前後でowner shard bytesがexact復元し、全post snapshot digestも元へ戻る。

各cellはtest ID、outcome、exit code、stdout／stderr digestを持つ。各rowはcase ID、owner TODO、mutated path、oracle mismatch ID、4 cells、
restore digestを持つ。case集合、owner割当、row orderはcandidateの6-case exact partitionから導出し、matrix全体をdigestする。
「6件中いずれかが失敗した」のaggregate booleanだけは受理しない。

### 7. RC2専用artifactとreceiptを発行する

accepted resultは少なくとも次をfull objectとdigestの両方で持つ。

- candidate witness digest、adapter source digest、base SHA、control snapshot digest、fixed oracle source digest。
- allowed／changed paths、patch digest／bytes、post snapshot full files／digest。
- pre／post oracle full receiptsとcase-set digest。
- 6×4 mutation matrix full rows／digest。
- verifier receipts、source invariant、cleanup receipt。

resultとartifactのschemaはRC2専用versionにし、旧`lattice.transform_artifact.v1`を偽の互換fieldで満たさない。patch BufferはJSON artifact外に持ち、
artifactはpatch digest／bytesでbindする。artifact-only verifierはRC2-Gで別moduleとして追加し、保存bytesからrelationを再計算する。

rejected transactionもdiagnostic artifactとcleanup／source invariantを返してよいが、`status: accepted`、behavior envelope、accepted output predecessor、
new plan versionを持たない。incomplete shard、oracle divergence、mutation matrix failure、restore failure、scope violation、source drift、cleanup failureを
distinct rejection kindへ落とし、execution failureへ無差別に潰さない。

## Rejected alternatives

- RC1 transform artifactへRC2 fieldを詰める: 2-way schemaへ3-way case matrixを隠し、偽の互換性になる。
- fixed oracleをfocused testの一つとしてallowed path内へ置く: sourceと期待値を同時変更できる。
- dedicated test symbol／path存在とgreenだけでacceptする: 空testでも0 conflictを作れる。
- mutationを一括適用してsuite全体がredならacceptする: owner partitionとisolated TODOを識別できない。
- mutation後にwriterを再適用して復元扱いする: writerが別のdriftを上書きできる。保存したexact bytesへ戻してdigestを比較する。
- caller supplied snapshot／adapter digestを信頼する: 実行bytesとのbindingがない。
- rejected patchからtreatment planを試しにcompileする: version barrierを破り、失効すべきcontextを再利用する。

## Consequences

- RC2-Fは単なるrefactor writerでなく、隔離、behavior、test ownership、rollbackを一つのaccepted predecessorへする。
- 24 test cellsと6 oracle mismatchを実行するためtransform acceptanceは重いが、Phase full regressionとは別の契約focused gateである。
- actual multi-agent dispatchやfuture behavior TODO自体は実行しない。RC2が発行するのはseamと新plan versionまでである。
- このADRをTask finalizationに使った後は、本pathへ実験結果や可変TODOを追記しない。
