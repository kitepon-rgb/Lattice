# ac1 atomic store commit実装証跡

## 成果

- 実装range: `152754c..4c4868a`（mainへfast-forward済み）
- 明示入口: store-only write command末尾の`--commit-store`
- 共通Git-dir lock、dirty store preflight、detached index/hook実行、共有index lock先行、
  HEAD CAS、store path限定commit、失敗時rollback、commit receiptを実装した。
- dirty source bytesとstore外の既存stageを保持し、既存のatomic指定なしwrite挙動も維持した。
- ignoredな再生成artifactだけを作るcompile、read command、schema表示、dashboard removeは
  `STORE_COMMIT_UNSUPPORTED`で拒否する。

## 検証

- 実装者focused: `test/todo-store-atomic-commit.test.mjs` 12/12 green
- 関連: atomic + todo-cli + cli-help 42/42 green
- 静的検査: `npm run check`、syntax 150 files green
- 負側: common lock競合、HEAD競合、共有index lock競合、hook失敗、hook後store再変更、
  dirty store、TypeError rollback、primary errorとcleanup EACCESの併発、unsupported分類を実行した。

## 独立監査

Akariが専用detached worktreeで`152754c..4c4868a`を実diff・再実行監査した。
独立42/42、syntax 150、diff-check green。監査資源はremove/prune済みで、残存findingなし
（room [1798]、Rin受理 [1801]）。

監査中に見つかった、共有index整合の部分成功、hook後再変更、ignored-only compileの偽対応、
lock leak、post-commit cleanup時のreceipt喪失、primary error喪失、特殊early-return迂回は、
すべて再現経路を負テストへ固定してから監査を通した。
