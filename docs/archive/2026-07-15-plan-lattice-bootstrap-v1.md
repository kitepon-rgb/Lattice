# Lattice 実装計画

- 状態: Active
- 作成日: 2026-07-15
- 現在のplan version: `lattice-bootstrap-v1`
- 製品思想: [../PLAN.md](../PLAN.md)
- 公開契約: [00_product-contract.md](00_product-contract.md)

## Wave 0 — 開発環境bootstrap

- [x] 独立repoを`main`で初期化し、git identityを確認する。
- [x] `AGENTS.md`、`CLAUDE.md`、`PLAN.md`、製品契約、ADR、実装TODOをLattice所有で作る。
- [x] dotagentsで行った先行調査39ファイルをchecksum一致で`rag/`へ移管する。
- [x] Node ESM package、CLI entry、unit test、syntax check、CIを作り、baselineをgreenにする。
- [x] Codegraph indexを初期化し、status／queryがLattice sourceを返すことを確認する。
- [x] Spotter project設定を正規入口で導入し、診断する。
- [x] 初期環境を独立commit `3cbdbcb` に固定する。remote作成、push、publishは行わない。
- [x] dotagentsから未実証のLattice思想を除去し、本来のObserver／工場開発順へ戻す。

受入証拠（2026-07-15）:

- `npm run ci`／`make ci`: 4 tests pass、syntax check pass。
- `codegraph status . --json`: 5 files、23 nodes、57 edges、pending changes 0。
- `codegraph query buildBootstrapDiagnostics --path .`: 実装・CLI・testのsymbol参照を検出。
- `spotter doctor`: result OK、warnings 0。project-local Claude/Codex tool DBを生成。
- `codex-sidecar diagnostics --project . --preset auditor --json`: status OK、read-only。
- Spotter生成stateは`.claude/`／`.codex/`／`.spotter/`、Codegraph DBは`.codegraph/`、sidecar実行stateは
  `.codex-sidecar/`に端末ローカル保持し、正本configだけを追跡する。

**Gate:** 新しいLattice sessionをrepo rootから開始し、正本、CLI、test、Codegraph、Spotterを再現できる。

## Wave 1 — Boundary manifest最初の縦切り

### W1-A Schema lane

- [ ] `lattice.plan_input.v1`と`lattice.boundary_manifest.v1`のstrict validator、canonicalizer、digestを実装する。
- [ ] unknown field、過大collection、相対／逸脱path、digest不一致をfail closedで固定する。

### W1-B Codegraph lane

- [ ] Codegraph status／query／impact／affectedを正規CLIまたはSDKから読むadapterを実装する。
- [ ] index absent、stale、unsupported、unresolved、CLI failureを空のgraphへ丸めない。

### W1-C Compile lane

- [ ] 明示されたTODO候補とmanual state／effect evidenceをboundary manifestへcompileする。
- [ ] `parallel_ready | seam_candidate | intentional_serial | unknown_requires_evidence`を根拠付きで返す。

**Campaign W1-J:** 三laneをjoinし、実Lattice repoとObserver fixtureでmanifestを生成する。

## Wave 2 — TODO graph compiler

- [ ] hard precedence、write／semantic／state／effect conflict、capacity、joinを別graphとして生成する。
- [ ] edge witness、critical chain、unlock、versioned plan diffを実装する。
- [ ] ready nodeをconflict／capacity／回収可能性とともに選ぶ。

## Wave 3 — Seam transformation engine

- [ ] conflictから切断可能なcode seamと複数変換候補を生成する。
- [ ] disposable worktree、baseline、bounded write scope、複数verifier、rollbackを実装する。
- [ ] known classに限定せず、生成refactorの成功／失敗を構造化evidenceへ戻す。

## Wave 4 — Reindexとversion barrier

- [ ] transform前後を同じquery setで比較し、構造差分とstatic graph外のgateを統合する。
- [ ] 旧plan、agent context、途中patch、interface仮定を失効し、新plan versionへ全TODOを再compileする。

## Wave 5 — Observer dogfood

- [ ] Observer残計画をLatticeへ入力し、現行手動DAGと比較する。
- [ ] provider binding、semantic gate、read-only isolationで直列／並列／seam介入を実行比較する。
- [ ] actual wall-clock、review、rework、merge、rollback、critical chainを介入費込みで記録する。

## Wave 6 — 工場統合

- [ ] 公開CLI／schema／diagnostics／update／rollbackを固定する。
- [ ] dotagentsへ安定したadapter契約だけを追加する。
- [ ] BugHub、host matrix、複数端末installer、compatibility gateを同じwaveで更新する。
