# runtime prediction freedom baseline

- Date: 2026-08-05 JST
- Base: `8dff68a778f87d57a3c6eeca834d9827f5ef2ea6`
- Branch: `main`（`origin/main`よりahead 5、behind 0）
- Worktree before campaign files: clean
- Lattice: `state=ready`、active runなし

## Focused baseline

```text
node --test \
  test/witness-scaffold.test.mjs \
  test/todo-independence-contracts.test.mjs \
  test/rc3-front-end.test.mjs \
  test/seam-verification.test.mjs \
  test/rc3-runtime-engine.test.mjs \
  test/runtime-io-sentinel.test.mjs \
  test/rc3-hold-recompile.test.mjs
```

Result: 112 passed、0 failed、0 skipped、duration 2.35s。

このbaselineは変更前挙動を固定する。`creates` exact gate、global epoch receipt reject、precedenceなしwave計測など、
今回変更する期待を含むため、実装後は該当testだけを新契約へ更新する。無関係のgreen expectationは維持する。
