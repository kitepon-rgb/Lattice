# rpf-003 precedence wave

- 変更前再現: `test/seam-verification.test.mjs` のprecedence 2件が、期待2 waveに対して1 waveで失敗。
- 実装:
  - todo planの`hard_dependencies`と`joins`をcanonical precedenceへ写した。
  - runtime planの`precedence`をseam検証へ渡した。
  - 変換前後のwave計測へ同じprecedence集合を渡した。
  - 計測対象外taskへ伸びるedgeだけを除外した。
- 検証:
  - `node --test test/seam-verification.test.mjs test/runtime-seam-resolve.test.mjs test/integration/runtime-seam-transform.integration.mjs`
  - 35件成功、0件失敗。
  - `npm run check` 成功（139 files）。

waveは便益計測であり、実行時の同期barrierにはしていない。
