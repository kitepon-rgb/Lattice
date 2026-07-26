# ADR 0134 — 同名symbolの曖昧さをreceiptへ残し、宣言した資源で絞る

- Status: Accepted
- Date: 2026-07-27
- Relates: [ADR 0127](0127-todo-independence-projection.md)（witness宣言とcompile）・
  [ADR 0132](0132-seam-proposal-read-only-surface.md)（提案面とtyped unknown）・
  [ADR 0133](0133-concern-anchor-binding.md)（concern anchor束縛。本ADRはそのOpen question 1を裁定する）

## Context

`lattice.seam_proposal.v1`のsensor receiptは`resolved_path`を**単数**しか持てない。したがって
同じ名前が複数fileに存在すると、解決結果は`unknown`へ潰れていた。潰れた先には候補が残らないので、
宣言の`within`——そのToDoが`owns`で主張している資源——で絞れば一意に決まる場合でも、絞る材料が
記録に存在しなかった。

これは仮定の話ではない。このrepoの唯一の実conflictがここで止まる。`tio-009`が担当する
`summarizeIndependence`は`src/todo-gantt-html.mjs`と`src/project-cli.mjs`の2 fileに同名で存在し、
`within`は前者を指しているのに、receiptは「決まらなかった」としか言えなかった
（[実行記録](../evidence/2026-07-27-concern-declaration-first-candidate.md)）。

ADR 0133はこれをOpen questionへ送り、「実データで該当したのは1件であり、頻度を見てから裁定する」と
置いた。本ADRはその判断を改める。**詰まっているのは頻度ではない。** 正直な宣言から
`seam_candidate`が出る唯一の実例がこの1件であり、ここが通らない限り実変換campaignの入力は
「機械が解決できないsymbolを宣言から落とした探りの宣言」に依存し続ける。宣言を実態からずらして
候補を作るのは、「宣言の誠実さが判定の上限」という前提そのものを壊す。

回避策としてcodebase側でsymbolを改名すれば通るが、それは製品の限界をcodebaseに吸収させる話で、
限界が消えたことにはならない。

## Decision

### 1. `query`操作のreceiptは候補pathを保持する（`lattice.seam_proposal.v2`）

`evidence.queries[]`へ`candidate_paths`を足す。exact一致した名前が複数fileに居た時、
outcomeを`ambiguous`とし、候補pathをstrict sortして載せる。

単数の`resolved_path`と併存させるのは、両者が**別の事実**だからである。前者は「一意に決まった」、
後者は「決まらず、候補はこれだけあった」。同じ形にすると、決まった記録と決まらなかった記録を
読み手が区別できない。したがって`ambiguous`のreceiptは`resolved_path`を持たず（`null`）、
`resolved`のreceiptは候補を並べない（空配列）。契約はこの排他を強制する。

版を上げるのは、v1のclosed shapeが余分fieldを拒否する以上、加算互換が成立しないためである
（ADR 0132 Decision 1・ADR 0133 Decision 1と同じ理由）。旧記録は移行しない。この成果物は
independence記録とsensorから再生成できるhost localの記録であり、git追跡もしていない。
古い記録は`SEAM_PROPOSAL_ARTIFACT_INVALID`と
`next_action: recompile_seam_proposal_or_remove_stale_record`で落ちる。

### 2. 曖昧さを残すのは`query`操作だけとする

`callers`／`callees`／`impact`は、展開の**起点**が一意でなければ観測の意味が定まらない。
どちらのsymbolについての観測かが確定しないまま候補を持たせても、graphの正しさには使えない。
よってgraph操作の曖昧さは従来どおり`unknown`へ潰す。

同じ曖昧さでも問いが違う。`query`が問うているのは「その名前はどこに居るか」であり、複数の答えは
**答えの不在ではなく複数の答え**である。操作ごとに扱いを変えるのは、操作ごとに問いが違うからである。

### 3. 絞るのは宣言した資源であって、宣言そのものではない

binderは、`ambiguous`なreceiptの候補集合を`within`が指す資源で絞り、**絞って1つに決まった時だけ**
束縛根拠にする。0個なら宣言した資源の中には無く、2つ以上なら資源の中でも決まらない。どちらも
`concern_anchor_unresolved`であって、片方を勝たせない。

絞り込みはsensorが返した候補集合の内側でしか動かない。宣言はpathを持ち込めず、存在しないsymbolへ
束縛されることもない。ADR 0133 Decision 1の「宣言は判定へ写らない」は不変である——本ADRが触るのは
提案の質だけであり、並列可否の判定入力は`concern_anchors`を落とす合成のままである。

`within`がsymbolを指していて、そのsymbol自身が曖昧な場合は絞れない。資源を絞る外側の宣言が
存在しないためであり、従来どおり`concern_anchor_resource_unresolved`を返す。

## Consequences

正直な宣言——`tio-009`が実際に触る`summarizeIndependence`を落とさない宣言——から
`seam_candidate`が出せるようになる。探り宣言に依存しない実データが実変換campaignの入力になる。

receiptが「決まらなかった」と言う場面が減る一方、`ambiguous`という中間状態が公開契約へ増える。
消費者は`resolved`だけを見ていた頃より、扱う状態が1つ多くなる。

同名symbolを名前だけで解決する経路が広がったわけではない。曖昧さは記録され、絞れる文脈
（宣言された資源）がある時にだけ解ける。文脈が無ければ従来どおり解けない。

## Open questions

1. **conflict resource側の同名解決。** `currentSurfaces`はconflict symbolのexact surfaceを
   単数`resolved`のreceiptからしか作れない。conflict symbolには`within`に当たる外側の資源が
   宣言されていないため、本ADRの絞り込みは効かない。同名のsymbolがconflict resourceになった場合は
   依然として`exact_surface_evidence_missing`で止まる。
2. ADR 0133 Open question 2（宣言が資源の一部しか覆わない時の残余の扱い）と、ADR 0132の
   Open questions 2〜4は本ADRでも裁定していない。
