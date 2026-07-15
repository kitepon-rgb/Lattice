# RC1 fixture source-edit boundary preflight

- 実施日: 2026-07-15
- 対象HEAD: `9ecc12bb43f1a18f4f8b80a45952ebe62feada39`
- 対象Task: `RC1-S-safety-net-v2`
- Codegraph: 1.4.1、index state complete、5 files、23 nodes、57 edges、pending changes 0、pending refs 0。

## Planned ownership

- 新規owned symbol: `buildDispatchRecord`
- 新規owned path: `research/fixtures/dispatch-record/src/dispatch-record.mjs`
- 新規affected test: `test/research-dispatch-record.test.mjs`
- config write: `package.json`のstandard syntax gateへ新規source／testを追加する。

いずれもpreflight時点では未作成であり、Codegraphの空結果を既存依存なしとは解釈しない。
`new_surface_unknown`としてfixture追加後のsync／再queryまで保持する。

## Query evidence

| command | rc | observed result | typed interpretation |
|---|---:|---|---|
| `codegraph status . --json` | 0 | complete、pending 0、mismatchなし | sensor ready |
| `codegraph query buildDispatchRecord --path . --json` | 0 | JSON `[]` | `symbol_absent`。independence証拠ではない |
| `codegraph callers buildDispatchRecord --path . --json` | 0 | 非JSON `Symbol ... not found` | `symbol_absent_non_json` |
| `codegraph callees buildDispatchRecord --path . --json` | 0 | 非JSON `Symbol ... not found` | `symbol_absent_non_json` |
| `codegraph impact buildDispatchRecord --path . --json` | 0 | 非JSON `Symbol ... not found` | `symbol_absent_non_json` |
| `codegraph affected research/fixtures/dispatch-record/src/dispatch-record.mjs --path . --json` | 0 | affected test 0 | `path_not_indexed_unknown` |
| `codegraph node test/research-dispatch-record.test.mjs --path .` | 0 | indexed fileなし | `test_surface_absent` |
| `codegraph affected test/research-dispatch-record.test.mjs --path . --json` | 0 | planned test自身を返す | planned local gate候補。source impact証明ではない |
| `codegraph query runCli --path . --json` | 0 | `test/bootstrap.test.mjs`の既存function | positive control |
| `codegraph impact buildBootstrapDiagnostics --path . --json` | 0 | implementation、CLI、testの3 node | positive control |
| `codegraph affected src/bootstrap.mjs --path . --json` | 0 | `test/bootstrap.test.mjs` | positive control |

## Caller／callee／impact／affected testとunknown

planned symbolは未作成なのでcaller、callee、impactは未確定であり、ゼロとは宣言しない。fixture追加後の期待は、
testだけが`buildDispatchRecord`をimport／callし、fixture sourceのaffected testとして同testが返ること。実測が違えば
期待へ丸めずboundary manifestを更新する。

Codegraph外のmanual evidenceは、通常条件でstate read／writeなし、external effectなし、dynamic dispatchなし。
これはfixture実装とcharacterizationで検証する仮説であり、Codegraphの空結果から導出していない。
shared-state negative controlは意図的なinput overlayで、runtime effectを起こさない。

## Parent decision

既存indexed sourceを変更せず、新規fixture／test pathと`package.json`のsyntax gateだけを編集する。
まずtestと固定inputを置いてmissing fixtureのredを確認し、その後monolith fixtureを追加する。
fixture追加後にCodegraph syncと同じboundary queryを再実行するまで、dispatchable／parallel-readyとは扱わない。

## Post-addition verification

fixture／test追加後、Codegraph daemonは明示sync前にindexを7 files、35 nodes、85 edgesへ更新していた。
`codegraph sync .`は`Already up to date`を返し、post statusはpending changes 0、index complete、pending refs 0、
worktree mismatchなしだった。暗黙更新を失敗扱いにも手動sync成功の証拠にもせず、post statusとquery実物を採用する。

- `query buildDispatchRecord`: fixtureのexported functionとtest importを返した。
- `callers buildDispatchRecord`: `test/research-dispatch-record.test.mjs`を返した。
- `callees buildDispatchRecord`: `hasExactInputKeys`と`nonEmptyString`を返した。
- `impact buildDispatchRecord`: fixture functionと同testを返した。
- `affected research/fixtures/dispatch-record/src/dispatch-record.mjs`: 同testを返した。
- `query selectDispatchChannel`／`query formatDispatchLabel`: JSON `[]`。planned seamはまだ存在しない。

focused characterizationは3 pass、0 fail、0 skipped。`npm run check`も新規fixture／testを含めて成功した。
これによりowned symbol、caller／callee、impact、affected testはcontrol fixtureの実測へ更新された。
manual state／effectとfuture TODOのsemantic concern mappingは引き続きstatic graph外であり、RC1-Dまでunknownを隠さない。
