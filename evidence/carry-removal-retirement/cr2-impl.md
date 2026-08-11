# cr2-impl 証跡

## 実施

- `removed` と宣言された task に触れる hard dependency の incoming / outgoing だけを carry 比較から除外する既存実装を、通常 revision の回帰テストで固定した。
- join は removed を除いた残差を比較し、残差が空なら join 全体を除外することを固定した。
- `carry_reconciled_metadata` と phase v3 の `acquire_phase` にも同じ限定が適用されることを固定した。
- `removed` と無関係な hard edge の削除は、従来どおり `carry_semantics_changed` で拒否されることを固定した。

## 検証

- 実装コミット `560f79ea` の直前の `src/todo-store.mjs` へ隔離 worktree 内で一時的に戻したところ、新設の許可系 4件が失敗した（hard incoming/outgoing、join、metadata、phase v3 acquire）。復元後に green を確認した。
- `node --test --test-name-pattern='removed|carry_reconciled_metadata|acquire_phase' test/todo-revision-writer.test.mjs test/todo-phase-revision-v3.test.mjs` : 12/12 pass。
- `node --test test/todo-revision-writer.test.mjs test/todo-phase-revision-v3.test.mjs` : 75/75 pass。
- `git diff --check` : pass。
