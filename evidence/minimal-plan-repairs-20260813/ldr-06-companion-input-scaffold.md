# ldr-06 companion-input-scaffold 証跡

## 作ったもの

既存の公開CLI契約をcompanion plan起票の正規導線として確定した。新しい推測生成commandは追加しない。

- 入力形の取得: `lattice todo migrate --schema --json`
- 新plan登録: `lattice todo migrate --input <repo-relative-extraction.json> [--serialization-reviewed]`
- dry-run: `lattice todo migrate --input <repo-relative-extraction.json> --dry-run --json`
- 入力schema: `lattice.todo_extraction.v3`
- migrate結果schema: `lattice.todo_migrate_result.v3`

入力top-level必須keyは `schema`, `project_id`, `plan_key`, `plan_version`, `actor`,
`recorded_at`, `tasks`, `hard_dependencies`, `joins`, `extraction_digest`。
task必須keyは `task_id`, `title`, `lane`, `design_memo`, `narrative_ref`,
`compile_binding`, `disposition`, `start`, `completion`, `source`, `migration_context`。
目的・工程分割・依存はAIが明示入力し、Latticeは推測・生成しない。既存planをpartial変更せず、
`todo migrate` が新planとして登録する。

## 最終試験

実行:

```text
node --test test/todo-cli-schema-command.test.mjs test/todo-design-memo.test.mjs
```

結果: 15 passed, 0 failed。

同時に `test/todo-migration.test.mjs` も実行した。26 passed、9 failed。失敗は、
canonical checkoutの共有dashboard登録簿とworktreeのproject rootが衝突する
`PROJECT_ROOT_CONFLICT`、および未初期化fixtureで現行store artifactが見えない
`artifact_missing`であり、ldr-06のschema取得・入力shape・design memo契約の試験失敗ではない。
依存不足で最初に失敗した試行は、canonical checkoutの既存 `node_modules` を参照して再実行した。

## 変更ファイル

- `evidence/minimal-plan-repairs-20260813/ldr-06-companion-input-scaffold.md`

製品コードの変更はない。既存CLIとschemaが受入条件を満たしていることを実測し、契約を固定した。
