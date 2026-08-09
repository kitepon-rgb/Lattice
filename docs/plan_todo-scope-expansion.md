# 宣言の膨張を観測し、AIへToDo分割を促す（scope expansion signal）

Latticeは並列可能なTODO graphを作る装置である。ところが**ToDoが実行中に膨らんだとき、装置は何も言わない**。
宣言は席（AI）が手で広げ、装置はそれを黙って受理する。本書はその穴を埋める構想であり、
**実装も工程起票も含まない**。工程状態の正本はまだ無い。着手時にplan keyを決めてstoreへ起こす。

## なぜ今これか

2026-08-09、Lattice自身のcampaign `roundtable-exec-20260809`（円卓×実行層統合）で実測した。

**79 commitのうち29（37%）が「自分の宣言境界を広げる」commitだった。** うちt7単独で5回:

```
055f933 t7の初回activation実測境界を追加する
caeea7b t7のdispatch待機境界を追加する
e2836df t7へv2 schema配布境界を追加する
5a3265e t7へhost駆動能力契約の境界を追加する
9bdf8f0 t7のblocking修正境界を宣言する
```

t7は「Wave 1の受入gateを実測する」1 ToDoだった。実測したら製品が壊れており、修理が生えた。
**宣言が実態を5回追いかけ、装置は5回とも黙っていた。**

会話側の数字が帰結を示す。同じ卓で:

| 区間 | 発言 | 着地したtask |
|---|---|---|
| t7開始前 | 166 | **11件** |
| t7開始後 | 293 | **0件** |

t7より前は1 taskあたり15発言で捌けていた。t7に入った途端、それまでの会話量の2倍を1 ToDoへ注いで
何も着地しなくなった。**分解されなかった仕事は会話へ落ちる。そして会話はN席ぶん課金される**
（1発言＝全席1ターン）。これはLattice自身の主張が自分の卓で実証された形である。

## 装置が持つもの／持たないもの

**分割の判断と実行はAIが行う。装置はやらない。** [AGENTS.md](../AGENTS.md)「所有境界」のとおり、
Latticeが供給するのはAIが自分で作れないもの——構造観測、契約、検証、記録、版の境界——に限る。
「このToDoは大きすぎるから2つに割れ」は判断であり、操作しているAIが既にできる。

したがって装置が出すのは**膨張したという事実と、その差分**だけである。それを見て分割するかどうか、
どこで切るかはAIが決める。**促すところまでが装置の仕事**（オーナー裁定 2026-08-09）。

## 着手時点の事実（実読で確定したもの）

- **実行層には既に信号がある。** `undeclared_write`（宣言write scope外への書き込み・offenderは当該TODO）が
  [runtime-diff-observer.mjs:319](../src/runtime-diff-observer.mjs) と
  [runtime-decision-verifier.mjs:208](../src/runtime-decision-verifier.mjs) の二重実装で出る
- **ただし単独ToDoのものは findings から外れる。** [runtime-engine.mjs:509-513](../src/runtime-engine.mjs) が
  `prediction_excess` へ再分類して除去する。conflictにならず、holdもせず、再計画もしない
- **その扱いは正しい。** [ADR 0158](adr/0158-planned-boundaries-are-predictions-and-runtime-recovery-is-target-scoped.md) §2が
  「rawな`writes`予測外は`prediction_excess`であり、boundary violation、rollback、成果破棄、単独freezeの
  理由にしない」と裁定している。**不変Decisionなので変えない**
- **問題は「止めない」と「知らせない」を同一視していること。** `prediction_excess`は記録されるが、
  そこから先へ何も流れない
- **計画層には同等の観測が一つも無い。** witnessは宣言するだけで、実際の書き込みと突き合わせる面が無い。
  卓が使うのは計画層なので、t7の5回はどこにも当たらなかった
- `lattice todo independence compile`は既に前回artifact（`.lattice/todo/plans/<key>/<ver>/independence.json`）と
  `witness_set_digest`を持つ。差分を取る材料は揃っている
- 助言の出口も既にある。`todo start`のadvisory（[todo-cli.mjs:600-668](../src/todo-cli.mjs) の`startAdvisory`）が
  `coverage`／`conflicts_with_active`／`severability`を返しており、席はこれを読む習慣がある（ADR 0128）

## 中核モデル: 各gateを別ToDoへ——A→A'変換（オーナー裁定 2026-08-09）

