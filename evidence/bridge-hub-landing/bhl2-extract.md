# bhl2-extract — hubIndexHtml逐語抽出

- `src/bridge-hub-landing.mjs`新設（escapeHtml + hubIndexHtml逐語移設）、
  `src/bridge-hub-server.mjs`はimportへ置換（commit add2515）。
- 検証: `node --test test/bridge-hub-server.test.mjs` fail 0 /
  `npm run check:reachability` green（107 modules・stale宣言なし）。見た目バイト不変。
