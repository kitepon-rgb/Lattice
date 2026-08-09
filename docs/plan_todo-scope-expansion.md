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

## どこに機械的に入れるか

**`lattice todo independence compile`。** 理由は4つで、どれも「新しい面を作らない」に向いている。

1. **膨張は必ずここを通る。** 宣言を広げる＝witnessを書き換えて再compileする。t7は5回通した
2. **差分の材料を既に持っている。** 前回artifactとwitness set digestがある
3. **計画層なので今の消費者に届く。** managed runの接続を待たずに効く（実行層を使っていない卓にも出る）
4. **出力面が既にある。** advisoryとseverabilityの語彙に載る

出す信号は `scope_expanded`: task_id・拡大回数・初回宣言・現在の宣言・**追加された資源の差分**。
実行層側は`prediction_excess`を捨てずに同じ面へ流す——**止めない挙動は変えないまま、情報だけ届く**。
これでADR 0158と両立する。

## 論点（設計判断が要るもの）

1. **装置はどこまで言ってよいか。** 差分を出すだけか、追加分と元の宣言の構造関係（共有symbolの有無・
   caller/callee）まで出すか。後者は構造観測であって判断ではないので所有境界の内側だが、
   `severability`の語彙（`code_seam`/`serial`）を増分へ当てると「切れる」と装置が言ったように読める。
   **読み手が判断を装置へ預けない書き方**が要る
2. **いつ出すか。** 1回目の拡大から出すとうるさい。「記録は毎回・助言はN回目から」の閾値をどう決めるか。
   あるいは回数ではなく**増分の大きさ**（元の宣言に対する比）で出すか
3. **in-progressに限るか。** 着手前の宣言修正は正常な推敲であって膨張ではない。`todo start`済みの
   taskに限るのが素直だが、startとcompileの順序は卓の運用で前後しうる
4. **分割そのものの重さ。** 実際に分けるにはplan revisionが要る（active plan versionのtopologyを
   追記で変えない、という規律がある）。**候補が出ても実行が重いままなら、席は「宣言を広げる」方を
   選び続ける**。促しだけで足りるのか、分割の入口も軽くする必要があるかは実測で決める

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
