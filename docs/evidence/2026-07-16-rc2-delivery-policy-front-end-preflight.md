# RC2 delivery policy front-end source前Codegraph preflight

- 観測日: 2026-07-16
- 対象commit: `6e8994bc6632d5e5cc7b66d2d12ae5c4df2b0b4d`
- 対象tree: `06721ebe5232f8e8fb9716df9a939b82637a4dc8`
- 対象Task: `RC2-E5-delivery-policy-front-end-codegraph-preflight-v1`
- Decision: [ADR 0036](../adr/0036-rc2-delivery-policy-witness-and-test-seam.md)

## Index identity

characterization commit後のclean worktreeで`codegraph sync .`を明示実行した。1 file／29 nodesを追加し、直後の
`codegraph status . --json`は次を返した。

| field | value |
|---|---:|
| Codegraph | `1.4.1` |
| files | 70 |
| nodes | 1623 |
| edges | 6209 |
| pending changes | added 0／modified 0／removed 0 |
| worktree mismatch | `null` |
| index state／pending refs | `complete`／0 |
| reindex recommended | `false` |

Git statusは空だった。したがって以下は同じHEAD、同じworkspace、同じfresh indexに対する観測である。

## Planned sourceの観測

| query | raw structural result | disposition |
|---|---|---|
| `query compileDeliveryPolicyBoundaryBundleV2` | `[]` | planned exportは未存在。依存なしではなくbootstrap unknown |
| callers／callees／impact `compileDeliveryPolicyBoundaryBundleV2` | いずれも`Symbol ... not found` | caller／callee／impactは未観測。0件と断定しない |
| `query src/rc2-delivery-policy-front-end.mjs` | exact file nodeなし。`test/rc2-delivery-policy-front-end.test.mjs:9`の定数`FRONT_END`だけをfuzzy hit | exact path absent。fuzzy hitをreadyへ昇格しない |
| `affected src/rc2-delivery-policy-front-end.mjs` | `affectedTests: []`, traversed 0 | test側はdynamic importであるため「affected testなし」ではなくlinkage unknown |

新規sourceは`src/rc2-delivery-policy-front-end.mjs`一件だけをowned pathとする。初回source追加後に明示syncし、exact export／path、
caller／callee、impact、affected testを再観測するまでこのunknownを閉じない。

## Characterization testの観測

`query test/rc2-delivery-policy-front-end.test.mjs`はexact file nodeを1件返した。owned pathは同path、行範囲は1–282である。
path impactはfile自身1 node／0 edge、`affected`は同test一件、traversed 0だった。planned sourceへのdynamic import文字列は
Codegraph nodeとして存在するが、planned fileがない時点では依存edgeに解決されていない。

## 既存callee候補の観測

### `compileBoundaryObservationV2`

- exact symbol: `src/boundary-observation-compiler-v2.mjs:257`
- callers: `validateNormalizedBoundaryBundleV2`、`compileRc1TransferBundleV2`、関連file／test
- callees: `normalizeSource`、`normalizeResource`、`normalizePrecedence`、`assertAcyclic`、unknown／order helpersほか
- impact: 8 nodes／13 edges。`test/rc2-delivery-policy-front-end.test.mjs`を含む
- path-level affected tests:
  - `test/rc2-artifact-contracts-v2.test.mjs`
  - `test/rc2-delivery-policy-front-end.test.mjs`
  - `test/rc2-rc1-transfer-front-end.test.mjs`

front-endはこのgeneric coreへexact observation setを渡す。core自体は今回のowned writeへ含めない。

### `digestArtifact`

- exact symbol: `src/artifact-contracts.mjs:219`
- path-level affected tests: 26件。delivery-policy front-end／fixture、RC1 transfer、v2 artifact、scheduler、既存RC1群を含む
- disposition: candidate、query、manual、snapshot、portable preimageのcross-bindingに利用するが、同sourceは今回変更しない

## Affected testとunknown

source追加TODOのfocused affected testは`test/rc2-delivery-policy-front-end.test.mjs`である。既存coreを変更しない限り、
26件のartifact-contract回帰を実装中に反復実行しない。TODO完了候補ではfront-end focused testを一回、Phase gateでfull CIを一回実行する。

未解消unknownは次の三件である。

1. planned sourceが未存在なのでexportのexact node、caller／callee、impactはまだ生成されない。
2. dynamic import文字列は観測されたが、planned source pathへのedgeとaffected testはまだ解決されない。
3. Codegraphはcandidate witnessのsemantic correctness、oracle byte identity、behavior preservationを単独では証明しない。

これらはsource追加後postflight、snapshot／digest cross-binding、後続oracle／mutation gateで閉じる。空結果をindependenceへ丸めないまま、
characterization commit `6e8994b`をpredecessorとしてfront-end実装へ進める。

## Test policy

- 実施: Codegraph explicit sync、status、exact query、caller／callee、impact、affected、Git identity／clean確認
- スキップ: test再実行。characterization commit前に同じtest bytesでfocused 14件の`ERR_MODULE_NOT_FOUND`だけを確認済みで、
  このTaskはdocs evidence以外のsource／testを変更しないため
- full CI: Phase gateへ集約
