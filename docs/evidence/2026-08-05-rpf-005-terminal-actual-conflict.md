# rpf-005 終端実 diff の競合観測

## 結果

- managed supervisor が worker の terminal 応答後、receipt 裁定より先に origin-bound worktree の最終 diff を独立取得する。
- 実際の write は、同時に稼働した attempt の予測 read／write と照合する。予測境界に無い新規 file でも、相手の実 write と重なれば actual 同士の競合として検出する。
- 単独の予測外 write は競合に昇格せず、checkpoint に観測事実だけを残す。
- terminal 競合は既存の `finding_record` → `conflict` → `hold` へ渡し、rpf-004 の対象作業群限定 barrier を使う。別の停止経路は追加していない。
- checkpoint は `receipt_recorded` より前に耐久化し、receipt 自己申告を実 diff の代用にしていない。

## 請求項との対応

実際に変更された資源範囲を観測し、同時実行中の別作業の変更影響範囲との重なりを実行時競合として検出する請求項9の終端経路を接続した。検出後の停止範囲は請求項10どおり影響作業群に限定する。請求項本文は変更していない。

## 検証

- `npm run check`: 139 files syntax check passed
- `node --test test/rc3-runtime-characterization.test.mjs test/rc3-runtime-engine.test.mjs`: 33/33 passed
- `node --test test/integration/rc3-worktree-executor.integration.mjs test/runtime-managed-supervisor.test.mjs test/rc3-hold-recompile.test.mjs`: 29/29 passed
- `node --test test/runtime-conflict-cli.test.mjs`: 10/10 passed（実 supervisor/controller daemon）
- `node --test test/integration/hold-resume.integration.mjs`: 1/1 passed（競合群だけ停止し、無関係 worker が origin のまま継続）

実装 commit: `00028cc`
