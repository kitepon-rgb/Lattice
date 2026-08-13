# companion-atomic-repair-edge 証跡

## 実施

- 新commandは追加せず、既存の`lattice todo migrate --input <repo-relative-extraction.json>`へ`lattice.todo_extraction.v3`のcross-plan hard dependency入力を追加した。
- cross-plan edgeの`reason`をdependency event自身へ保持し、target planのplan-scoped eventとしてplan追加と同じmigration transactionでstage・activateするようにした。
- 既存の存在・方向・terminal・cycle検証を再利用し、activation後に失敗した場合は新plan・target edge・transactionをrollbackするfocused経路を追加した。
- migrate resultへ接続内容、接続後ready frontier、次の操作を`companion`として返すようにした。

## 最終試験

worktree内で次を実行し、すべて成功した。

- `LATTICE_DASHBOARD_AUTOSTART=0 node --test test/todo-migration-companion.test.mjs` — 4/4 pass
- `LATTICE_DASHBOARD_AUTOSTART=0 node --test test/todo-cross-plan-dependency.test.mjs` — 5/5 pass
- `LATTICE_DASHBOARD_AUTOSTART=0 node --test test/todo-store.test.mjs` — 70/70 pass
- `LATTICE_DASHBOARD_AUTOSTART=0 node --test test/todo-migration.test.mjs` — 16/16 pass
- `LATTICE_DASHBOARD_AUTOSTART=0 node --test test/todo-cli-schema-command.test.mjs test/todo-design-memo.test.mjs` — 20/20 pass
- `npm run check` — syntax check 171 files pass
- `git diff --check` — pass

初回のfocused試験ではworktreeに依存が無く`jsonc-parser`解決に失敗したため、canonical repoの`node_modules`を一時symlinkして再試験した。試験後にsymlinkは撤去し、worktreeへ依存をinstallしていない。

## 変更ファイル

- `src/todo-migration.mjs`
- `src/todo-store.mjs`
- `src/todo-cli.mjs`
- `docs/schemas/lattice.todo_extraction.v3.schema.json`
- `test/todo-migration-companion.test.mjs`
- 本証跡ファイル

共有作業中の`.lattice`状態ファイルは対象commitへ含めていない。
