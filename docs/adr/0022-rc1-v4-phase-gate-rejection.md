# ADR 0022: RC1 v4のmachine supportをbehavior evidence非識別でrejectする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v4`
- 対象Control: `lattice-rc1-closed-loop-v3` / RC1-M
- supersedes: ADR 0021の`hypothesis_evaluation.supported=true`とRC1 Phase受入候補
- retains: ADR 0018〜0021で受理したsingle compiler、production＋test seam、portable preimage、source invariant、version barrierのmechanism evidence

## Context

RC1-Lは同じboundary compiler、candidate spec、manual evidence、query set、capacity、Codegraph version、black-box oracleを固定し、
control 2 run／treatment 2 runをfresh indexした。保存値はcontrolのwrite conflict `3`、test-write conflict `1`、
minimum feasible waves `2`から、treatmentの`0`、`0`、`1`へ変化し、shared-state negativeはstate conflict `1`／2 wavesを保持した。
portable payloadとmanifest 23 payloadのdigest chainも再計算一致し、machine predicateは15／15条件を通過した。

RC1-MのPhase反証で、挙動不変transformが実際にpre／post oracleを実行したかではなく、保存artifactだけからpost観測を
transformed snapshotへ帰属できるかを再監査した。実装は`runRc1V4SeamTransform`内でpre oracle、transform、post oracleの順に
実行している。しかし、その実行事実を保存するreceipt contractはsnapshot identityを保持していなかった。

## Decision

### 1. v4のmachine supportをrejectする

`research/campaigns/rc1/artifacts/v4/hypothesis-evaluation.json`の`supported=true`をPhase-levelの研究結論として採用しない。
理由は、次の具体的な非識別経路である。

1. `runRc1BlackBoxOracle`はentrypoint contentのSHA-256をmodule import cache keyへ使うが、返す
   `lattice.rc1.black_box_behavior_receipt.v2`へcontent digest、観測role、base SHA、code snapshot digestを含めない。
2. `behaviorSummary`はfull pre／post receiptを`outcome`と`receipt_digest`だけへ縮約する。transform receiptにもfull receiptは残らない。
3. v4 artifact writerはtransform receipt、patch、comparison、evaluation等を保存するが、独立したpre／post oracle receipt payloadを保存しない。
4. comparisonはbehaviorをcontrol／treatmentの`outcome`と`oracle_digest`へ再縮約し、`evaluateRc1Hypothesis`のbehavior条件も
   両outcomeが`passed`かつoracle digestが同じことしか検査しない。
5. 実保存receiptではpre／postの`receipt_digest`がともに
   `a75f1ff55f5f40a1950a4d95b2b8920f7b58a73be574b54a2c06c38f1814e6ee`である。roleとsnapshotがdigest preimageにないため、
   post実行を省略して`post = pre`を再利用する反実仮想も、現在の保存behavior blockと同じbytesを生成する。

したがってartifact-only verifierは「transformed snapshotをpost oracleが観測した世界」と「pre receiptをpostへ再利用した世界」を
区別できない。これは実際のv4 runnerがpost oracleを呼んでいないという主張ではない。独立変数であるaccepted patchと挙動不変観測の
因果的な結び付きを、保存artifactが立証できないという実験設計上の非識別である。

### 2. v4のmechanism evidenceを保持する

次は本findingで反証されないため、immutableなv4 artifactとDecisionを削除・上書きしない。

- control／treatmentは同じexported boundary compiler、candidate spec、manual evidence、query set、capacityを使用した。
- controlのproduction＋test shared writes、treatmentの0 shared writes、shared-state negativeのserial保持は保存compiled artifactから再計算できる。
- accepted transformはisolated worktreeでproduction＋test seamを生成し、実コード上は固定oracleをpre／postに実行した。
- control／treatment各2 runのfull portable Codegraph preimage、sanitized diagnostic、raw opaque receiptは保存・再計算可能である。
- transform patch、output snapshot、source invariant、cleanup、plan diff、version barrierのdigest chainは成立する。

これらは「境界観測、seam変換、fresh再index、再compileの閉ループ機構が作動した」証拠として保持するが、
「保存artifactだけで挙動不変を識別しH1-v4を支持した」証拠へは昇格しない。

### 3. v5 correctionを新しいplan versionへcompileする

v4 topologyへ修正を追記せず、active planを`lattice-research-campaign-1-v5`へ全再compileする。v5は少なくとも次をhard dependencyにする。

1. full pre／post behavior receiptを別artifactとして保存し、各receiptへ`role`、`base_sha`、`oracle_digest`、entrypoint content digest、
   固定behavior surfaceのtyped snapshot preimage／digest、case resultsを含める。
2. pre receiptをbase snapshotへ、post receiptをtransform artifactのexact output snapshotとaccepted patch digestへbindする
   versioned behavior evidence envelopeを作る。digest一致だけでなくroleとcross-artifact relationを検査する。
3. hypothesis evaluatorはcomparisonの自己申告summaryだけでなく、full receipt、snapshot、transform artifact、patch、manifestを入力にして
   fail closedに再計算する。
4. postをpreへ差し替える、role／entrypoint content／snapshot／patchを一項目だけ壊す、receipt payloadをmanifestから抜く、という
   characterization corruption testを先に赤で固定する。
5. correction後はv4 artifactを上書きせず、control／treatment各2 fresh runをimmutableな`artifacts/v5`へ再発行し、
   same query setから新しいplan versionへ全affected TODOを再compileする。

### 4. Control worker resultとfindingの採否を分離する

RC1-Mのrefuter TaskはControl read scopeへ`src/rc1-black-box-oracle.mjs`を列挙していなかった。workerはfinding導出時に同fileを参照したため、
親のTask設計漏れとworkerのread-scope逸脱が成立する。Worker Reportはlifecycle回収のためControlへimportするが、親acceptは行わずrejectする。

一方、親はLattice writer scope内のread-only調査としてoracle実装、transform、campaign writer、evaluator、保存artifactを改めて読み、
上記の同じ非識別経路を独立再現した。したがってP1 findingはworker権威ではなく親再現証拠として採用する。

## Rejected alternatives

- **実コードがpost oracleを呼ぶためacceptする:** 実行経路の目視はartifact-only再現性とreceipt再利用排除の代わりにならない。
- **pre／post digestが同じことを挙動不変証拠とする:** receipt preimageがrole／snapshotを持たないため、同値観測と同一receipt再利用を区別できない。
- **comparisonへpost snapshot digestだけ追記する:** full receiptを保存せずsummary同士を結ぶだけでは、観測receipt自身の帰属を立証しない。
- **v4 artifactを上書きする:**既存Decisionとmachine artifactの再現性を破り、どの契約で得た結果かを曖昧にする。
- **Observer dogfoodへ進む:** 内的妥当性の欠落を外部fixtureで埋めると交絡を増やす。

## Consequences

- ADR 0021はRC1-L時点のmachine resultとmechanism受入記録としてimmutableに残るが、Phase-level supportは本ADRが上書きする。
- v4 plan、hypothesis evaluation、comparison、agent contextはhistorical artifactとし、active dispatch predecessorにしない。
- v5 correctionがsource収束する前のfull `npm run ci`は実行しない。v4のrelated gate 27 passは保持するが、非識別をgreenへ丸めない。
- v5 Phase gateでsource収束後にfull regressionと独立反証を各1回実施する。
- Latticeだけをwriter scopeとし、dotagents／Observer関連repoはread-only、remote作成・push・publishは禁止を維持する。
