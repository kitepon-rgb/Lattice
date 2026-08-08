# ap06（合流分）: 監査待ちの2面が同じ答えを出すことを固定する

担当: ひなの / plan: audit-pending-surface / ap06 は みつきが claim、私は [join]（room [44][45]）

ap06 の design memo (a)〜(e) と既存 dispatch 不変 test への併記は みつきの担当。本書は
私が受け持った1点——**別実装の突き合わせ**——だけを持つ。証跡の本体は みつきの evidence が持つ。

## なぜこれが要るか

監査待ちは2つの面へ出る。

- `lattice status --json` / `lattice todo status --json` の `audit_pending`（ap03 / ap04）
- dashboard が配信する工程図のヘッダ（ap05）

どちらも `src/todo-audit-pending.mjs` の状態集合を使うが、**store read model の歩き方は別実装**である。
status 側は自前で歩き、gantt 側は `auditPendingPhasesOf` を使う（すずめの判断・room [31]。
未 commit の関数へ依存すると自分の commit 単体が赤くなって bisect が壊れる、という理由で妥当）。

別実装が同じ答えを出すことは、どちらの面の test も見ていなかった。片方だけずれると
「図には監査待ちが出ているのに status は残作業なしと答える」になり、**この工程がまさに直している
事故の形へ戻る**。誰の受入条件にも入っていない継ぎ目だったので、ここで塞ぐ。

先に scratchpad の使い捨てスクリプトで実測して一致を確認し（room [40]）、それを test へ移した。

## 何を固定したか

`test/todo-audit-pending-surface-agreement.test.mjs`（新規・3 test・全部実store）。
2つの phase 無し plan（`alpha-plan` / `beta-plan`）の全 task を done にして、暗黙の
terminal-audit Phase を gate_ready にした store を作り、両面を `plan_key/phase_id (status)` へ
正規化して突き合わせる。

| test | 固定した事実 |
| --- | --- |
| 同じ監査待ちを同じ順で指す | 2件が両面で内容・順序とも一致。`title` の件数表記も status の件数と一致（図が2件と言って status が1件を返す、が起きない） |
| 片方だけ `phase_review` を進める | 片方 `reviewing` / 片方 `gate_ready` の混在でも両面がずれずに追従する |
| `close-unaudited` を1つずつ入れる | 判断が着いた Phase は両面から同時に消える。全部着けば status は空配列、図は**札そのものが出ない**（空の札を出さない） |

### vacuous にならない形にした

両面を互いに比較するだけの test は、**両方が同時に壊れた時に通ってしまう**。
そのため各面をリテラルの期待値に対しても `deepEqual` している。どちら片方がずれても落ちる。

## fixture の扱い

**寄せていない。** ap06 の担当（みつき）が room [44] で「寄せない」と判断し、私も同意した。
理由は、みつきの (b)(c) が要求する形（2 plan 混在＋Phase 遷移を順に進める）と、既存2つの形が違い、
共通化すると helper が全ケースの和集合を抱えて、どの test が何を要求しているか読めなくなるため。

代わりに、gate_ready を作る時の落とし穴（みつき room [38] の発見）を新 test の冒頭コメントへ
出典つきで焼いた。次に書く人が同じ2往復を払わないようにするため。

- `NOW` を現在時刻より先に置くと `STORE_INCONSISTENT / future_clock_skew`（`max_future_skew_ms=300000`）
- `buildTodoPlan` の task 形は exact。`design_memo` を足すと schema violation

## どう確認したか

- `LATTICE_DASHBOARD_AUTOSTART=0 node --test test/todo-audit-pending-surface-agreement.test.mjs`
  → **3 pass / 0 fail**
- `npm test`（全体） → 結果は下の「全体 gate」に記載
- `npm run check` → `syntax check passed`

## やらなかったこと

- ap06 の design memo (a)〜(e) と既存 dispatch 不変 test への assert 併記。みつきの担当。
- 実 CLI を PATH へ置く E2E（みつき room [36] の経路）。私の突き合わせは projection と render を
  同一 process で呼ぶ形で足りる——比べたいのは2つの**実装**の答えであって、CLI の配線ではない。
