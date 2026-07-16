# RC2 Codegraph and RC1 v6 compatibility baseline

- 日付: 2026-07-16
- Control: `lattice-rc2-bounded-graph-v1` revision 5
- Task: `RC2-B0-codegraph-v6-compatibility-baseline`
- HEAD: `422e7f0ad9ada18c3440b2ceb9407b16462a3458`
- source tree: `5129b4625890138f14f28af97cddf655e7233e08`
- test tree: `1377f5d57186869750bc386a360796bb6fc1cd8b`
- workspace: tracked／untracked status empty

## Codegraph status

Latticeの正規Codegraph 1.4.1 indexをread-onlyで照合した。

| field | value |
|---|---:|
| state | `complete` |
| files | 55 |
| nodes | 1286 |
| edges | 4895 |
| pending refs | 0 |
| pending added／modified／removed | 0／0／0 |
| worktree mismatch | `null` |
| DB SHA-256（diagnostic） | `f32d0ca4562230d21e231f8c81d5dac64d4f03926258762a0639eedb4658f50d` |

absolute project／index path、index時刻、DB bytesはdiagnosticであり、RC2 plan identityへ入れない。

## Existing owned symbols and impact

### `validatePlanGraph`

- owned symbol: `src/artifact-contracts.mjs:593-670`
- direct callers: `compilePlan`（boundary／control／treatment）、`assertCandidateInputs`、`assertBundle`、
  `storedCompilation`、`verifyRc1V6CampaignArtifactSet`と関連test file、合計20 records。
- direct callees: `validateSafely`、`exactRecord`、identifier／digest／integer／array helpers、`planNode`、`planEdge`、
  `planJoin`、`resourceKey`の12 symbols。
- impact depth 2: 37 nodes／51 edges。

### `compileBoundaryCondition`

- owned symbol: `src/boundary-compiler.mjs:652-712`
- direct callers: RC1 v4／v5 campaign、v5 artifact replay、v6 measurement、boundary characterization／unit test。
- direct callees: input validators、surface resolver、manifest／verdict／plan compilers、digest／contract constantsの20 symbols。
- impact depth 2: 28 nodes／32 edges。RC1 v4〜v6 campaign／artifact replayへ到達する。

### `verifyRc1V6ArtifactsOnDisk`

- owned symbol: `src/rc1-v6-campaign.mjs:591-623`
- direct caller: `test/rc1-v6-campaign.test.mjs`。
- direct callees: exact input／canonical JSON、v6 exact paths、`verifyRc1V6CampaignArtifactSet`、artifact root。
- impact depth 2: 2 nodes／1 edge。

4 legacy files（`artifact-contracts`、`boundary-compiler`、`rc1-v6-campaign`、`rc1-v6-artifact-set`）をchanged setとして
`affected`へ渡すと、20 testが返り、45 dependentsを走査した。したがってRC2はこれらを編集せず、新しいv2 contract／coreへ加算する。

## Planned v2 paths are unknown, not independent

exact adapter outcomeは次のとおりだった。

| target | query | callers／callees／impact | affected |
|---|---|---|---|
| `compileSchedulabilityGraphV2` | `symbol_absent` | 全て`symbol_absent` | new source pathは`empty` |
| `validatePlanGraphV2` | fuzzy candidateはv1だけ、exactは`symbol_absent` | 全て`symbol_absent` | new contract pathは`empty` |
| delivery registry fixture entry | `symbol_absent` | 未作成 | new fixture pathは`empty` |
| RC2 characterization test | 未作成 | 未作成 | 自身だけ`ready` |

4 new pathsを一括したaffected outcomeは`unresolved`だった。各source pathの`empty`は「依存なし」ではなく、indexにnodeもedgeも
存在しないbootstrap unknownである。characterizationを先行し、new source作成後にfresh indexしてowned symbol、caller／callee、
impact、affected testを再確認するまでindependenceを宣言しない。

## RC1 v6 focused compatibility verification

committed `research/campaigns/rc1/artifacts/v6`を正規disk verifierへ渡した。保存compiler bytesは実行していない。

```text
schema: lattice.rc1.artifact_set_verification.v6
valid: true
checks: 12 passed / 0 failed
```

passed checks:

1. `exact_artifact_set`
2. `identity_source_binding`
3. `input_identity`
4. `behavior_artifact_set`
5. `evidence_campaign`
6. `compiler_replay`
7. `transform_binding`
8. `plan_diff_binding`
9. `comparison_binding`
10. `hypothesis_evaluation`
11. `execution_evidence`
12. `result_binding`

artifact manifest SHA-256は`f5a8ed74711b9d3e0f2cd6992a303090c737ff3b44f1ad583c81d20b51f333a2`。
この12-check resultをRC2実装後の互換controlとする。

## Verification classification

- `focused`: RC1 v6 disk replay 12 pass／0 fail。
- `related`: 未実行。source／test変更なし。
- `full`: 未実行。直近97 pass baselineを再利用し、RC2 Phase gateへ集約する。
- Codegraph mutation: 未実行。current complete indexをread-only照合した。
- Lattice外write、remote、push、publish: 0。
