# CodeGraph runtime/name cutover baseline

- 取得日: 2026-07-21
- 対象: Lattice `rev-6abe7d8040cf7bc74020accb`着手時のworktree
- 確度: high（source grep、focused test、旧stateを持たない隔離targetで実測）

## 結論

Lattice所有への切替はreceipt上だけ完了しており、runtimeと命名のcutoverは未完了である。旧indexを持たない
隔離targetへ`lattice sensor init <target> --json`を実行すると、成功receiptを返しながら
`<target>/.codegraph/codegraph.db`を新規生成した。したがって旧dataを読まないだけでは完全排除にならない。

## Characterization

- focused baseline: 20 tests pass
- 現行の実行・配布・test・active contract面で旧tokenを含むfile: 211
  - `sensor/`: 140
  - `test/`: 36
  - `src/`: 30
  - `AGENTS.md`、`README.md`、`bin/`、`docs/00_product-contract.md`、`package.json`: 各1
- clean target実測:
  - receipt: `lattice.sensor_command_result.v1`, `provider=lattice`, `sensor_owner=lattice`, `status=ok`
  - 生成物: `.codegraph/.gitignore`, `.codegraph/codegraph.db`
  - `.lattice/sensor/`生成物: 0

## Cutover契約

1. sensorのproject stateは`.lattice/sensor/sensor.db`だけへ新規生成する。
2. `.codegraph`、`codegraph.db`、`CODEGRAPH_*`を読まない。自動移行・fallback・互換aliasを設けない。
3. 配布binary、CLI/help/error、daemon、MCP tool、artifact schema、runtime field、source identifierは
   `lattice-sensor`／`sensor`／`LATTICE_SENSOR_*`へ置換する。
4. 旧名を許すのは`./sensor/LICENSE`、`./sensor/NOTICE`の法的帰属と、`docs/archive/`、`docs/adr/`、
   `docs/evidence/`、`rag/`、`research/`の凍結済み履歴だけである。
5. 現行source、test、script、package manifest、active docsには旧tokenを許さない。機械gateで再混入を拒否する。
6. 受入は旧stateを持たないfresh AIShell fixtureで`init`、`sync`、query、MCP往復を行い、
   `.codegraph`非生成と`.lattice/sensor/sensor.db`生成を確認する。

## 敵対的検証で棄却した案

- 表示名だけ変更: 保存先とenvが旧契約のままなので棄却。
- 旧`.codegraph`の自動移行: 誤りが判明した旧dataを新stateへ昇格させるため棄却。
- 互換MCP aliasを残す: 完全排除と矛盾し、旧名を公開契約として延命するため棄却。
- 全repositoryで文字列ゼロを要求: MIT帰属と検証可能な履歴を破壊するため棄却。例外領域を固定したgateとする。
