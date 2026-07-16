# RC2 closed-loop source／test前Codegraph preflight

- 観測日: 2026-07-16
- 対象commit: `29e904e`
- 対象Task: `RC2-G1-closed-loop-characterization-v1`
- Decision: [ADR 0038](../adr/0038-rc2-closed-loop-version-and-artifact-contract.md)

## Index identity

`codegraph sync .`は`Already up to date`を返した。最初に試した`codegraph status --path . --json`はCodegraph 1.4.1に
存在しないoptionでexit 1になったため、依存なしへ丸めず正規入口`codegraph status --json`で再観測した。

| field | value |
|---|---:|
| Codegraph | `1.4.1` |
| files | 73 |
| nodes | 1775 |
| edges | 6875 |
| pending changes | added 0／modified 0／removed 0 |
| worktree mismatch | `null` |
| index state／pending refs | `complete`／0 |
| reindex recommended | `false` |

## Planned source／test

予定exports `runRc2Campaign`、`writeRc2CampaignArtifacts`、`verifyRc2CampaignArtifactsOnDisk`、
`verifyRc2CampaignArtifactSet`、`RC2_ARTIFACT_PATHS`は、exact queryがすべて`[]`、caller／callee／impactがすべて
`Symbol ... not found`だった。予定pathも次の結果だった。

| path | query | affected | disposition |
|---|---|---|---|
| `src/rc2-campaign.mjs` | `[]` | tests 0／traversed 0 | planned source absent、bootstrap unknown |
| `src/rc2-artifact-set.mjs` | `[]` | tests 0／traversed 0 | planned source absent、bootstrap unknown |
| `test/rc2-campaign.test.mjs` | `[]` | self 1／traversed 0 | planned test absent、source linkage unknown |

planned sourceのaffected tests 0は「依存するtestなし」ではない。source／test追加後にsyncし、exact export、caller／callee、impact、
affected testを再観測するまでunknownを閉じない。

## Existing owned dependency boundary

| symbol | owned definition | direct relation | impact depth 2 |
|---|---|---|---:|
| `runRc2DeliveryPolicySeamTransform` | `src/rc2-delivery-policy-transform.mjs:951` | caller: transform test、callees 20 | 2 nodes／1 edge |
| `applyRc2DeliveryPolicyTransform` | same file `:938` | caller: transform test、callees 4 | 2／1 |
| `runIsolatedTransform` | `src/isolation-runner.mjs:260` | RC1 v4/v5/v6、legacy、RC2 transform、tests | 25／41 |
| `collectCodegraphEvidence` | `src/codegraph-adapter.mjs:323` | RC1 v4/v5、treatment runner、tests | 18／24 |
| `createRc1EvidenceBundle` | `src/rc1-evidence-bundle.mjs:354` | RC1 v4/v5/v6、tests | 11／11 |
| `compileDeliveryPolicyBoundaryBundleV2` | `src/rc2-delivery-policy-front-end.mjs:1020` | primary front-end test | 3／2 |
| `compileRc1TransferBundleV2` | `src/rc2-rc1-transfer-front-end.mjs:423` | transfer front-end test | 3／3 |
| `compileSchedulabilityGraphV2` | `src/schedulability-compiler-v2.mjs:271` | v2 characterization／contracts／front-ends | 8／8 |
| `verifySchedulabilityPlanV2` | `src/schedulability-verifier-v2.mjs:290` | v2 contracts／front-ends | 9／9 |
| `runRc2DeliveryPolicyOracle` | `src/rc2-delivery-policy-oracle.mjs:88` | fixture／transform／mutation | 7／6 |

RC2-Gはこれらをcallerとして追加するが、既存moduleを変更しない。したがってfocused gateは新campaign testを中心にし、既存dependency
testsのrelated集合はcampaign TODO完了候補で一回、full regressionはRC2-Hで一回だけ実行する。既存moduleを変更する場合はこの判断を開き直す。

## Unknownと非Codegraph evidence

1. planned exports／pathsは未存在で、post-source caller／callee／impact／affected relationを未観測。
2. disposable worktreeがrunごとに独立したこと、accepted patchのexact replay、fresh `.codegraph` lifecycleは構造indexだけでは証明できない。
3. fixed oracle byte identity、pre／post behavior、mutation sensitivity、minimum optimality、artifact byte integrity、atomic renameはCodegraphの証明範囲外。

1はcharacterization／production source後postflight、2はrun measurement／source invariant／cleanup、3はoracle／mutation matrix／independent
verifier／artifact manifestで閉じる。empty、absent、affected 0をsemantic independenceへ丸めない。

- test: 未実行。source／testをまだ変更していないpreflightである。
- full CI: 未実行。RC2-Hへ集約する。
- dotagents／Observer関連repo write、remote作成、push、publish: 0。
