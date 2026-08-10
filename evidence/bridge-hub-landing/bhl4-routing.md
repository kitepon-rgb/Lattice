# bhl4-routing — 4面配信ルーティング

- `src/bridge-hub-server.mjs`: /と/projects/=JA同一body(301廃止)、/en/と/en/projects/=EN、
  /en→301→/en/、/en/projects/<id>→301 prefix剥がし(query維持)。landing判定はPROJECT_ROUTEより前（commit df4feec）。
- 検証: `node --test test/bridge-hub-server.test.mjs test/bridge-hub-landing.test.mjs` 27件 fail 0、
  integration/bin 8件 fail 0。proxy/SSE/421系は無改変でgreen。
