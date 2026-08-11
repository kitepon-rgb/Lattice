# 進行中工程へのToDo構造検査 — 受入証拠

- Date: 2026-08-12
- Plan: `docs/plan_todo-structure-live-optin.md`
- Lattice implementation commits:
  - `d60c6c7f` — current HEADのclean観測scope
  - `cd2f7bf0` — planned postconditionとrealization順序の循環解消

## Lattice検証

1. `node --test test/integration/todo-structure-lifecycle.integration.mjs`
   - 2件green。
   - dirty管理木の同名未コミットanchorをsource evidenceへ混ぜない。
   - sensor初期化失敗でも一時worktree listが前後一致する。
2. `node --test test/todo-structure-overlay.test.mjs test/todo-structure-source-adapter.test.mjs test/integration/todo-structure-lifecycle.integration.mjs`
   - 20件green。
   - planned `after_task`はdeferred consistent、final `after_task`はpostconditionを検査する。
   - in-progressはrealizationを先取りせず、doneの欠損だけをerrorにする。
3. `npm test`
   - 1757件中1756件green。唯一の赤は、管理sensor未初期化をunknownとする旧CLI testの期待値。
   - authoritative observationがsensorを自動初期化する新契約に合わせ、unknown fixtureを
     `expected_at: baseline`へ変更した。
4. `node --test test/todo-structure-cli.test.mjs`
   - 上記変更後10件green。失敗したtest fileだけを再実行し、変わっていない1756件を再走していない。
5. `npm run check`
   - syntax check 169 files green。

## Peertable dogfood

- Repo: `/Users/kite/Developer/peertable`
- 管理worktree: 73 dirty entries
- 観測HEAD: `103fbfb7e4a6273b11c14d80c9e782a7f6053214`
- Plan: `peertable-dm-delivery-fx4e-20260811` v1
- Task: `k1`
- Structure set digest: `b7442e1b5a15fb8146f6f6de2d6de5d900121a871a63b6621f89bdef3e4042f2`

同じ保存済みstructure inputを三回再compileした。

1. 旧契約: dirty管理木を理由に`STRUCTURE_GIT_WORKTREE_DIRTY`。
2. clean観測scope導入後: compile完走。planned `after_task`とin-progress realization先取りの循環をfindingとして検出。
3. 循環修理後: `verdict: consistent`、`enabled: true`、finding 0、binding発行。

read projectionは`coverage: consistent`、`freshness: fresh`、`enabled: true`。commit済みの
`room/client.mjs:subscribe`と`skill/scripts/wakeup-bridge.mjs:dispatchNew`だけがnatural source nodeへ解決された。
未コミットの`skill/scripts/member-turn-completed.mjs`はnatural sourceへ取り込まず、planned deferred anchorとして保持した。
観測用一時worktreeは各compile後に残らず、Peertable既存worktree一覧は前後不変だった。

## 未実施

- npm publish、global install、本番dashboard deployはH操作なので実施していない。
- Peertableの既存WIP、stage、commit、worktreeは変更・整理していない。構造source、compile artifact、bindingだけを
  既存Lattice storeへ書いた。

