# runtime-prediction-freedom safety net

- 観測日時: 2026-08-05T02:40:00+09:00
- 対象: `rpf-003` precedenceを保持したwave計算
- 追加した検査:
  - conflictが無くても `T1 -> T2` のprecedenceがあれば2 waveになる。
  - 対象task外へ伸びるprecedenceは除外し、対象内のprecedenceは維持する。
- 変更前の結果: `node --test test/seam-verification.test.mjs` は12件中2件失敗。
- 実測: 両検査とも期待値2に対して実値1。現実装がprecedenceを捨てていることを再現した。
- 既存baseline: 112件成功、0件失敗（`2026-08-05-runtime-prediction-freedom-baseline.md`）。

この検査をproduction変更前の安全網とし、以後の修正でgreenへ戻す。
