# ADR 0035: RC1 transfer front-endとdelivery policy fixture契約

- Status: Accepted
- Date: 2026-07-16
- Scope: RC2-D／RC2-Eのfixture固有front-end、研究fixture、black-box oracle
- Related: [ADR 0032](0032-rc2-bounded-graph-compiler-and-three-way-seam.md)、
  [ADR 0033](0033-rc2-v2-compiler-and-independent-verifier-contract.md)、
  [ADR 0034](0034-rc2-provenance-bundle-and-v2-artifact-validation.md)

## Context

ADR 0032〜0034は、candidate非依存のbounded scheduler、独立minimum verifier、provenance付きnormalized bundleを固定した。
次に識別すべきなのは、同じcoreへ既存RC1 v6の2-TODO evidenceと新しい3-TODO fixture evidenceを入れられることである。

front-endが保存済みv1 planのwave数をコピーしたり、candidate／conditionをgeneric coreへ漏らしたりすると、同じcoreを使うという
主張は自己成就する。また新fixtureのbehaviorとoracleをtransform実装後に決めると、挙動不変性を検査できない。

## Decision

### 1. RC1 transferはfixture固有front-endに閉じ込める

`src/rc2-rc1-transfer-front-end.mjs`は次のexact入力だけを受け取る。

```js
compileRc1TransferBundleV2({
  planInput,
  candidateSpec,
  manualEvidence,
  querySet,
  boundaryManifest,
})
```

front-endはRC1 v6のschema、candidate ID、query／manual binding、current／proposed surfaceを知ってよい。出力先の
`compileBoundaryObservationV2`と`compileSchedulabilityGraphV2`にはcandidate ID、fixture path、condition、expected conflict数、
expected wave数を渡さない。

### 2. 保存artifactの自己申告を再利用せず入力をcross-bindする

front-endは少なくとも次をfail-loudに検証する。

1. `boundaryManifest.plan_input_digest === digestArtifact(planInput)`。
2. `boundaryManifest.source.query_set_digest === digestArtifact(querySet)`。
3. `boundaryManifest.source.manual_evidence_digest === digestArtifact(manualEvidence)`。
4. plan、candidate、manual evidence、manifestのTODO集合がexact一致する。
5. candidate specは`extract-dispatch-production-and-test-policies`で、condition selectorを持たず、manifestのwrite resourceが
   currentまたはproposed surfaceの一方へ完全に対応する。
6. resourceへ使うCodegraph provenanceはmanifestの`graph_evidence`に実在するexact evidence ref／digest／statusから作り、
   candidate provenanceは`digestArtifact(candidateSpec)`へbindする。
7. manual state／effectはmanual evidenceからresource単位に再構成し、manifestのmanual evidence digestへbindする。
8. v1のverdict、plan、`minimum_feasible_waves`は入力にせず、v2 bundleからpairwise verdictとminimum planを新規compileする。

v2 source envelopeは、manifestのcode snapshot digest、candidate spec digest、query set digest、manual evidence digestを持つ。
manifestの`todos[].writes`をresourceごとにgroup化し、shared resourceだけでなくtreatment後の単独owner resourceもbundleへ残す。

### 3. transfer出力は三つの独立契約を同時に満たす

戻り値はexactに`{ bundle, verdict, plan }`とする。bundleは`validateNormalizedBoundaryBundleV2`、verdictは
`validateBoundaryVerdictV2`、planは`validatePlanGraphV2`を通る。RC1 v6の4条件は次のisomorphic resultを持つ。

| condition | conflict records | distinct TODO pairs | minimum waves |
|---|---:|---:|---:|
| control-normal | 3 | 1 | 2 |
| treatment-normal | 0 | 0 | 1 |
| control-negative | 4（state 1） | 1 | 2 |
| treatment-negative | 1（state 1） | 1 | 2 |

### 4. delivery policy fixtureの公開挙動をtransform前に固定する

monolithic fixtureは`resolveDeliveryPolicy({ channel, urgency })`を公開する。入力はprototypeが
`Object.prototype`のexact 2-key objectで、shape／missing／extraは`TypeError`、未知enumは`RangeError`にする。

| channel | urgency | exact output |
|---|---|---|
| `email` | `routine` | `{ channel: 'email', transport: 'smtp', retry_limit: 3, delay_seconds: 60 }` |
| `email` | `urgent` | `{ channel: 'email', transport: 'smtp', retry_limit: 5, delay_seconds: 0 }` |
| `sms` | `routine` | `{ channel: 'sms', transport: 'sms', retry_limit: 2, delay_seconds: 30 }` |
| `sms` | `urgent` | `{ channel: 'sms', transport: 'sms', retry_limit: 4, delay_seconds: 0 }` |
| `push` | `routine` | `{ channel: 'push', transport: 'push', retry_limit: 1, delay_seconds: 10 }` |
| `push` | `urgent` | `{ channel: 'push', transport: 'push', retry_limit: 3, delay_seconds: 0 }` |

このpublic behaviorだけをcharacterization対象とし、transform後の内部file layoutは固定しない。

### 5. oracleは指定repoRootをfresh processでblack-box実行する

`runRc2DeliveryPolicyOracle({ repoRoot })`は指定されたworktreeの公開fixture entryをfresh Node subprocessで読み、上の6 caseを
照合する。親processのESM module cacheは使わない。成功receiptは
`lattice.rc2.delivery_policy_oracle_receipt.v1`、`outcome: 'passed'`、入力順が固定された6件の
`{ id, outcome: 'passed', output_digest }`だけを持つ。behavior不一致、child failure、invalid JSONはthrowして失敗を隠さない。

receiptとchild inputへcandidate ID、conflict、expected wavesを入れない。これによりoracleはschedulerの期待値を知らない。

## Rejected alternatives

- v1 plan／verdictをv2へ形だけ変えて再利用する: producer自己申告を独立検証できない。
- condition名からresourceやwave数を選ぶ: treatment効果がhard-codeされる。
- candidate corruptionを無視してmanifestだけを信頼する: provenance bundleのwitness bindingが切れる。
- oracleを親processでdynamic importする: 同一pathのpre／postや別worktreeがESM cacheで混線する。
- fixtureのshard fileをcharacterizationへ直接importする: public behaviorではなく実装layoutを固定してしまう。

## Consequences

- RC1 transferのfixture知識はfront-endに残るが、normalized coreのgeneric性を汚さない。
- RC1 artifactはread-only predecessorであり、transfer結果はRC2の新artifactとしてのみ発行する。
- 3-way shardは上表のpublic behaviorを全件保つ必要があり、不完全shardはoracleでrejectされる。
- 本ADR採用時点ではproduction moduleは未実装で、characterizationはplanned module欠落だけを原因にexpected-redである。
