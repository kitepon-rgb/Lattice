# Lattice sensor runtime cutover evidence

- 取得日: 2026-07-21
- 対象ToDo: `lpg-021`
- 確度: high（buildと旧stateなしtargetで実測）

## 実装結果

- TypeScript entryを`src/bin/lattice-sensor.ts`へ変更し、`dist/bin/lattice-sensor.js`を直接生成した。
- project stateを`.lattice/sensor/`へ固定し、DB名を`sensor.db`へ変更した。
- 旧path/envの自動移行・fallbackは追加していない。
- runtime envを`LATTICE_SENSOR_*`へ、daemon helloを`sensor`、client markerを
  `lattice_sensor_client`へ変更した。
- MCP tool実装名を`lattice_sensor_*`へ変更した。
- native kernelを`lattice-sensor-kernel`へ改名した。
- standalone upstream installer/upgrade source内の所有者名もLatticeへ変更した。

## 検証

- `npm --prefix sensor run build`: pass
- clean target direct init: pass
  - input: 1 JavaScript file
  - generated: `.lattice/sensor/.gitignore`, `.lattice/sensor/sensor.db`
  - forbidden `.codegraph`: not generated
  - status: initialized, 1 file, 2 nodes, 1 edge, pending changes 0

root wrapper、公開artifact schema、root tests/docsの追従は後続`lpg-022`／`lpg-023`で閉じる。
