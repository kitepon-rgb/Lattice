# ToDo並列作業可能性の記録面（independence projection）

工程の正本はLattice store（plan key `todo-independence-projection`）である。本書は目的・思想・判断理由・
非目標・受入条件を所有し、ToDoの状態と依存は持たない。現在地は`lattice todo status --json`で読む。

## Context

Lattice工程表の横並びと`dispatch_frontier`の`all_ready_parallel_by_default`（ADR 0063）は、
**依存が申告されていないこと**をそのまま並列可として提示している。依存edgeの不在が意味するのは
順序制約の無申告であって、書き込み境界の非干渉ではない。両者は別概念である。

製品思想としてはこの区別を持っている。AGENTS.md「TODO境界compile」はdispatch前のboundary manifestを
要求し、`docs/00_product-contract.md`は競合検出とseam-refactorを製品scopeに置く。判定機構も実在する
（`compileRuntimePlanV1` → `compileBoundaryObservationV2` → `compileSchedulabilityGraphV2`、ToDo 256件まで）。

欠けているのは判定結果の置き場である。`lattice.todo_plan.v5`のtaskは`compile_binding`を持つが、実plan
`phase-control-live-gantt`の35 taskで設定済みは0件だった。境界調査はセッションごとに行われ、結果は
storeに残らず揮発する。次のセッションは同じ調査をやり直すか、横並びを無検査で信じるかのどちらかになる。

## 設計判断

1. **判定結果はplan並置の加算artifactに置く**（plan schema v6にしない）。判定はコード状態についての
   証拠であってtopologyではない。コード変更のたびに`plan_digest`が変わるのは筋が悪く、revisionは
   plan version単位の全置換であるため運用に耐えない。ADR 0124が確立した「v4不変・加算の別面」に沿う。
2. **宣言は入力artifact `lattice.todo_witness_set.v1`**とする。ToDoごとのowns／reads／writes／state_effects
   ／sensor_provenance／affected_testsを`run_request.v1`の`manual_witness`と同形で宣言する。ToDo説明文からの
   自動導出は存在しないため、宣言はauthoring時の1回コストとして人またはエージェントが負う。
   宣言欠落taskはcompile時にunknownとして顕在化させ、verifiedへ丸めない。
3. **鮮度キーは`(plan_version, topology_digest, base_sha)`**とする。読み出し時はHEADとの照合だけで
   `verified`／`stale`／`superseded`／`missing`をtypedに区別する。dirty worktreeでのcompileは拒否し、
   観測を証拠として固定しない。
4. **conflict／unknownはgraph層から採る**。`compileSchedulabilityGraphV2`はunknownが1件でもあると
   `outcome:'unknown'`を返し`pairwise_verdicts`を返さない。段階導入では常にunknownとなるため、
   normalized bundleのgraph（conflicts／precedences／unknowns）を直接写像し、task単位の粒度を保つ。
   wave planは`outcome:'compiled'`のときだけ記録する。
5. **読み出しは新しい読取サブコマンドを加算する**。`lattice.todo_status_result.v4`と`dispatch_frontier`は
   変更しない。ready frontierを「検証済み並列グループ」「直列化すべき組」「未検査」に分けて一望させる。

## 非目標

- Gantt表示への反映。projectionをpure functionとして用意するところまでを本計画とし、layout／htmlと
  `TODO_GANTT_RENDERER_VERSION`には触れない。次段で別途設計する。
- dispatch gate。`start --parallel-frontier`でconflict／unknownの同時起動を機械拒否することは、
  ADR 0063の改訂を伴うため判定運用が回り始めてから別ADRで決める。
- witness宣言の自動導出（ToDo説明文からowns／reads／writesを生成すること）。

## 受入条件

- 未検査（unknown）と検証済み独立（verified）が公開面で区別できる。区別できない出力をverifiedへ丸めない。
- 参照時にsensor照会を発生させない。読み出しはstore済みartifactとHEAD照合だけで閉じる。
- 各工程が独立revert可能で、focused testと`npm run check`が通る。
- 実repoの`phase-control-live-gantt`に対して1回compileし、一望出力を実物で確認する。

## 工程

正本はLattice store。以下は各ToDoが何を成すかの散文であり、状態と依存はstoreが持つ。

- `tip-001` ADR 0127を起票する。並置artifact採用・witness set入力・鮮度キーとcoverage意味論・CLI 2面・v4不変・非目標を決定として固定する。
- `tip-002` 契約module `src/todo-independence-contracts.mjs`を置く。witness set／independence／projectionのexact shape検証と自己digestを所有し、既存`todo-contracts.mjs`には触れない。
- `tip-003` compileパイプライン `src/todo-independence.mjs`を置く。witness setから`run_request.v1`を合成し、`compileRuntimePlanV1`をlibraryとして再利用し、graph層のconflict／unknownをartifactへ写像する。
- `tip-004` store APIを`todo-store.mjs`へ加算する。`.write.lock`下でplan_versionとtopology_digestを照合してatomicWriteし、破損はfail closedで返す。
- `tip-005` ready判定を単一正本化する。`todo-status.mjs`の計算を`computeReadyFrontier`として切り出し、status v4の出力バイト列が不変であることをcharacterization testで固定する。
- `tip-006` CLI 2面を追加する。`todo independence compile`と`todo independence`を加算し、help・公開契約のCLI列挙へ追記する。