肥大の実体は「**ToDoの中に第二のToDoリストが生える**」ことである。t7の内側にはactivation修理・
host駆動能力契約・schema配布……それぞれ固有の受入条件を持つ小さなgateが積み上がったが、全部が
t7の内側のチェックリストだったので、Latticeからは「t7が1個進行中」としか見えなかった。
5回の境界拡張も、内側の①〜⑥の進み具合も、グラフに存在しなかった。

対策の形は**変換**である: 工程Aの内側に生えた各gateを独立のToDo A1〜Anとしてグラフへ追加し、
A自身は元の受入だけが残った姿A'へ痩せて、A1〜Anを前提（hard dependency）に持つ。
Aの下流に居たtaskは自動でA'の下流になる——**工程の意味が機械に保持されたまま分解される**。

- **変換の判断と作図はAIがやる**（どこで切るか・何がgateかは判断であり、装置の外）。
  **装置は肥大を観測して変換を促し、AIが渡した分割案を正規のrevisionへコンパイルする**
- 内側リストがグラフへ出た瞬間、進捗・依存・並列可否・競合判定が全部機械の面に乗る。
  A1とA3が独立ならLatticeが並列可と判定できる（内側リストのままでは原理的に直列）
- storeの語彙は既にこの変換を持っている: plan revisionの`task_migration`が
  「from_task_id → successor_task_ids」を表せる。無いのは軽い入口だけ
- **別planへ逃がす形（spawn案）は採らない。** 実測済みの欠陥: roundtable-redirect-20260809は
  t19との順序をhard dependencyで持てず、noteと口約束で持っている。依存の線が切れる分解は
  グラフの意味を壊す。分解は同一グラフ内の変換として行う

**この変換の本質は記憶の移送である。** 現状、gateの中身——受入条件の集合・各条件の充足状態・
実測中に条件が増えた事実——は**AIのコンテキストとroomの散文にしか存在しない**（機械が持つのは
器だけ: taskの存在・依存の合流・evidence必須・audit状態。design_memoの散文は機械に不透明）。
だからAIは揮発性のコンテキストでgateの状態管理を代行し、context要約のたびにroomログから状態を
作り直していた（t7実測: 293発言の大半がこの代行）。A→A'変換は、**AIのコンテキストにしか
なかったgateの中身をグラフという機械の記憶へ写す操作**である——条件はToDoに、充足はstatusに、
順序は依存に、進捗は工程表に載り、揮発しなくなる。

## どこに機械的に入れるか（3本立て）

**1. 観測 — `lattice todo independence compile`。** 理由は4つで、どれも「新しい面を作らない」に向いている。

- **膨張は必ずここを通る。** 宣言を広げる＝witnessを書き換えて再compileする。t7は5回通した
- **差分の材料を既に持っている。** 前回artifactとwitness set digestがある
- **計画層なので今の消費者に届く。** managed runの接続を待たずに効く
- **出力面が既にある。** advisoryとseverabilityの語彙に載る

出す信号は `scope_expanded`: task_id・拡大回数・初回宣言・現在の宣言・**追加された資源の差分**。
実行層側は`prediction_excess`を捨てずに同じ面へ流す——**止めない挙動は変えないまま、情報だけ届く**
（ADR 0158と両立）。gate形のtask（依存の合流点）は肥大を引き寄せる構造的理由を持つので、助言を強める。

**2. 促し — `todo start`のadvisoryとcompile結果。** 「task Aの宣言がN回膨張している。内側に
gateのリストが生えているなら、A1..An＋A'への変換を検討せよ」。変換するかはAIの判断。助言であって門ではない。

**3. 変換の軽い入口 — `lattice todo split`（仮名）。** AIが分割案（A1..Anの定義・依存・A'の残余）を
JSONで渡すと、装置が正規のplan revision（successor版・`task_migration`のfrom→successors・下流の
付け替え・witness移行）へ機械的にコンパイルする。重い契約（phase revision v3の全digest整合）は
下に生きたまま、手書きだけが消える。**候補が出ても実行が重いままなら、席は宣言を広げる方を選び続ける**
——入口の軽さが本丸である（本campaign実測: 別plan起票は親がやって約30分。席には重すぎた）。

split時に`parent_task_id`へ発生元（A'）を刻む。task schema（extraction v3・plan v6）は既に
`parent_task_id`を持っており、後述の入れ子表示に必要な系譜データは変換の副産物として貯まる。

## 観測の限界と役割分担（オーナー問い 2026-08-09: 暗黙のgateは本人にしか分からないのでは）

その通り、**半分は本人にしか分からない**。暗黙のgateには2つの相がある:

