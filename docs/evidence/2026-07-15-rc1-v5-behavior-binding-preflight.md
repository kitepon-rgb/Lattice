# RC1 v5 behavior-binding characterization preflight

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v5` / RC1-N
- Control: `lattice-rc1-closed-loop-v3` revision 86
- HEAD: `a89a9573ada3d5b93d4186229088d541a016e603`
- writer scope: Latticeのみ

## Codegraph readiness

`codegraph status . --json`はinitialized、Codegraph 1.4.1、39 files、752 nodes、2,890 edges、
pending added／modified／removedすべて0、worktree mismatchなし、index state `complete`、pending refs 0、
reindex recommended falseを返した。docs-only HEAD更新後もindexed sourceにpending changeはなく、preflightを継続した。

## Existing owned symbols

| symbol | owned path／line | caller | callee要約 | impact | affected tests |
|---|---|---|---|---:|---|
| `evaluateRc1Hypothesis` | `src/rc1-comparison.mjs:38` | `runRc1V4Campaign`、comparison／v4 characterization tests | canonicalizer、summary、same-artifact、required invalidations | 7 nodes／11 edges | comparison、v4 campaign、v4 characterizationの3件 |
| `runRc1BlackBoxOracle` | `src/rc1-black-box-oracle.mjs:157` | `runRc1V4SeamTransform`、oracle／v4 characterization tests | oracle validator、entrypoint resolution、SHA-256、case observation、artifact digest | 8 nodes／11 edges | oracle、v4 campaign、v4 characterization、v4 transformの4件 |
| `runRc1V4SeamTransform` | `src/rc1-v4-transform.mjs:359` | `runRc1V4Campaign`、v4 transform test | isolation runner、v4 oracle、output artifact、receipt、transform validator | 6 nodes／10 edges | v4 campaign、v4 transformの2件 |
| `runRc1V4Campaign` | `src/rc1-v4-campaign.mjs:472` | v4 campaign integration／unit test | fresh index、single compiler、v4 transform、comparison、v4 evaluator | 3 nodes／4 edges | v4 campaign 1件 |
| `writeRc1V4Artifacts` | `src/rc1-v4-campaign.mjs:643` | v4 campaign integration／unit test | evidence campaign validator、artifact files、digest、atomic writer | 3 nodes／4 edges | v4 campaign 1件 |

path単位の`codegraph affected`も同じtest集合を返した。今回のRC1-Nではこれら既存sourceを編集せず、
v4 artifact-only反例のread-only入力として使う。

## Planned symbols and unknowns

| planned surface | raw result | typed interpretation |
|---|---|---|
| `compileRc1V5BehaviorEvidence` | query `[]`、caller／callee／impactは`Symbol ... not found` | `planned_symbol_absent`。依存なしではない |
| `evaluateRc1V5Hypothesis` | queryが`evaluateRc1Hypothesis`を返し、caller／callee／impactもv4 symbolへ解決 | node name不一致のfuzzy hit。`planned_symbol_unknown` |
| `runRc1V5BlackBoxOracle` | queryが`runRc1BlackBoxOracle`を返し、caller／callee／impactもv4 symbolへ解決 | node name不一致のfuzzy hit。`planned_symbol_unknown` |
| `src/rc1-v5-behavior-evidence.mjs` | affected tests `[]`、traversed 0 | 未index path。依存なしではなく`new_path_unknown` |
| `test/rc1-v5-behavior-evidence.test.mjs` | affected testとしてplanned file自身、traversed 0 | planned focused gate。production impact証明ではない |

raw Codegraph CLIのfuzzy queryは近い既存名を返すため、non-empty resultをexact ownershipへ丸めない。
実装laneで新規sourceを作った後は再indexし、exact node name／pathを照合してから次のsource編集へ進む。

## RC1-N write boundary

今回のsource editは新規`test/rc1-v5-behavior-evidence.test.mjs`だけである。既存`src/`、fixture、input、
`research/campaigns/rc1/artifacts/v4`は変更しない。testは次を先に固定する。

1. 現v4 comparison evaluatorがpost receipt再利用を識別できずsupportを維持する反例。
2. v5 full receiptのrole、base SHA、oracle、entrypoint content、surface snapshotのexact shape。
3. full pre／post receipt、transform artifact、patchをcross-bindするbehavior envelope。
4. artifact-only v5 evaluatorがpost→pre差替えとsingle-field corruptionをrejectする契約。

focused testはv4反例の再現をpassさせ、未実装v5 module importまたは未実装contractでexpected redにする。
expected redをgreenへ丸めず、failure reasonを保存してからsafety-netだけをcommitする。

## Expected-red result

- syntax: `node --check test/rc1-v5-behavior-evidence.test.mjs` — green
- focused: `node --test test/rc1-v5-behavior-evidence.test.mjs`
- result: 2 tests / 1 pass / 1 fail / 0 skip / 0 todo
- pass: v4保存artifactでpostへpre receiptを再利用しても15条件がsupportを維持する反例
- expected fail: `ERR_MODULE_NOT_FOUND` for `src/rc1-v5-behavior-evidence.mjs`

未実装moduleによるfailはv5契約を満たした証拠ではない。test本文はvalid envelope、post→pre差替え、role、base、oracle、
entrypoint content、surface、observation drift、patch、transform artifact、manifest payload欠落、payload byte改変の期待結果を固定した。
実装laneではこの同じfocused入口をfailure scopeとして収束させる。

## Writer boundary

LatticeのCodegraphとsource／artifactをread-only参照し、本evidenceとplanned testだけをwrite対象にする。
dotagentsはControl CLIのread-only実行、Lattice `.git`内Control mutationに限定し、dotagents repoのfileは編集しない。
Observer関連repoは参照していない。remote作成、push、publishは行わない。
