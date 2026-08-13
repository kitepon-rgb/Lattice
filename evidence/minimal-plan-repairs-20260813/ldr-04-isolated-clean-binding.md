# ldr-04-isolated-clean-binding 証跡

## 実施

- `independence compile` が共有repoの無関係なdirty WIPで停止しないよう、current HEADをdetached clean worktreeへ展開する観測経路を追加した。
- detached worktree内でbundled sensorを初期化し、sensor evidenceを収集した後、worktreeと一時ディレクトリを必ず破棄する。
- canonical repoのdirty状態、未commit入力、store外のWIPを観測対象へ混ぜない。
- 既存の独立性artifact schema・compile結果schema・sensor failureの明示性は変更していない。

## 変更ファイル

- `src/todo-independence-authoritative-observation.mjs`
- `src/todo-cli.mjs`
- `test/todo-independence-cli.test.mjs`

## 最終試験

作業木にはbundled sensor distと依存が無かったため、正規checkoutの既存 `sensor/dist` と `node_modules` を一時symlinkで参照し、試験後にsymlinkを除去した。installや製品資産の複製は行っていない。

```text
node --check src/todo-independence-authoritative-observation.mjs
node --check src/todo-cli.mjs
git diff --check
node --test test/todo-independence-cli.test.mjs --test-name-pattern='dirty worktreeの無関係WIP'
```

結果: `test/todo-independence-cli.test.mjs` 19 passed / 0 failed。dirty worktreeの無関係WIPを残したcompileを含む。

## 未実施

全体gateは未実施。今回の変更に直結するfocused testのみを実行した。
