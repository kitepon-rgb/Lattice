# ADR 0127 — ToDoの並列作業可能性を記録し公開投影する

- Status: Accepted
- Date: 2026-07-26
- Extends: [ADR 0124](0124-todo-binding-projection.md)（加算の別面という規律）
- Relates: [ADR 0063](0063-ready-frontier-dispatch-contract.md)（ready frontier dispatch契約）・
  [ADR 0053](0053-todo-store-and-gantt-surface.md)（TODO工程store面）・
  [ADR 0032](0032-rc2-bounded-graph-compiler-and-three-way-seam.md)（bounded graph compiler）

## Context

依存edgeの不在と並列作業の可能性は別概念である。前者は順序制約が申告されていないことを言い、
後者は書き込み境界が干渉しないことを要求する。同じファイルを書く2つのToDoは互いの成果を入力に
しないため依存edgeを持たないが、同時にdispatchすれば衝突する。

現状の公開面はこの区別を持たない。`todo_status_result.v4`の`dispatch_frontier`は
`policy: 'all_ready_parallel_by_default'`を無条件に主張し（ADR 0063）、Ganttは依存edgeを持たない
ToDoを`independent`として同一段へ並べる。いずれも根拠は「edgeが無いこと」だけであり、
境界の非干渉を検査していない。

判定機構は実在する。`compileRuntimePlanV1`（`src/runtime-front-end.mjs`）が
`manual_witness`とsensor evidenceからobservation setを組み、`compileBoundaryObservationV2`が
resource単位のconflict graphへ正規化し、`compileSchedulabilityGraphV2`が最小wave planを出す。
ToDo 256件までの汎用経路であり、RC1専用の`compileBoundaryCondition`（TODO 2件固定）とは別物である。

欠けているのは判定結果の置き場である。実測（Lattice 0.12.34）で分かったのは次のとおり。

- `lattice.todo_plan.v5`のtaskは`compile_binding`を持つが、実plan`phase-control-live-gantt`の
  35 taskで設定済みは0件だった。器はあるが一度も使われていない。
- todo storeは対象repoのcommitもsensor index versionも記録していない。判定の鮮度を表す既存キーは
  task単位の`compile_binding.base_sha`だけである。
- boundary compile経路はrc1／rc2 campaignからしか呼ばれておらず、todo storeへ配線されていない。

結果として境界調査はセッションごとに行われ、結果は会話の中で消費されて揮発する。
次のセッションは同じsensor照会をやり直すか、検査せずに横並びを信じるかのどちらかになる。

## Decision

1. **判定結果はplanに並置する加算artifactとして記録する。** `lattice.todo_independence.v1`を
   `.lattice/todo/plans/<plan_key>/<plan_version>/independence.json`へwell-known名で置く。
   plan schemaは上げず、manifestにも登録しない。判定はコード状態についての証拠であってtopologyでは
   ないため、`plan_digest`と`topology_digest`の意味を汚さない。plan versionディレクトリに置くことで、
   revisionでversionが変われば旧artifactは自然に非アクティブになる。

2. **宣言は入力artifact `lattice.todo_witness_set.v1`として持つ。** ToDoごとの
   owns／reads／writes／resources／state_effects／sensor_provenance／affected_tests／unknownsを
   `run_request.v1`の`manual_witness`と同形で宣言し、`sensor_query_set`を同梱する。
   ToDo説明文からowns／writesを自動導出する機構は作らない。宣言はauthoring時の1回コストとする。

3. **鮮度キーは`(plan_version, topology_digest, base_sha)`とする。** 読み出し時はHEADとの照合だけで
   `verified`／`stale`／`superseded`／`missing`をtypedに区別する。sensor照会は読み出し時に行わない。
   dirty worktreeでのcompileは拒否する。未commitの観測を検証済み証拠として固定化しない。

4. **compileは宣言済みtaskの部分集合に閉じる。** `compileSchedulabilityGraphV2`はunknownが
   1件でもあると`outcome:'unknown'`を返し`pairwise_verdicts`を返さず、`compileRuntimePlanV1`は
   その経路でgraphを露出しない。宣言の無いtaskをcompileへ入れると、宣言済みtask同士の
   判定まで巻き添えで失われる。したがってartifactの`task_ids`はwitness setが宣言したtaskだけとし、
   plan上の未宣言taskはcompileへ入れず、読み出し時に`witness_missing`として提示する。
   部分集合がcompiledなら`pairwise_verdicts`からconflictとprecedenceを、planからwave planを写す。
   宣言済みtaskにunknownが残るときはunknownをtask単位で記録し、wave planを持たず、
   その部分集合のどのペアもverified独立として読ませない。

5. **読み出しは新しい読取サブコマンドを加算する。** `lattice todo independence`が
   `lattice.todo_independence_projection.v1`を返し、ready frontierを
   `parallel_groups`（検証済み独立）・`serialize_pairs`（conflict／precedence）・`unknown`（未検査）
   に分けて投影する。`todo_status_result.v4`と`dispatch_frontier`は変更しない。
   compileは`lattice todo independence compile --plan <key> --input <ref>`が所有する。

6. **verdictに現れないペアをverified独立とみなすのは、両ToDoにunknownが無いときだけとする。**
   ペア状態を全列挙して保存しない。未検査と検証済み独立を同じ「conflictが無い」で表現しない。

## 非目標

- **Gantt表示への反映。** projectionはpure functionとして用意するが、layout／htmlと
  `TODO_GANTT_RENDERER_VERSION`には触れない。次段の接ぎ木先は`src/todo-gantt-layout.mjs`の
  node projection（`visibility`と並ぶ位置）である。ADR 0068の非交差gateへ影響するため別に決める。
- **dispatch gate。** `start --parallel-frontier`でconflict／unknownの同時起動を機械拒否することは
  ADR 0063の契約改訂を伴う。判定運用が回り、未検査が実際に減ってから別ADRで決める。
- **`compile_binding`の書込口の新設。** 本ADRのartifactは`compile_binding`と別物であり、
  ADR 0124の投影規律を変えない。
- **`boundary-compiler.mjs`の再利用。** TODO 2件固定・candidate spec必須のRC1実験専用経路であり、
  汎用判定には使わない。

## Consequences

- 「検証済み独立」と「未検査」が公開面で区別できるようになる。`dispatch_frontier`が
  無条件に主張していた並列可を、証拠のある主張と無申告とに分けて読めるようになる。
- 参照コストが定数になる。読み出しはstore済みartifactとHEAD照合だけで閉じ、sensor照会を発生させない。
  境界調査を毎セッションやり直す必要がなくなる。
- witness宣言が新しい人手コストとして発生する。宣言のないToDoはunknownとして顕在化し、
  verifiedへ丸められない。段階導入が可能で、宣言を書いたToDoから順にverifiedへ移る。
- 判定はコード状態に紐付くため、HEADが進めば`stale`へ落ちる。再compileの契機が機械的に決まる。
