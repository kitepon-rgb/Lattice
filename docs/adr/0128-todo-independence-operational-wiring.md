# ADR 0128 — 独立性判定を着手・追従・分類へ配線する

- Status: Accepted
- Date: 2026-07-26
- Extends: [ADR 0127](0127-todo-independence-projection.md)（独立性の記録面）
- Relates: [ADR 0063](0063-ready-frontier-dispatch-contract.md)（ready frontier dispatch契約）・
  [ADR 0056](0056-todo-authoring-transitions.md)（authoring transition結果契約）・
  [ADR 0009](0009-rc1-control-boundary-compile-accepted.md)（RC1 boundary compileのseam分類）

## Context

ADR 0127で並列可能性の記録面ができた。しかし記録は運用へ配線されておらず、
実測（Lattice 0.12.34、実storeでのdogfood）で次が分かった。

- **着手する瞬間に何も伝わらない。** `todo start`が見るのはADR 0063のready frontier gateだけで、
  それは`active_set.length === 0`のときにしか発火しない（`src/todo-cli.mjs`の`startTask`）。
  すでにactiveなToDoがある状態での着手——最も競合しやすい場面——はplain startで素通りする。
  記録済みconflictがあっても止まらないどころか、何も告げない。
- **記録がすぐstaleになる。** 鮮度判定が`base_sha`の一致だけなので、宣言境界と無関係なcommitでも
  全taskの記録が一斉に未検査へ落ちる。実際にこのcampaignのdogfoodで、docs追記のcommit1本で
  verifiedがstaleになった。運用が進むほど「常に未検査」に漸近し、伝える中身が消える。
- **revisionで宣言が置き去りになる。** plan改訂でtask_idが写像されplan versionも変わるが、
  `.lattice/todo/witness/`の宣言は古いtask_idのまま残る。移行させる機構が無い。
- **conflictの切断可能性を判別していない。** artifactの`conflicts`は`{task_ids, resource_id}`だけで、
  その衝突がcode seamで切れるのか共有状態ゆえ直列必須なのかを区別しない。製品思想は
  「conflictにseamがあればrefactorを候補化する」だが、その入口となる分類が記録に無い。

分類が投影側でできない理由も実測で確定した。normalized bundleの`resources`はkind
（symbol／path／state／effect／dynamic）を持つが、`bundle.graph.conflicts`は`{todo_ids, resource_id}`
だけでkindを落としている。resource_idからの復元も不可能で、宣言由来のstate resourceは
witnessが与えた任意のidentifierになる（`own-symbol-*`／`own-path-*`／`rw-*`のようなprefix規則が無い）。
witness setは読み出し時に手元に無く、読みに行けばADR 0127の「参照時にsensorを引かない・定数コスト」
規律を破る。したがってkindはcompile時にartifactへ焼き込むしかない。

## Decision

1. **`lattice.todo_independence.v2`へ上げ、conflictにkindとtask別の宣言境界を持たせる。**
   `conflicts`エントリを`{task_ids, resource_id, kind}`とし、kindは`symbol`／`path`／`state`／`effect`。
   供給は`compileRuntimePlanV1`の戻り値へnormalized bundleの`resources`を加算露出して行い、
   compile時にresource_id→kindを引く。引けない場合はartifactへ書かずtyped failにする。
   併せて`task_boundaries`（task別に owns の path・writes・reads・affected_tests・
   sensor query expectのpath を集めたsorted集合）を持たせ、鮮度判定をartifactとgit diffだけで
   閉じられるようにする。v1ファイルはtyped failにする。artifactはgit非追跡のlocal投影であり
   再生成が正規経路なので、移行機構は作らない。

2. **切断可能性は投影側で導出する。** kindが`symbol`／`path`なら`code_seam`、`state`／`effect`なら
   `serial`、precedenceは常に`serial`とする。RC1 boundary compilerの分類規則
   （`src/boundary-compiler.mjs`、共有state／effect conflictはcode seamでは切断できない）と同一にする。
   read×write交差から実体化される`rw-*` resourceはkind=`state`なので`serial`へ倒れる。
   これはseam候補を見逃す方向にしか外れない保守的な誤りであり、既知の限界として受け入れる。

3. **`lattice.todo_independence_projection.v2`へ上げ、activeとの競合を投影する。**
   投影入力へactive task集合を加え、conflict／precedenceの交差判定を ready ∪ active で行う。
   v1は両端がready集合のペアだけを採っており、片端がactiveのペアを黙って捨てていた。
   `frontier.conflicts_with_active`を新設し、`serialize_pairs`へkindと切断可能性を載せる。
   宣言のないactive taskは`uncovered_active_task_ids`として別に示す——
   「競合が無い」と「競合を判定できない」を同じ空配列で表現しない。

