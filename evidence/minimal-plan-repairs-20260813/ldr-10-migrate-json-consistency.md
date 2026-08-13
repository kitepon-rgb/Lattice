# ldr-10-migrate-json-consistency 証跡

## 実施

`todo migrate` の通常実行が `--json` を受理し、dry-run・schemaと同じくtyped JSON契約を利用できるようにした。
`--serialization-reviewed --json` の併用も受理する。追加の入力生成やschema変更は行っていない。
通常実行の末尾引数は厳密に検証し、未知の引数を受理しない。

## 変更ファイル

- `src/todo-cli.mjs`
- `src/cli-help.mjs`
- `test/todo-cli-schema-command.test.mjs`

## 最終試験

作業木には `node_modules` が無かったため、正規checkoutの既存
`/Users/kite/Developer/Lattice/node_modules` を一時symlinkで参照し、試験後にsymlinkを除去した。
installや製品資産の複製は行っていない。

```text
node --test test/todo-cli-schema-command.test.mjs
node --check src/todo-cli.mjs
node --check src/cli-help.mjs
git diff --check -- src/todo-cli.mjs src/cli-help.mjs test/todo-cli-schema-command.test.mjs
```

結果: 11 passed / 0 failed。通常実行の `--json`、serialization-reviewed併用、未知の末尾引数拒否を含む。

全体gateは未実施。今回の変更に直結するfocused testのみを実行した。
