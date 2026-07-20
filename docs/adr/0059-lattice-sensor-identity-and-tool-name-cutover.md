# ADR 0059 — Lattice sensorの製品同一性と互換tool名cutover

- Status: Accepted / Immutable
- Date: 2026-07-20
- 裁定者: オーナー
- 関連: ADR 0047、ADR 0049、dotagents ADR 0078

## Context

CodegraphはLatticeへ完全吸収済みだが、公開runtimeと正規testにはPATH上の`codegraph`を起動する経路が残り、
同梱sensor packageも`@colbymchenry/codegraph`と`codegraph` binを名乗っていた。tool名もproviderを
機械判定できなければ、利用者とagentが独立Codegraphの存続と誤認する。

## Decision

1. Latticeのruntime、公開CLI、MCP、正規testはPATH、`npx`、第三者SDKからCodegraphを解決しない。
   構造解析はreleaseに同梱した`sensor/dist`だけをLattice内部入口から実行する。欠落・破損・version不整合は
   typed failureにし、外部Codegraphへfallbackしない。
2. 同梱packageの製品名はprivateな`@quolu/lattice-sensor`へ変更し、public `codegraph` bin宣言を外す。
   fork元MIT attributionと履歴は維持する。
3. MCP v1の8 tool名`codegraph_search`、`codegraph_callers`、`codegraph_callees`、`codegraph_impact`、
   `codegraph_node`、`codegraph_explore`、`codegraph_status`、`codegraph_files`は入力互換名として維持する。
   これは独立製品の配線ではない。server instructions、tool description、`codegraph_status`は
   `provider: lattice`、`sensor_owner: lattice`、Lattice系列sensor version、`mode`、`reason`を宣言する。
4. toolを`lattice_*`へ即時二重化すると16面の曖昧な併走になるため行わない。次のMCP majorで一括改名し、
   旧名を削除する。v1中は8面だけを正とする。
5. `.codegraph/` project indexと`CODEGRAPH_*`環境変数はfork由来storage/internal ABIとして当面維持する。
   外部package探索、PATH実行、MCP登録、update導線には使わない。

## Consequences

- package依存グラフとhost PATHから`@colbymchenry/codegraph`を除去できる。
- provider判定は名称推測でなくstatusのtyped keyで行える。
- attributionを保持しつつ、旧製品への暗黙fallbackと併走を禁止できる。
