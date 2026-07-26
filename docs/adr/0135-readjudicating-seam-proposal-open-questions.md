# ADR 0135 — ADR 0132 Open questions 2〜4の再裁定

- Status: Accepted
- Date: 2026-07-27
- Relates: [ADR 0127](0127-todo-independence-projection.md)（witness宣言とcompile）・
  [ADR 0128](0128-todo-independence-operational-wiring.md)（着手時advisory）・
  [ADR 0130](0130-lattice-describes-its-own-parallelism-surface.md)（案内の単一正本）・
  [ADR 0132](0132-seam-proposal-read-only-surface.md)（本ADRはそのOpen questions 2〜4を再裁定する）

## Context

ADR 0132は3件を「実データの蓄積後に別途裁定する」として保留した。蓄積の有無を実測で確かめ、
1件ずつ仕分ける。

測定した事実:

- `affected`をまだ存在しないfileへ投げると、outcomeは`empty`、`path_state`は`absent`、
  `affectedTests`は空で返る。この`path_state`はindexの推測ではなく**filesystemのlstat結果**である
  （`inspectAffectedPathState`）。すなわち「観測できなかった」ではなく「観測して、無かった」。
- 末尾`/`のprefix形（`docs/evidence/`）は`unresolved`で返る。prefix形の`owns`は構造的裏付けを
  そもそも得られない。
- 存在しないsymbolへの`query`は`symbol_absent`で返る。
- 新規fileだけを作るToDoを1件混ぜると、compileは`BOUNDARY_UNKNOWN`で止まり、
  記録の`conflicts`は空になる。

## Decision

### 1. OQ2（複数の非劣位候補を持つ`candidate_set`）は保留を維持する

実データのconflict componentはこれまで1件で、それは唯一の非劣位候補を返す。
`multiple_incomparable_candidates`は実測で一度も出ていない。観測していない形へ公開契約を起こすのは
投機であり、出てからでも移行費用は変わらない（この記録はhost localで再生成できる）。

保留を続ける代わり、発火条件を明文化する。**`multiple_incomparable_candidates`が実データで1件出たら
着手する。** 「頻度を見る」という曖昧な条件は、見る主体も閾値も無いので永久に発火しない。

### 2. OQ3（`verification` digestを契約側で締めるか）は実変換campaignへ移す

ADR 0132自身が「`bounded-seam.mjs`のcaller assertion問題と同型」と述べており、その解消は
既に実変換campaignの所有物である（`docs/plan_backlog.md`の課題2）。同型の問題を別々のcampaignへ
割ると、受け皿を締めるのか検証済みを別fieldで表すのかという同じ設計判断が2回行われ、
食い違ったまま両方が残る。裁定の単位を分けない。

### 3. OQ4（新規fileだけを作るToDo）は判定対象にする。ただし自動導出でなく宣言とする

**判定対象にする理由。** `path_state: 'absent'`は決定的な観測である。存在しないfileには依存する
ものが無く、blast radiusは構造的に空なので、そのpathを所有すると宣言したToDoは、同じpathを
宣言した他のToDoとしか干渉しえない。これは判定不能ではなく、決定可能である。
新module追加・新doc作成・新test追加という実開発ToDoのかなりの割合を、決定可能な事実を捨てて
判定対象外にしている。

**自動導出にしない理由。** 観測から機械的に「創作境界」と読むと、pathのtypoが
「必ず止まるエラー」から「黙って通る創作境界」へ変わる。現在は綴りを間違えた宣言が
`path_absent`で確実に止まり、書いた本人が気づく。この検出を捨てない。よって`owns`側へ
創作の意思を宣言させ、**宣言があるpathだけ**を、fresh absentかつ`affectedTests`が空という条件の下で
構造的裏付けありとして扱う。宣言の無いabsent pathは従来どおりfail closedのままにする。

**prefix形は対象外とする。** 末尾`/`の`affected`は`unresolved`を返すので、そもそも裏付けを
得られない。創作宣言もfile単位に限る。

**実装は専用planへ起こす。** 判定を行うのはfront endであり、front endは`lattice.run_request.v1`の
`manual_witness`しか読まない。よって創作宣言は`lattice.todo_witness_set`（v3）と
`lattice.run_request`（v2）の両方へ届く必要がある。後者は83箇所・30ファイルから参照される
入力契約であり、campaign規模である。本ADRは方向だけを確定し、実装はその工程で行う。

## Consequences

OQ4の実害を測る過程で、**判定そのものの欠陥**を1件見つけて別途修理した。compileが
`BOUNDARY_UNKNOWN`で止まるとpairwise verdictが1つも作られず記録の`conflicts`が空になるが、
投影はその空をそのまま読み、自分にunknownが無いready同士を並列グループへ入れていた。
実測では、同じfileを書く2 ToDoが正しく直列と出ていた状態へ新規fileのToDoを1件足すだけで、
conflictが消えて2 ToDoが**検証済み並列**として提示され、案内も`independence_verified`を返した。

すなわちOQ4の実害は「新規fileのToDoが判定対象外になる」ではなく、
**「1件混ざるとplan全体の判定が反転する」** だった。判定の不在を独立の証拠へ読み替える、
最も危険な向きの誤りである。これは裁定を待つ性質の問題ではないので即座に修理した
（`plan_verdicts_absent`と`independence_verdicts_absent`、
[実行記録](../evidence/2026-07-27-bk-005-open-question-readjudication.md)）。

OQ4の実装が入るまで、新規fileを作るToDoを含むplanは全件が未検査として出る。安全側だが、
並列可否を持てないままである。`BOOTSTRAP_OWNERSHIP_SEAM` guidanceが案内する「空のseam fileを
base commitへ先行追加する」回避策は使えるが、製品の限界をcodebaseへ吸収させる形なので
既定の手順にしない。

## Open questions

1. OQ2の発火待ち（`multiple_incomparable_candidates`の初回観測）。
2. OQ3は実変換campaignの内側で裁定する。
3. ADR 0133 Open question 2（宣言が資源の一部しか覆わない時の残余）と
   [ADR 0134](0134-ambiguous-symbol-receipt-narrowed-by-declared-resource.md) Open question 1
   （conflict resource自身が同名の場合）は本ADRでも裁定していない。
