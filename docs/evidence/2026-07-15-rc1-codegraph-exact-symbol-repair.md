# RC1-B2 Codegraph exact symbol repair evidence

- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v2`
- 対象Control／Task: `lattice-rc1-closed-loop-v3`／`RC1-B2-codegraph-exact-symbol-v3`
- Decision: [ADR 0008](../adr/0008-codegraph-exact-symbol-identity.md)

## Reproduction

RC1-Dの実Codegraph integrationを初回実行すると、control compilerは次でfail closedした。

```text
Codegraph evidence query-select-dispatch-channelはsymbol_absentでなくready
```

同じqueryをCodegraph 1.4.1へ直接実行すると、`node.name`は`selectDispatchChannel`ではなく
`SEAM_BY_CONCERN`だった。query targetは同constantのsignature内文字列にだけ存在し、scoreは約8.47だった。
`impact selectDispatchChannel`もrequested textを`symbol` fieldへ反復した一方、実際のrootはaffected配列先頭の
`SEAM_BY_CONCERN`だった。indexはcomplete、pending changes／refs 0、worktree mismatchなしであり、staleではない。

したがって、原因はCodegraphの検索結果をadapterが`JSON非空 = exact symbol存在`へ誤昇格したことだった。

## Repair gate

- source preflight: `collectOne`をowned symbolとしてqueryし、callerは`collectCodegraphEvidence`、calleesは
  `executeCommand`／`parseJson`／`summarizeAffected`／`isExactSymbolAbsent`／`outcomeFromStatus`、impactはadapter unitと
  control compiler integration、affected testは`test/codegraph-adapter.test.mjs`と観測した。
- focused red: 8 tests中、false-positive caseだけが失敗し、actualは`ready, ready`、expectedは
  `symbol_absent, symbol_absent`だった。
- focused green: `node --test test/codegraph-adapter.test.mjs`は8 pass／0 fail／0 skip。
- static: source／testの`node --check`は2件とも成功。
- failed-scope related rerun: `node test/integration/control-compiler.integration.mjs`は成功。
  proposed query／impact 4件は`symbol_absent`、既存anchorのquery／caller／callee／impactは`ready`だった。
- control artifact digest: boundary manifest
  `93f42f5c3dbd579eedf9ef994222658680f74b69d363a84eedfae17b10165936`、boundary verdict
  `8f008cbb9571c6fecb5d5dc08308c364a34603788cad27b3d1e1ecf469ddd495`、plan graph
  `9096be5ad1132b409300f7ad5dbf94366140467102d39de005cf96f7ed171520`。
- post-index: 16 files、208 nodes、835 edges、complete、pending changes／refs 0、mismatchなし。
  `exactSymbolCandidates`と`resolveExactSymbol`のcaller／callee／impact、およびadapter affected testを取得した。
- `git diff --check`成功。

full `npm run ci`は未実行であり、RC1-GのPhase gateへ集約する。

## Boundaries

- Codegraph本体、global package、`node_modules`は変更していない。
- query setおよびcontrol compilerの期待値は緩めていない。
- dotagentsとObserver関連repoはread-onlyのままである。
