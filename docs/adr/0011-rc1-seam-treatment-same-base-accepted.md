# ADR 0011: RC1 seam treatmentをcontrol観測baseへ固定してacceptする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v2`
- 対象Control: `lattice-rc1-closed-loop-v3`
- depends on: ADR 0009、ADR 0010

## Context

最初のtreatment候補はtransform実装時点の`103c9677c36c9753bfc2974424f1ac2070ef7bba`をbaseにしたが、control compileの
観測baseは`d2d412800492fbed03febe02abc6dca81c09a88b`だった。fixture contentとquery setが同じでも、前者のCodegraph corpusには
RC1-Eの実装sourceが追加されている。したがって差分はseam patchだけではなく、control／treatment比較は非識別になる。

transform artifactがbase SHAを持つだけでは、callerが現在HEADを選び続けることを防げない。control compileが観測したcommitと
artifact digest chainを、隔離実行のbase選択そのものへ接続する必要がある。

## Decision

- `lattice.rc1.control_compilation_evidence.v1`の`head`をRC1 treatment baseの唯一の権威とする。
- evidence内のcontrol boundary manifest、boundary verdict、plan graph、query set、code snapshot digestを実入力と照合し、
  schema、digest chain、40桁commit SHAのdriftをworktree作成前にrejectする。
- callerからの`baseRef` overrideを禁止する。accepted／rejectedのどちらもrunner evidenceのbaseがcontrol headと異なる場合は
  transform artifactへ変換しない。
- `d2d412800492fbed03febe02abc6dca81c09a88b`上のaccepted artifact
  `7a667a1885928acd13b514e6bc10a68f5254392276561298c2b6d2544b374a4b`だけをRC1-Fのpredecessorとしてacceptする。
- shared-state negative controlはseam executionへadmitせず、scope violationとbehavior divergenceはtyped rejected artifactにして
  raw patchを後段へ渡さない。
- accepted patchをcanonical worktreeへ適用しない。RC1-Fも同じcontrol baseから作るdisposable treatment worktreeだけで
  patch適用、再index、再compileを行う。

最初の`103c967…` runは実験反証によって不採用とし、untracked artifactをaccepted evidenceへ残さない。

## Rejected alternatives

- **transform実装時点のHEADをbaseにする:** Codegraph corpusとsource treeがcontrolからdriftし、独立変数をseam patchへ限定できない。
- **fixture content digestだけを一致させる:** query対象外sourceを含むindex corpus差を検出できない。
- **異なるbaseを記録だけして比較を続ける:** 交絡を観測した事実は非識別性を解消しない。
- **caller指定`baseRef`をevidence headより優先する:** 同じ欠陥をAPI利用者が再導入できる。
- **canonical branchへpatchをcommitしてから再indexする:** control conditionとrollback boundaryを失う。

## Consequences

- RC1-Fはcontrolと同じcommitへaccepted patchだけを加えたtreatmentを比較できる。
- base SHA、control artifact digest、query-set digest、pre-transform snapshot、patch、verifier receipt、post snapshotが一つの
  canonical transform artifactへbindされる。
- accepted変換は3 path exact scope、2815-byte patch、characterization pass、cleanup pass、source unchangedを満たす。
- isolation runnerが既存ignored fileのcontent-only mutationを検出できない点はresidual unknownであり、RC1-Eの成功条件を
  0 unknownと誤記しない。RC1-F／Gで安全性評価へ持ち越す。
- Codegraph、dotagents、Observer関連repoのwriter境界は変更しない。
