# Lattice Sensor telemetry契約

配布中のLattice Sensorはtelemetryを送信せず、外部networkへ接続しない。

- host runtimeと公開MCPは`LATTICE_SENSOR_TELEMETRY=0`を固定する。
- index、query、impact、MCP sessionの内容を外部endpointへ送らない。
- project-localな診断とindex stateは`.lattice/sensor/`の所有範囲だけに置く。
- standalone telemetry CLI、opt-in prompt、collector、公開endpointは提供しない。
- `telemetry-worker/`と`docs/design/telemetry.md`はfork元の設計履歴であり、build、deploy、
  package、現行runtimeの対象外である。

回帰条件は[製品契約](../docs/00_product-contract.md)とruntime testを正とする。
