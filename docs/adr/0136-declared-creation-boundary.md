# ADR 0136 — 創作境界は宣言し、fresh absentを裏付けとして受ける

- Status: Accepted
- Date: 2026-07-27
- Relates: [ADR 0065](0065-runtime-dogfood-usability-corrections.md)（`BOOTSTRAP_OWNERSHIP_SEAM`）・
  [ADR 0123](0123-run-request-contract-single-source.md)（run request契約の単一正本）・
  [ADR 0127](0127-todo-independence-projection.md)（witness宣言とcompile）・
  [ADR 0135](0135-readjudicating-seam-proposal-open-questions.md)（本ADRはそのDecision 3を実装する）

## Context

まだ存在しないpathの`owns`は、`path_state: absent`という観測を持ちながら判定対象外へ落ちていた。
新module追加・新doc作成・新test追加という実開発ToDoのかなりの割合が、並列可否を持てない。

`path_state`は索引の推測ではなく`inspectAffectedPathState`のlstat結果である。すなわち
「観測できなかった」ではなく「観測して、無かった」。存在しないfileに依存するものは構造的に
存在しえないので、そのpathを所有すると宣言したToDoは、同じpathを宣言した他のToDoとしか
干渉しえない。これは判定不能ではなく決定可能である。

## Decision

### 1. 創作は宣言する（`lattice.todo_witness_set.v3`・`lattice.run_request.v3`）

run requestの番号がv2を飛ばすのは、[ADR 0064](0064-runtime-hold-public-bridge.md)が
`lattice.run_request.v2`をepoch後継request（`predecessor_request_digest`と
`task_migration_digest`を持つ別shape）として既に使っているためである。同じ名前へ
2つの意味を載せない。後継requestの本体検査はbase契約と同じ規律で読むので、
創作境界を持つ宣言は再計画を跨いでも失効しない。

`owns`のentryへ`creates: true`を足す。観測から機械的に「創作境界」と読まないのは、
pathのtypoが「必ず止まるエラー」から「黙って通る創作境界」へ変わるからである。現在は
綴りを間違えた宣言が`path_absent`で確実に止まり、書いた本人が気づく。この検出を捨てない。

`kind`は`path`のまま据え置く。存在の有無は資源の**種類**ではなく資源の**状態**であり、
kindを分けると既存のpath判定（write交差の免除規則、conflict resourceのkind）が全部この宣言を
取りこぼす。値は`true`だけを受理する——`false`は「存在するpath」と同義で、同じ事実へ2つの
書き方を与えることになる。symbolには付けられない。存在はfsで決まるので、file単位に限る。
末尾`/`のprefix形は`affected`が`unresolved`を返すため対象外である。

`concern_anchors`（ADR 0133）と違い、創作宣言は合成run requestへ**そのまま届ける**。
判定そのものへ効く宣言だからで、落とせばfront endが読めない。宣言が判定へ写る以上、
「宣言の誠実さが判定の上限」という性質はこの欄の分だけ前へ出る。それを許すのは、
宣言が単独では何も裏付けないためである（Decision 2）。

### 2. 宣言と観測が一致した時だけ裏付けとする

`creates`が宣言されたbindingは、次を全部満たす時だけ`ready`にする。

- sensor outcomeが`ready`または`empty`
- fs観測の`path_state`が`absent`
- `changedFiles`が宣言pathちょうど1件
- `affectedTests`が空

一致しない側は全部fail closedにする。既に存在するpathへ創作を宣言していたら
`creates_path_present`、fs観測そのものが証拠に無ければ`creates_unverified`。
宣言だけでは何も裏付けない。宣言していないabsent pathは従来どおり`path_absent`である。

### 3. 記録も「まだ無い」を保つ（`lattice.boundary_manifest.v3`）

生成manifestの`owns`へ`creates`をそのまま載せる。落とすと、manifestだけを読む消費者が
既存fileと同じ扱いをする。旧v2 manifestはrun storeに残るので読み口として受理する。

### 4. 案内は小さい解決法から挙げる

`BOOTSTRAP_OWNERSHIP_SEAM`は「親が空の専用seamをbase commitへ先行追加する」しか
案内していなかった。宣言1行で済む道ができたので、そちらを先に挙げる。機械が止めた瞬間に
最小の解決法を知らせる（ADR 0130）。

## Consequences

新規fileを作るToDoが判定対象になった。実測では、同じfileを書く2 ToDoと新規fileを作る1 ToDoの
planが`outcome: compiled` / `conflict_count: 1` / `unknown_count: 0`でcompileし、投影は
`T1`と`T3`を並列グループ、`T1`/`T2`を要直列として返す
（[実行記録](../evidence/2026-07-27-cb-creation-boundary-dogfood.md)）。

宣言が実態からずれた時は止まる。同じ宣言のまま対象fileを実在させて再compileすると
`sensor_creates_path_present`で`unknown`へ落ちる。

`lattice.run_request`と`lattice.boundary_manifest`が版を上げた。どちらも旧版を読み口として
受理するので、既存のrequestとrun storeは書き換えを要求されない。

## Open questions

1. **依存するものが無い既存fileの扱い。** 発火条件: 実データで1件出たら裁定する（ADR 0142）。 存在するがaffected testを持たないpath（docや葉のtest）は
   今も`empty` statusでunknownへ落ちる。創作境界と同じ「blast radiusが空」という状況だが、
   本ADRは宣言があるabsent pathだけを扱っており、こちらは触っていない。
2. **1 ToDoが複数pathを所有する場合。** 発火条件: 実データで2件以上詰まったら着手する（ADR 0142）。 `affected_tests`は宣言とfresh観測をbinding単位で
   exact比較するため、affected集合の異なる複数pathを1 ToDoが所有すると宣言できない。
   創作境界とは独立の制約であり、本ADRでは解いていない。