4. **鮮度はtask単位の事実として扱う。** `coverage`は従来の4値のまま
   （sha水準の事実を述べる面として保つ）とし、`drift`補助fieldを足す。
   `base_sha..HEAD`の変更path集合と`task_boundaries`を突き合わせ、**交差したtaskだけ**を
   未検査へ落とす。交差しなかったtaskは、HEADが進んでいても宣言相対では観測が変わらないため
   verified独立の主張を維持する。判定の健全性は「verdictは宣言とbase_shaでのsensor観測の関数であり、
   宣言境界に触れないdiffは観測を変えない」ことによる。
   `base_sha`がgit historyから到達不能な場合（rebase・shallow等）は全task交差扱いにする。
   これは諦めではなく、差分を確定できないという事実に対する唯一の保守側の答えである。
   交差はtask単位の事実なので、スカラーの`coverage`へ5値目を足して表現しない。

5. **`lattice.todo_mutation_result.v2`へ上げ、着手時に助言を返す。**
   `advisory` fieldを追加し、`todo start`では
   `{coverage, drift_intersecting, conflicts_with_active, uncovered_active_task_ids, self_unknowns}`を、
   他5つのmutation（block／unblock／done／reopen／evidence promote）では`null`を返す。
   ADR 0056のexact-key規律に従い、fieldの追加はversion上げで行う。
   **advisoryは助言であって拒否ではない。** ADR 0063のdispatch契約（何を拒否するか）は変えない。
   ただしadvisoryを計算できない状況——git HEADが読めない等——はsilent degradeせず、
   journalへ書く前にstart自体をtyped errorで止める。曖昧な成功として通さない。

6. **witness宣言の移行はコマンドで明示的に行う。** `todo independence witness migrate --plan <key>`が
   active版revisionの`task_migration`を読み、宣言のtask_idを写像する（from→to、`removed`は削除、冪等）。
   解決できないIDはfail closedにする。宣言内容が改訂後も意味的に妥当かは機械には判定できないため、
   このコマンドはid写像だけを担い、妥当性を主張しない。
   witness fileのpath規約`.lattice/todo/witness/<plan_key>.json`を運用文書からコードの所有へ移す
   （`todoWitnessRef`、`todoIndependenceRef`の対称物）。
   このコマンドはcompileせず証拠を固定化しないため、dirty worktreeを拒否しない。
   想定運用は「移行 → commit → cleanな状態でcompile」である。

## 非目標

- **dispatch gate。** conflict／unknownの同時起動を機械拒否することはADR 0063 Decision 3-4の
  改訂を伴う。判定運用が回り、未検査が実際に減ってから別ADRで決める。本ADRのadvisoryは
  拒否しないため、この線を越えない。
- **seam提案の生成と実変換。** 切断可能性の分類までを本ADRの範囲とし、
  「どう分割すれば並列化できるか」の候補生成はRC1の2件固定ロジックの汎用化を伴うため次段。
- **revision直後のcoverage意味論の変更。** artifactはplan versionディレクトリに置かれ、
  読み出しはactive versionのpathしか見ないため、revision直後は`superseded`ではなく`missing`になる。
  これは「新しいversionについてはまだ何も判定していない」という正確な記述であり、変えない。
- **`todo_status_result.v4`と`dispatch_frontier`の変更。** 製品契約どおり不変とする。
- **witness宣言の自動導出。**

## Consequences

- 着手する瞬間に、activeとの競合・未検査・自分自身のunknownが機械可読で手に入る。
  hostは拒否されないまま、subsetを選ぶ根拠と、選ばなかった場合のリスクを同時に得る。
- 宣言境界と無関係なcommitで記録が失効しなくなる。運用が進むほど未検査へ漸近する挙動が止まり、
  柱としての助言が実質を持ち続ける。
- conflictが「コードを分割すれば並列化しうるもの」と「共有状態ゆえ直列必須なもの」に分かれて見える。
  seam refactorの候補生成（次段）はこの分類を入口にできる。
- artifact v2はv1と非互換であり、既存のlocal記録は再compileが必要になる。
  git非追跡なのでhost間の調整は発生しない。
- mutation result v2は6コマンド共通のwire変更である。v1を読む既存hostは更新が必要になる。
