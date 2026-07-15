# Lattice 製品契約 v0

## Product outcome

入力されたproduct outcome、codebase、実行capabilityから、証拠付きの並列TODO graphを生成する。
境界競合がcritical chainを作る場合は、隔離されたseam-refactorを実行し、検証後のcodebaseから
新しいplan versionを再生成できる。

## 初期公開面

初回vertical sliceでは次のversioned JSONを所有する。

- `lattice.plan_input.v1`: project、plan version、TODO候補、手動state／effect evidence。
- `lattice.boundary_manifest.v1`: graph evidence、owns／reads／writes、hard needs、conflicts、unknowns、tests。
- `lattice.boundary_verdict.v1`: `parallel_ready | seam_candidate | intentional_serial | unknown_requires_evidence`。
- `lattice.plan_graph.v1`: immutable node、typed edge、capacity、join、source manifest digest。
- `lattice.transform_artifact.v1`: candidate、source、bounded patch、verifier receipt、post snapshot、cleanup、accept／reject。
- `lattice.plan_diff.v1`: old／new version、code transformation artifact、失効context、node／edge差分。

schemaはexact key、bounded collection、canonical serialization、digestを持つ。未知field、欠落、過大入力、
不正pathをfail closedにし、空の成功や暗黙fallbackへ丸めない。

## Boundary evidence

Codegraph由来のsymbol／edge／impact／affected testと、Latticeが補うschema、state、transaction、generated
artifact、config、external effect、H、runtime traceを区別して保持する。Codegraphだけで独立性を宣言しない。

`boundary_manifest.graph_evidence[].result_digest`は環境依存のraw CLI outputでなく、versioned portable outcome projectionの
canonical digestを指す。raw telemetryは診断receiptとして別に保持し、project／index absolute path、index時刻、DB byte size、
node更新時刻をplan identityへ混ぜない。除外fieldはprojection versionで列挙し、未知fieldをsafe defaultで捨てない。

## Transformation boundary

- 初期版からdisposableな隔離worktreeで実refactorを実行対象にする。
- canonical branch、commit、外部effect、H操作は親受入または明示承認なしに行わない。
- transform前baseline、変更scope、verifier、rollback、再index query set、version barrierを必須にする。
- known mechanical refactorだけに固定しない。生成変換もbounded effectと複数verifierで研究する。

## Blocker contract

blockerは、破られる要求／不変条件、因果経路、再現証拠、隔離／rollbackでも回避不能な理由、未充足条件を
持つ。満たさない意見はrisk／hypothesis／experimentへ分類し、製品scopeを縮めない。

## Bootstrap exception

空repoにはCodegraph indexが存在しないため、最初のscaffoldだけboundary manifestを免除する。
bootstrap source作成直後、初期環境commitより前にCodegraphを初期化し、それ以後のsource TODOは通常契約へ従う。
