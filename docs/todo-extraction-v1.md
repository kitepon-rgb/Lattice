# `lattice.todo_extraction.v1`

> 状態: 完了済みの一回限り移行契約。新規planのauthoringには使わず、
> `lattice plan create --input <lattice.plan_create_input.v3>`を使用する。

`lattice.todo_extraction.v1` は G4 の一回きり移行 wave で AI が作る中間抽出 JSON である。
規範 shape は [JSON Schema](schemas/lattice.todo_extraction.v1.schema.json)、実行時の exact-key・
sort・digest・意味制約は `validateTodoExtraction` が所有する。`todo migrate` は Markdown を読まず、
この JSON の検証と `appendImportedPlan` による原子的登録だけを行う。

## status と fail closed

- `register_pending`: 未完として登録する。`completion` は `null`。
- `register_done`: 履歴完了として登録する。`completion.done_mode` は literal
  `historical_import` だけを許す。履歴時刻が一次証拠で確定しない場合、`completed_at` は
  `unknown_requires_evidence` とし、日付らしい散文・commit・観測日から推定しない。
- `exclude_superseded`: 外部正本へ編入済みで、二重登録を避けるため store task から除外する。
- `exclude_compatibility_record`: TODO 正本でない互換・完了記録を store task から除外する。
- `unknown_requires_evidence`: status、正本性、条件分岐などの裁定が不足している。schema として保持できるが、
  一件でも存在すれば `todo migrate` は store bytes を変えず `MIGRATION_UNRESOLVED` で拒否する。

`exclude_*` だけの互換文書は schema として記録できるが、登録対象 task がないため `todo migrate` は
`MIGRATION_EMPTY` で無変更終了する。空の todo plan を捏造しない。

裁定後は入力 JSON の該当 `disposition` と、必要なら `completion`／依存を明示的に更新し、
`extraction_digest` を再計算して同じコマンドを再実行する。拒否時は plan が member 化されていないため再実行できる。
登録成功後の同一 `plan_key` 再実行は、同じ入力でも ADR 0053 Decision 2a に従い
`STORE_WRITE_CONFLICT` となる。登録済み `completed_at: unknown_requires_evidence` の正規 evidence 昇格は
履歴を書き換えず、G5 の `todo evidence promote` で新 event として行う。

## 難所情報の保持

各 task の `source` は元 file/commit/line、見出し path、Markdown depth、親 task、checkbox stateを保持する。
`migration_context` は外部正本、carry-over、H 承認、条件、証跡参照、複数 repo／Control や gate の注記を保持する。
散文中の矢印、順序、先決、join は AI が裁定して `hard_dependencies`／`joins` へ明示した場合だけ edge になり、
tool が散文から edge を補うことはない。

## CLI

```text
lattice todo migrate --input <repo-relative-extraction.json>
```

成功時は stdout に `lattice.todo_migrate_result.v1` JSON 一行を返す。typed failure は stdout を空にして
stderr に `lattice.cli_error.v2` 一行、usage 違反は stderr の人間向け一行となる。この入口は G4 wave 限定であり、
Markdown 同期、watch、再取込 pipeline として常設しない。
