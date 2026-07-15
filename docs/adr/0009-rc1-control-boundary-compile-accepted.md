# ADR 0009: RC1 control boundary compileを受け入れる

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v2`
- 対象Control: `lattice-rc1-closed-loop-v3`
- depends on: ADR 0006、ADR 0007、ADR 0008

## Context

RC1の核心仮説を検証するには、seam変換前の同じcode snapshotから、競合境界、typed verdict、現plan topologyを
機械生成しなければならない。ここを人手記述すると、treatment後の改善を実装者の期待で作り込めてしまい、
control／treatment比較が非識別になる。

また、code write boundaryだけを持つnormalと、code seamでは除去できないshared stateを持つnegativeを同じcompilerへ
通さなければ、常に`seam_candidate`を返す実装を反証できない。

## Decision

commit `d2d4128`のcontrol compilerとartifact contract amendment、および
[RC1-D acceptance evidence](../evidence/2026-07-15-rc1-control-compile-acceptance.md)を受け入れる。

- fixed RC1 input、manual evidence、fixed Codegraph query set、typed Codegraph outcomes、fixture snapshot digestを
  control compileの全入力とする。
- query ID／operation／順序、RC1 query coverage、capacity 2、同一anchor、affected characterization testを
  fail closedに照合する。欠落・drift・unknownを独立性へ丸めない。
- boundary manifestはCodegraph recordとTODO別manual recordを別provenanceとして持ち、write／state／effect conflictを
  resource単位で型付けする。
- normal controlはwrite boundary 1件を`seam_candidate`と裁定し、control plan v1を2 waveへcompileする。
- shared-state negativeはstate conflictを保持して`intentional_serial`と裁定し、code path分割だけでは並列化しない。
- artifact digestはLattice canonical serializationから計算し、payload外に置く。

このDecisionは変換をacceptしない。`seam_candidate`はRC1-Eを開始できるtyped proposalに限り、隔離worktreeでの
behavior／scope verificationとaccepted transform artifactがなければcode architectureの変更をplanへ反映してはならない。

## Rejected alternatives

- **manifest／planをfixture用JSONとして手書きする:** compilerの核心を実証せず、比較結果を作り込める。
- **manual evidence全体digestだけを使う:** state conflictのTODO別provenanceを失う。
- **state negativeもseam candidateにする:** code ownershipとruntime shared stateを混同する。
- **affectedがunresolvedなので全体を停止する:** target別には既存anchor testをready、未作成pathをemptyとして保持しており、
  aggregate unresolvedを消さずにcontrol境界をcompileできる。
- **fuzzy Codegraph resultを既存seamとして受け入れる:** ADR 0008の実反証に反する。

## Consequences

- RC1-Eはnormal verdictの`extract-dispatch-policies`だけを介入候補として消費できる。
- treatmentは同じplan input／query set／manual evidenceとaccepted transformをpredecessorにし、RC1-Fで新plan versionへ
  全affected TODOを再compileする。
- control plan v1へ追記してtopologyを変更しない。post-transform結果はplan v2とplan diffへ分離する。
- compilerはRC1 fixed fixture subsetであり、一般goal decompositionやarbitrary seam synthesisの完成を主張しない。
- Codegraph、dotagents、Observer関連repoのwriter境界は変更しない。
