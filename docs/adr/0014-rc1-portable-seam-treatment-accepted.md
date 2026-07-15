# ADR 0014: RC1 portable seam treatment-v2 artifactをacceptする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v3`
- 対象Control: `lattice-rc1-closed-loop-v3` / `RC1-E2-portable-transform-v3`
- depends on: ADR 0011、ADR 0012、ADR 0013

## Context

ADR 0011のsame-base seam treatmentは挙動不変変換と隔離実行を実証したが、predecessorにしたcontrol artifactがraw Codegraph
outcome digestを含んでいた。ADR 0012はそのdigest意味を反証し、ADR 0013はportable projectionで再compileしたcontrol-v2を
active predecessorにした。RC1-Fへ進むには、transform artifact自身もcontrol-v2 digest chainへ再発行し、旧chainが隔離実行へ
入れないことを実装で保証する必要がある。

## Decision

- commit `3ef99c4c4ed1b87bd8833a7492cea5e00993d46d`のportable evidence admissionをacceptする。
- seam treatmentがadmitするのはexact schema `lattice.rc1.control_compilation_evidence.v2`とprojection
  `lattice.codegraph_portable_outcome.v1`だけとする。旧v1 evidenceへの互換fallbackを持たない。
- evidenceの2 fresh-index proof、raw digest不一致、portable digest一致、query set順序、boundary manifestのgraph evidence、
  control artifact digest chainをworktree作成前にfail closedで検証する。
- control base `d2d412800492fbed03febe02abc6dca81c09a88b`上のaccepted artifact
  `09ef275af54cf4bc4bbd65e08750be6ab22f7febe4d800b3be16548408a4a30d`をRC1-Fの唯一のtransform predecessorとしてacceptする。
- `research/campaigns/rc1/artifacts/treatment-v2/transform/`のartifactをactive evidenceとする。旧`artifacts/treatment/`は
  削除／上書きせず、portable evidence反証前の歴史証拠として保持する。
- scope violation、behavior divergence、shared-state negative admissionは引き続きrejectし、rejected patchを後段へ渡さない。

## Accepted identity

- control compilation evidence: `44cfd470e01e1e115c7f687271520483fbd3295d4b8ca2962a22b21129acb00e`
- boundary manifest: `1aec1c9efc6baa19a6df9f82464ddb8069988f5165f049573811cc3de935a064`
- boundary verdict: `f7e4df5b94ea7f0cb9676670d312d7aaee5ef2881854610c3bb2de41557735bf`
- control plan: `506052d82f68cd1041e7b3398687a2d539053dc55ffd63b5530ed9bdf5102110`
- accepted transform: `09ef275af54cf4bc4bbd65e08750be6ab22f7febe4d800b3be16548408a4a30d`
- raw patch: `acefad450f77906d21e1712c710c1ed91e199d9607d7c6703e8378abeb1f92af`、2815 bytes

## Rejected alternatives

- **base SHAだけをv2へ差し替える:** artifact digestとgraph evidenceの意味が旧controlのまま残る。
- **v1／v2を両方admitする:** portability反証済みartifactがactive predecessorへ再流入する。
- **portable equality flagだけを信頼する:** query setやmanifest graph evidenceと別のoutcome集合を証拠にできてしまう。
- **旧transform artifactをin-place更新する:** 過去ADRのdigest参照と反証履歴を壊す。

## Consequences

- RC1-Fはsame-base、same-query-set、portable control chainへbindされたaccepted patchだけからtreatmentを構築できる。
- seam patchとpost-transform snapshotは旧runと同一であり、E2の独立変数はartifact evidence chainのcorrectnessだけである。
- Codegraph reindexとplan v2 compileはE2では行わず、RC1-Fの隔離treatment runnerへ一体化する。
- isolation runnerが既存ignored fileのcontent-only mutationを検出できないresidual unknownはRC1-Gへ持ち越す。
- Codegraph、dotagents、Observer関連repoのwriter境界は変更しない。
