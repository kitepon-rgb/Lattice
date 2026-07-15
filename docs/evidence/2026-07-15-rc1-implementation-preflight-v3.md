# RC1 implementation source-edit preflight v3

- 実施日: 2026-07-15
- 対象HEAD: `a64a51153e73c15edd1d4e67f9af8efe32395eb6`
- predecessor preflight HEAD: `abacc70a3d40b61585b762a5a048c76f513ca8d8`
- source scope: `src/`、`test/`、`research/`、`package.json`
- source scope tree listing digest: `99e6aff6976f2e8d7577d2dcf03074beff721a256acd8d448ed35399f76211e8`
- Codegraph: 1.4.1、index complete、7 files、35 nodes、85 edges、pending changes 0、pending refs 0、
  worktree mismatchなし、reindex recommendationなし。

current HEADとpredecessor preflight HEADのsource scope tree listing digestは一致した。間の変更はdocsだけであり、
既存の[source boundary contract](2026-07-15-rc1-implementation-boundaries.md)を再利用できる。ただしsource編集直前の
sensor readinessとplanned surfaceを再実測し、古いgreenだけから依存なしとは判断しない。

## Planned owned surfaces

| lane | owned symbol | owned source | owned test | placement |
|---|---|---|---|---|
| RC1-A | `canonicalizeArtifact` | `src/artifact-contracts.mjs` | `test/artifact-contracts.test.mjs` | F・親直轄 |
| RC1-B | `collectCodegraphEvidence` | `src/codegraph-adapter.mjs` | `test/codegraph-adapter.test.mjs` | A・implementer・dedicated worktree |
| RC1-C | `runIsolatedTransform` | `src/isolation-runner.mjs` | `test/isolation-runner.test.mjs` | A・implementer・dedicated worktree |

3 laneのwrite scopeは非交差である。RC1-Aのcanonical byte／digest／schema reject契約は後続artifact全体が依存する
公開契約なので親直轄、RC1-B／Cは仕様固定済みの実装物量なのでnative implementerへ配置する。

## Query evidence

各planned symbolに同じquery setを実行した。

| operation | observed | typed interpretation |
|---|---|---|
| `query <symbol> --json` | exit 0、JSON `[]` | `symbol_absent`。依存なしではない |
| `callers <symbol> --json` | exit 0、ANSI付き非JSON `Symbol "..." not found` | `symbol_absent_non_json` |
| `callees <symbol> --json` | 同上 | `symbol_absent_non_json` |
| `impact <symbol> --json` | 同上 | `symbol_absent_non_json` |
| `affected <planned source> --json` | changed path自身、`affectedTests: []`、traversed 0 | `path_not_indexed_unknown` |

空結果とexit 0非JSONをsemantic independenceへ丸めない。caller、callee、impact、affected testは新規surface追加後の
再indexまで`new_surface_unknown`を保持する。adapter自身は、この実測をtyped absence／emptyへ変換し、任意非JSONや
stale／unresolved／command failureを成功へ丸めないことを受入条件とする。

## Positive control

- `query buildDispatchRecord --json`はfixtureのexported functionとtest importを返した。
- `affected research/fixtures/dispatch-record/src/dispatch-record.mjs --json`は
  `test/research-dispatch-record.test.mjs`、traversed 1を返した。

したがってplanned queryの空結果はsensor全体の故障ではない。ただしCodegraphは構造sensorであり、manual state／effect、
behavior preservation、semantic independenceを単独証明しない。

## Unknown and post-edit obligations

- RC1-A／B／Cの新規APIが誰から呼ばれるかはpost-indexまでunknown。
- RC1-Bの実Codegraph live gateは親が行い、fake executor testだけでready扱いしない。
- RC1-Cのtemp git repo testはLattice current worktreeの隔離を証明しないため、親が実diffとsource repo不変を確認する。
- source追加後にCodegraph status、query、caller、callee、impact、affected testを同じoperation setで再実行し、
  期待との差をboundary evidenceへ戻す。

## Parent decision

sensor ready、source digest再利用可能、3 write scope非交差、planned surfaceはtyped unknownとして保持できている。
RC1-B／Cはexecution-verified registry observationとControl placementが`eligible`の場合だけdispatchする。RC1-Aはtest-firstで
redを確認後に最小実装へ進み、いずれもfocused test以外のfull suiteを実装中に反復しない。
