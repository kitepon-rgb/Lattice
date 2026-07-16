# RC2 transfer／fixture source前Codegraph preflight

- 日付: 2026-07-16
- HEAD: `e9820a9c2a0b5be3ae88fe6345f8455572495804`
- 対象: RC2-D transfer front-end、RC2-E fixture／oracle
- source変更: 0

## Index freshness

source前の`codegraph status --json`は`complete`、pending 0だったが、`codegraph files --json`に直前commitの
2 characterization testが無かった。`complete`を収載証明へ丸めず、明示`codegraph sync`を実行した。

```text
sync: added 2 files / 17 nodes
files: 66
nodes: 1539
edges: 5895
pending changes: 0
pending refs: 0
```

sync後、次の2 pathがexactに収載された。

- `test/rc2-rc1-transfer-front-end.test.mjs`
- `test/rc2-delivery-policy-fixture.test.mjs`

## Planned owned surfaces

| planned export | planned path | exact query | callers／callees／impact | affected |
|---|---|---|---|---|
| `compileRc1TransferBundleV2` | `src/rc2-rc1-transfer-front-end.mjs` | `[]` | symbol not found | `affectedTests: []`、traversed 0 |
| `resolveDeliveryPolicy` | `research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs` | `[]` | symbol not found | `affectedTests: []`、traversed 0 |
| `runRc2DeliveryPolicyOracle` | `src/rc2-delivery-policy-oracle.mjs` | `[]` | symbol not found | `affectedTests: []`、traversed 0 |

返却symbolは無く、fuzzy近似名も無かった。3 pathはいずれもindex未収載である。したがってcaller／callee／impactの空と
affected 0は依存なしではなく、未作成surfaceのtyped unknownとして扱う。

manual affected-test witnessはcharacterizationのdynamic import定数から次に固定する。

- transfer front-end → `test/rc2-rc1-transfer-front-end.test.mjs`
- fixture／oracle → `test/rc2-delivery-policy-fixture.test.mjs`

## Existing callee boundary

transfer front-endが使う既存exportは、返却nameとpathがexact一致することを確認した。

- `compileBoundaryObservationV2` → `src/boundary-observation-compiler-v2.mjs:257`
- `compileSchedulabilityGraphV2` → `src/schedulability-compiler-v2.mjs:271`
- `digestArtifact`／`validatePlanInput` → `src/artifact-contracts.mjs:219`／`:331`
- v2 bundle／verdict／plan validators → `src/artifact-contracts-v2.mjs:258`／`:293`／`:317`

fixture／oracleの既存analogとして、`buildDispatchRecord`はfixture entry＋test import、`runRc1BlackBoxOracle`はRC1 transform＋
oracle testへ到達することを確認した。RC2 sourceはlegacy実装を変更せず、新pathへ加算する。

## Source後の必須再確認

source追加後は明示syncし、3 pathと3 exportのexact収載、実caller／callee、impact、affected testを再取得する。
unknownはそのpostflightが完了するまで0へ下げない。

- focused／related／full test: 未実行。source変更前の構造preflightだけ。
- dotagents／Observer関連repo write、remote、push、publish: 0。
