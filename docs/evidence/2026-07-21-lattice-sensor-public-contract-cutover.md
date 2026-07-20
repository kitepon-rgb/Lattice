# Lattice sensor public contract cutover evidence

- 取得日: 2026-07-21
- 対象ToDo: `lpg-022`
- 確度: high（root CLI、MCP wire、package dry-run、syntax gateを実測）

## 実装結果

- root adapterを`src/sensor-adapter.mjs`へ一本化し、旧互換re-exportを廃止した。
- query/evidence/runtime fieldを`sensor_*`、artifact schemaを`lattice.sensor_*`へ変更した。
- MCP toolを`lattice_sensor_{search,callers,callees,impact,node,explore,status,files}`へ変更した。
- project configを`lattice-sensor.json`へ変更した。
- root CLI envを`LATTICE_SENSOR_*`へ変更した。
- packageは`dist/bin/lattice-sensor.js`だけをentryとして同梱する。

## 検証

- `npm run check`: pass
- root `lattice sensor init <clean-target> --json`: pass
  - `.lattice/sensor/sensor.db`生成
  - status: 1 file, 2 nodes, 1 edge, pending changes 0
- MCP integrationの実応答tool list: 8件すべて`lattice_sensor_*`
- `npm pack --dry-run --json`: package内sensor entryは`lattice-sensor.js`のみ

既存testの旧tool名・旧daemon path expectationは意図どおり失敗しており、後続`lpg-023`で新契約へ更新する。
