# Lattice Sensorの同梱契約

Lattice Sensorは独立配布物ではない。root packageの`prepack`が`sensor`をbuildし、
`sensor/dist`のうちLatticeが直接使うruntimeだけを`@quolu/lattice`へ同梱する。

- 公開binは`lattice`と`lattice-mcp`だけ。
- sensorのstandalone installer、upgrade、uninstall、独立npm packageは公開しない。
- root runtimeは配布物内の`sensor/dist/bin/lattice-sensor.js`を直接起動する。
- PATH、`npx`、外部SDK、旧製品dataへのfallbackは行わない。
- project stateは`.lattice/sensor/`、設定は`lattice-sensor.json`、環境変数は
  `LATTICE_SENSOR_*`だけを使う。
- sourceからのbuildと検証は`npm --prefix sensor run build`、公開内容の確認はrootで
  `npm pack --dry-run --json`を使う。

旧上流のplatform bundle設計は現行の配布契約ではない。由来とlicenseは`NOTICE`で保持する。
