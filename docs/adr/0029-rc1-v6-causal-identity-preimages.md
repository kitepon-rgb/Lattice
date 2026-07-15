# ADR 0029: RC1 v6の因果identityをtyped preimageとdescriptorで固定する

- 状態: Accepted
- 日付: 2026-07-16
- 対象plan: `lattice-research-campaign-1-v6` / RC1-V0〜W
- 対象Control: `lattice-rc1-closed-loop-v3`
- predecessor: ADR 0028
- evidence: [RC1 v6 causal-binding core](../evidence/2026-07-16-rc1-v6-causal-binding-core.md)

## Context

ADR 0028は、v5 full verifierが保存oracleと無関係なdigest、false-passed case、snapshot preimageを持たない
Codegraph run、不完全なplan predecessorを依存digest再封印後も受理するため、Phase supportをrejectした。

RC1-Uはこの反例をcharacterizationへ固定した。v6生成側を変更する前にartifact-only verifierの正例とcorruption controlを
純粋関数として実装したところ、Codegraph raw payloadのbase64は汎用artifact canonicalizerのbounded string上限を超えるため、
evidence bundle全体を`digestArtifact(bundle)`でidentity化できないことも実コードで判明した。

## Decision

### 1. behavior identityは保存oracleのexact semanticsから再計算する

v6 behavior receiptは保存oracle全体のdigestに加え、case ID、順序、件数、expected kind／digestの完全列を持つ。
verifierは保存oracleから列を再計算し、receiptへexact照合する。`outcome: passed`は
`expected_digest === observed_digest`かつexpected／observed kind一致の時だけ成立し、overall outcomeもcase列から再計算する。

### 2. oracle runtimeは観測条件としてtyped identity化する

receiptはNode version、明示したWorker `exec_argv`、必要environment、oracle executor source digestを持つ。
disk verifierは現在のhost runtimeを暗黙比較せず、campaign fixed inputとして保存された期待runtimeとreceiptを照合する。
これにより後日のartifact replayと当時の観測条件を混同しない。

### 3. Codegraph runはsource snapshotとtool identityのtyped preimageを持つ

各runはbase SHA、patch digestまたはnull、sorted source snapshot、Codegraph version／executable digest、query set digest、
raw evidence digestを一つのmeasurementへ保存する。measurement digestだけを信頼せず、snapshotとCodegraph identityのpreimageを
再計算し、controlはbase、treatmentはaccepted transform outputから導出した独立期待値へexact照合する。

### 4. bundle全体hashではなくtyped evidence bundle descriptorをplan identityにする

raw payload自体はmanifest byte hashと既存raw／diagnostic／portable semantic verifierで検査する。runとplan predecessorが参照する
bundle identityは、condition、run ID、query set digest、raw digest、diagnostic payload digest、sanitization manifest digest、
portable aggregate digest、measurement digestからなるboundedなtyped descriptorのdigestとする。

これはraw bytesを省略して信頼する設計ではない。raw bytesのbyte hashとsemantic projectionを先に検証し、その結果を列挙した
descriptorを因果graphのnode identityにする。任意の巨大base64を汎用canonicalizerへ押し込む方式は採用しない。

### 5. plan predecessorは8件のexact ordered setとする

v6 plan diffは、v5 rejected plan archive、Phase Decision、accepted transform、behavior envelope、control／treatment各2 bundle
descriptorの8件を`{kind, ref, digest}`で保持する。呼出側が保存実bytesから導出した完全列と順序まで照合し、旧単数
`causal_predecessor`との併存を禁止する。

## Rejected alternatives

- **receiptのoutcome flagを信頼する:** v5反例を再導入する。
- **現在のNode runtimeへ比較する:** historical artifactの検証環境と観測環境を混同する。
- **snapshot digestだけを保存する:** 任意digestの自己申告を排除できない。
- **evidence bundle全objectを汎用canonicalizerでhashする:** raw base64がbounded string上限を超え、正例が成立しない。
- **raw digestだけをbundle identityにする:** query、diagnostic、portable projection、measurementとのcross-bindingが欠落する。
- **predecessorをref文字列だけにする:** ref先bytesの置換を検出できない。

## Consequences

- `src/rc1-v6-causal-binding.mjs`をV1／V2／Wに先行する純粋verification coreとする。
- RC1-V1はoracle runnerとbehavior envelopeをこのcoreが受理するreceiptへ更新する。
- RC1-V2はcampaign runとevidence bundleをこのcoreが受理するmeasurementへ更新する。
- RC1-Wは同じcoreをfull artifact-set verifierとplan diff v3へ接続し、別の検証意味論を作らない。
- v5 source／artifactは変更せず、v6だけを新schemaとして発行する。

