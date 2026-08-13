# structure-artifact-canonical-repair

## 実施内容

- 保存済みstructure source・binding・compile artifact・finalizationの読取失敗を、plan keyと対象artifact相対pathに束縛した診断へ変換した。
- `todo status --json` と `todo verify --json` は、破損時だけ `structure_artifact_diagnostics` を返し、parse／schemaのreasonと、明示したlogical input refを `structure input --dry-run` へ渡す次のcommandを示す。
- 復旧処理・入力推測・repair専用writerは追加せず、既存の `structure input` writerを再利用する。
- 正常系のwire shapeは条件付きフィールドにより維持した。

## 最終試験

- `node --check src/todo-cli.mjs` — 成功
- `node --check src/todo-structure-store.mjs` — 成功
- `node --check src/todo-store.mjs` — 成功
- `git diff --check` — 成功
- `node --test --test-name-pattern='structure artifactの4種' test/todo-structure-cli.test.mjs` — 成功（1 passed）。canonical checkout `/Users/kite/Developer/Lattice/node_modules` を一時symlink参照し、worktreeへinstallしていない。
- 同focused fileの既存compile試験 — bundled sensorがworktreeに無く `LATTICE_SENSOR_UNAVAILABLE` で2件開始前失敗。今回の中心条件である4種診断・明示input復旧のfocused testは独立して成功。

## 変更ファイル

- `src/todo-cli.mjs`
- `src/todo-structure-store.mjs`
- `src/todo-store.mjs`
- `test/todo-structure-cli.test.mjs`
- 本証跡ファイル
