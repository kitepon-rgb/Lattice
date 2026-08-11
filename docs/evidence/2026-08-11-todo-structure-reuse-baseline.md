# ToDo構造グラフ — 既存機構の再利用baseline

- Date: 2026-08-11
- Task: sg01
- Commit baseline: `de606019efd4917dff48329d78305765db3f6a7d`
- Node: `v26.7.0`（package enginesの受理範囲）
- Scope: characterization、固定fixture、およびbaselineで再現したstore安定読取り競合の最小修理

## 再利用対応

| 能力 | 実在する正本 | 実測した既存test／入口 | 新機能側の差分 |
|---|---|---|---|
| exact contract／digest | `src/todo-contracts.mjs`: `exactRecord`、`canonicalizeTodoArtifact`、`todoSelfDigest` | `todo-independence-contracts.test.mjs` | structure固有shapeだけを追加する |
| source query／portable evidence | `src/sensor-adapter.mjs`: `collectSensorEvidence`、`portableSensorOutcome` | `todo-independence-compile.test.mjs` | anchor→既存queryのadapterだけ |
| source node／edge差分 | `src/sensor-diff.mjs`: `compareSensorIndexes` | `sensor-diff.test.mjs` 15件 | result→provenance/finding projectionだけ |
| boundary normalize／unknown | `compileRuntimePlanV1`→`compileBoundaryObservationV2`→`compileSchedulabilityGraphV2` | independence compile正負 | 同じresource identityとunknownを受け取る |
| ToDo ready／状態 | `readTodoStore`、`computeReadyFrontier`、`projectTodoStatus` | `todo-status.test.mjs` | structure対象taskを選ぶ |
| DAG／cycle／依存鎖 | `projectTodoChainV1`、`analyzeDagChains`、store merged cycle | `todo-chain.test.mjs`、`todo-store.test.mjs` | port edgeを既存node refへ写すadapterだけ |
| linear hash chain | `src/hash-chain.mjs`: `verifyLinearHashChain`、`digestWithoutField` | task／plan note store | realization event validatorとfile ownershipだけ |
| Git process／object batch | `src/git-process.mjs` | todo evidence／migration／independence | commit rangeのstructure projectionだけ |
| artifact freshness | independence artifact read/writeと`projectIndependenceFrontier` | independence compile/store | structure identity fieldsとfindingだけ |
| CLI／guidance | `todo-cli.mjs`、`todo-independence-guidance.mjs`、`cli-help.mjs` | todo CLI/help tests | structure namespaceとtyped codeだけ |
| dashboard | todo Gantt live／presentation／SVG | Ganttの既存test群 | 工程依存と分離したstructure viewだけ |

## 再実装禁止の結論

次は既に実在し、今回の新しい正本を作らない。

- parser、index、file／symbol node、call／import／reference edge
- base/currentの自然キー差分とcomparability
- boundary resourceとunknownの正規化
- ToDo DAG、cycle、最長依存鎖
- linear hash chain
- Git subprocessのplatform差吸収
- canonical serialization、self digest
- artifactのmissing／stale／superseded語彙

新設範囲は、structure input contract、既存graphへのoverlay adapter、data contract固有finding、
planned→realized projection、task／terminal gateだけである。

## baseline結果

最初のfocused実行は141件中126件green、`sensor-diff.test.mjs`の15件が全て
`sensor/dist/bin/lattice-sensor.js`不在で停止した。専用worktreeはgit非追跡のbuild済みsensorを持たないためで、
製品挙動の失敗ではない。元Lattice作業木の同じbuild済み`sensor/dist`をworktreeへsymlinkして、落ちた15件を
再実行し15/15 greenを確認した。

次の再実行では`todo-store.test.mjs`の書込み中一時窓testが単独でも失敗した。原因は
`readTodoStoreStable`が同じmanifest digestを2回観測した時点で恒久破損と決め、5ms後に完了するwriterを
待たずに返したことである。一時窓と恒久的な千切れは同じ観測になるため、対象2 reasonだけattempt上限まで待ち、
閉じなければ最後の具体的な`STORE_INCONSISTENT`を返すよう修理した。一時窓と恒久破損の組を5回連続で通した。

最終baselineは次の17ファイル、254件を実行し254/254 greenだった。

- `todo-cli.test.mjs`、`todo-cli-schema-command.test.mjs`
- `todo-migration.test.mjs`
- `todo-phase-baseline.test.mjs`、`todo-phase-definitions.test.mjs`、`todo-phase-revision-v3.test.mjs`
- `todo-start-retract.test.mjs`
- `todo-independence-contracts.test.mjs`、`todo-independence-compile.test.mjs`
- `todo-independence-store.test.mjs`、`todo-independence-witness.test.mjs`
- `sensor-diff.test.mjs`
- `todo-chain.test.mjs`、`todo-status.test.mjs`、`todo-store.test.mjs`
- `todo-structure-fixture.test.mjs`

この実測には、未適用planのcreate／migrate／status／show／start／done／phase accept互換面、independenceの
witness／artifact／鮮度、sensor exact解決、Git差分利用面が含まれる。

greenを確認した再利用面:

- `todo-independence-contracts.test.mjs`
- `todo-independence-compile.test.mjs`
- `todo-chain.test.mjs`
- `todo-status.test.mjs`
- `todo-store.test.mjs`
- `sensor-diff.test.mjs`（build済みsensor供給後）

fixtureの正本は次である。

- `test/fixtures/todo-structure/peertable-logical-dataflow-v0.json`
- `test/fixtures/todo-structure/structure-scenarios-v0.json`
- `test/todo-structure-fixture.test.mjs`
