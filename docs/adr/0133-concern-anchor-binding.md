# ADR 0133 — 係争資源内の担当concernを判定と切り離して宣言し、切断候補を束縛する

- Status: Accepted
- Date: 2026-07-27
- Relates: [ADR 0009](0009-rc1-control-boundary-compile-accepted.md)（RC1 boundary compile）・
  [ADR 0032](0032-rc2-bounded-graph-compiler-and-three-way-seam.md)（ownership discovery）・
  [ADR 0127](0127-todo-independence-projection.md)（witness宣言とcompile）・
  [ADR 0128](0128-todo-independence-operational-wiring.md)（severability）・
  [ADR 0132](0132-seam-proposal-read-only-surface.md)（提案面とtyped unknown。本ADRはそのOpen question 1を裁定する）

## Context

ADR 0132で提案面は実装されたが、初回の実データ実行はこのrepoの唯一の実conflictへ
`semantic_owner_binding_missing`を返した。`tio-009`が宣言した境界の全部が係争中のfile
そのもので、固有anchorを持たないためである。判定は正しいが、人はToDoのtitleを読めば分け方を
即断できる。**情報は存在するのに、typedな入口が無い**という状態だった。

既存の`owns`へsymbolを書いて代用する道は塞がっている。write交差の免除規則
（`src/runtime-front-end.mjs`）は「両者が同一pathを`owns`で主張している時だけ」交差を許すので、
ToDoがfile所有をやめてsymbol所有へ絞ると`writes`の交差が未解決になり、判定全体が
`BOUNDARY_UNKNOWN`へ落ちる。`owns`はwrite所有権の解決キーを兼ねており、担当concernを載せられない。

## Decision

### 1. 宣言は判定入力から構造的に落とす（`lattice.todo_witness_set.v2`）

witness setへ任意の`concern_anchors: [{within, symbols}]`を新設する。`within`はそのtask自身が
`owns`または`writes`で主張している資源に限り、触ると宣言していない資源の内側に担当を主張させない
（書き込み面への拡張は [ADR 0181](0181-authoring-entry-accepts-drafts.md)）。

宣言は並列可否の判定へ**写さない**。判定正本である合成`lattice.run_request.v1`を作る時点で
落とすので、宣言が誤っていてもconflictを作ることも消すこともできない。非影響をtestの主張でなく
合成の構造で保証する。ADR 0127の「宣言の誠実さが判定の上限」という性質を、宣言を増やすことで
これ以上前へ出さないための線である。誤った宣言が悪化させうるのは提案の質だけとする。

`concern_anchors`を持たない`lattice.todo_witness_set.v1`はそのまま受理し、既存宣言の書き換えを
要求しない。版を上げるのは、v1のclosed shapeが余分fieldを拒否する以上、加算互換が成立しないため
（ADR 0132 Decision 1と同じ理由）。旧CLIが新宣言を読んだ時に`/schema`で明示的に落ちる方が、
field名の`unexpected_or_missing_keys`より次の一歩が読める。

### 2. 宣言は機械が裏を取る。破れたら提案せずtyped unknownを返す

宣言symbolは、sensorが返した名前とpathのexact一致で解決した分だけanchorにする。
資源の外へ解決したもの、解決しなかったもの、資源自身が解決しなかったものを、それぞれ
`concern_anchor_outside_resource`／`concern_anchor_unresolved`／`concern_anchor_resource_unresolved`
として別々に返す。どれが起きたかを潰さない。

同じsymbolを2 task以上が主張したら、両者から落として`concern_anchor_overlap`を返す。片方を
勝たせない。勝たせれば宣言が重なった時に機械が黙って帰属を決めたことになり、判定の根拠が
宣言でなくなる。

### 3. 宣言anchorは同じskeleton内で粗いanchorに優先する

係争資源の中で触るsymbolを名指ししたToDoは、「どこかのfileを所有している」より厳密に具体的な
証拠を出している。よって宣言が当たったskeletonでは、`owns`／`writes`／`affected_tests`由来の
粗いanchorを束縛根拠へ混ぜない。粗いanchorのままだと、係争file内にconcernを持ちつつ別fileも
所有するToDoは必ず複数partitionに当たり`semantic_owner_binding_ambiguous`になる。

優先はskeleton局所で判断する。宣言が1つも当たらなかったskeletonでは粗いanchorへ戻すので、
ある競合へ宣言を書いたことが別の競合の束縛を潰さない。

### 4. path conflictの切断候補は宣言そのものから作る（`declared_partition`）

pathの競合には分割すべきcall graphが無い——sensorへはaffected testしか聞いていない。一方で
宣言は所有者ごとのsymbol分割そのものを与えるので、それをcut skeletonとして採る。

componentの全taskがそのpath内でsymbolを名指ししている時だけskeletonにする。片方でも欠けていれば
従来どおり`raw_graph_unavailable`を返す。片側の宣言から他方の担当を補完しない——ADR 0132 Decision 4の
「割り当てをcall graphから導出しない」と同じ理由で、残余からの推測も導出である。

宣言由来のskeletonも、提案後ownershipの検証（完全なvirtual witnessでの再compile、残余conflict 0）を
他のcut kindと同じ規則で通す。宣言は候補の**出所**であって、候補の**正しさの根拠**ではない。

## Consequences

このrepoの実conflict（`tio-008`/`tio-009`）で初めて`seam_candidate`が出た
（[docs/evidence/2026-07-27-concern-declaration-first-candidate.md](../evidence/2026-07-27-concern-declaration-first-candidate.md)）。
`src/todo-gantt-html.mjs`が2つの新pathへ分かれ、残余conflictは0である。

ただしそれは1 symbolを外した探りの宣言での結果であり、**正直な宣言では
`concern_anchor_unresolved` 1件で止まる**。`summarizeIndependence`が`src/todo-gantt-html.mjs`と
`src/project-cli.mjs`の2 fileに同名で存在し、名前だけでは単一pathへ絞れないためである。

提案は依然として構造証拠であり、意味的独立やbehavior preservationの証明ではない。実変換を
行っていないため、提案が実際に並列化を解放するかは未検証のままである。

## Open questions

1. **evidence receiptが候補pathを保持するか。** 裁定済み（ADR 0134 `candidate_paths`）。 `lattice.seam_proposal.v1`の
   `evidence.queries[]`は`resolved_path`を単数しか持てず、同名で複数pathの解決は`unknown`へ潰れる。
   `within`が指す資源で絞れば決まるのに、受け皿にその余地が無い。解くにはevidence契約の版上げが要る。
   実データで該当したのは現時点で1件であり、頻度を見てから裁定する。
2. **宣言が資源の一部しか覆わない時にどう扱うか。** 裁定済み（ADR 0137 残余面）。 現行は宣言されたsymbolだけでpartitionを作り、
   誰も宣言していない残余は候補のsurface差分に現れない。残余を明示的に「facadeへ残す」と
   宣言させるか、暗黙のままにするかを裁定していない。
3. ADR 0132のOpen questions 2〜4（複数候補のv2、`verification` digestの締め、新規fileだけを
   作るToDoの判定）は本ADRでも裁定していない。