- **①思考の相**（「これを直さないとgateを通せない」と思った瞬間）——原理的に外から見えない。
  ここを検出しようとするとAIの思考の推定になり、所有境界違反へ戻る。**やらない**
- **②行動の相**——意図は作業になった瞬間、必ず機械の面に影を落とす: 宣言拡張（witness差分）、
  宣言外への書き込み（`undeclared_write`）、task参照つきのcommit。**促しはこの最初の影に置く**。
  t7の実測では1回目の境界拡張で促せた（実際は5回黙って293発言が燃えた）

行動にならない暗黙のgate（会話だけで管理される調整系）は機械の領分ではなく:
- **規範が受け持つ**: member.md／正典に「内側にリストを作らない。溜まったらグラフへ出す」を
  1行置き、AIが自分で自分に促す（「AIに促す程度」の規範による実装）
- **自己申告の経済を作る**: `todo split`が1コマンドなら、頭の中に溜めるより出す方が安くなる。
  ①の相は検出できない代わりに、本人が出したくなる勾配を作る

これはAGENTS.mdの既存の二段構え（計画時の完全な分断は原理的に不可能・実行段階の境界検知が
埋め合わせる）と同じ形である。思考段階の検出は不可能、行動段階の影で捕まえる。二段構えが設計。

## 論点（設計判断が要るもの）

1. **装置はどこまで言ってよいか。** 差分を出すだけか、追加分と元の宣言の構造関係（共有symbolの有無・
   caller/callee）まで出すか。後者は構造観測であって判断ではないので所有境界の内側だが、
   `severability`の語彙を増分へ当てると「切れる」と装置が言ったように読める。
   **読み手が判断を装置へ預けない書き方**が要る
2. **いつ出すか。** 記録は毎回・助言はN回目からの閾値か、増分の大きさ（元の宣言に対する比）か
3. **in-progressに限るか。** 着手前の宣言修正は正常な推敲であって膨張ではない。advisoryは着手者へ向ける
4. **A'の状態。** Aがin-progressだった場合、A'はpendingへ戻すのが素直（Aのjournalは履歴として残る。
   started扱いを引き継ぐと「着手済みなのに前提未完」という矛盾状態が生まれる）。carry/resetの
   意味論はrevision契約の既存語彙（state_policy）で表せるかを実装時に確認
5. **splitの権限。** 分解は判断でありAIのもの。ただしin-progressのtaskを着手者以外が割る形は
   行儀の整理が要る（advisoryを着手者へ向けることで大半は解消するはず）

## 欲張り（別対応でよい・オーナー発案 2026-08-09）

**ToDoの箱の内側に、その内部の工程図が描かれる入れ子表示。** 行の折り畳みではない——
既存ToDo Aは外から見れば今までどおり1個の箱のまま、開くと**箱の内側にA1→A2、A3∥A4→A'という
内部のDAGがそのまま工程図として入っている**（入れ子グラフ・graphvizのcluster相当）。
split由来のA1..AnはA'を`parent_task_id`に持つので、この系譜がそのまま箱の境界になる。
入れ子は再帰しうる（A1の中でさらにsplitが起きれば箱の中に箱）。
描画側（todo-gantt-html／svg／layout）の大改修になりうるので、本campaignから切り離して
別途起票してよい。データ面はsplitが自然に貯めるため、表示を後回しにしても失われない。

## 非目標

- **分割の判断・実行を装置へ実装しない。** どこで切るか、切るべきかはAIが決める
- **ADR 0158を変えない。** `prediction_excess`はboundary violationにしない。止めない
- **拒否にしない。** 膨張を理由にcompileやstartを失敗させない。助言であって門ではない
- **新しい観測器を足さない。** 材料（前回artifact・witness digest・`undeclared_write`）は既にある
- 卓（Peertable）のための面にしない。汎用の計画層の面として成立しなければ作らない

## 罠

- **`prediction_excess`は「実行層の話」に見えるが、卓が踏んだのは計画層である。** 実行層だけ直しても
  今回の29 commitは1つも捕まらない
- **witnessのcommit履歴は膨張の証拠になるが、それを正本にしない。** repoによってはwitnessをgit追跡外に
  置きうる。判定は store側のartifact比較で閉じる
- **`独立性のcompileは8 ToDoまで**（`schedulability-compiler-v2.mjs`の`MAX_TODOS`）。witnessをwave subsetで
  運用している場合、前回artifactとの比較対象が「同じsubsetか」を先に見ないと、subsetの入れ替えを
  膨張と誤検出する
- 膨張の記録は`todo note`と混同しない。noteは人が書く散文で、こちらは機械が導く観測である
