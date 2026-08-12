# cr4-retire 実行証跡

- 実施日: 2026-08-11
- 対象: `bridge-hub` の `bh5-deploy`、`bh6-multi-terminal-proof`、`bh7-knowledge-return`

## cutover

1. `f673b881979bbe1cd25c531d2326ab78efa297ba` の原本7行を一時復元し、
   `narrative_anchor` の行番号65–71とsource digestを全件一致させた。
2. `node .lattice/tools/build-bh-retire-revision.mjs` で
   `rev-2110d106ce415b7e3144039e` を生成した。bh1–bh4は
   `carry_reconciled_metadata`、bh5–bh7は`removed`である。
3. worktreeの`node bin/lattice.mjs todo revise --plan bridge-hub --input
   .lattice/revision-bridge-hub-cutover.json`がsource cutoverを成功させた。
   旧7行は`docs/archive/plan_bridge-hub_tasks.md`へ退避され、live文書には
   完了／除外のreplacementだけが残る。

## 検証

- `node bin/lattice.mjs todo status --json`の`active_set`、`next_ready`、`blocked`に
  `bridge-hub`は出ない。terminal auditは別途`audit_pending`として残る。
- `node --test test/todo-revision-writer.test.mjs test/todo-phase-revision-v3.test.mjs`
  は75件すべて成功した。
- PATH上の`lattice` 0.57.2は退役edge緩和前の配布物で同じrevisionを
  `carry_semantics_changed`として拒否した。変更対象を実行するため、上記実測は
  worktreeの`node bin/lattice.mjs`で行った。
