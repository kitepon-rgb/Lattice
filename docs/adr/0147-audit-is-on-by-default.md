# ADR 0147: 終端監査は既定でON——Phase無しplanは監査待ちのまま閉じない

- 状態: 採択（2026-07-30）
- 関連: [ADR 0062](0062-decouple-phase-audit-from-task-scheduling.md)（Phase監査順とToDo
  schedulingの分離）、[ADR 0063](0063-ready-frontier-dispatch-contract.md)（並列dispatch
  gate——規則でなく機構で守る先例）、[ADR 0146](0146-the-certainty-gate-classifies-handoff.md)
  （手渡しの分類、未知は安全側へ倒す思想の同型）
- 計画: [docs/plan_phase-audit-and-cli-discovery.md](../plan_phase-audit-and-cli-discovery.md)

## 文脈

2026-07-29〜30、別repoの戦役26 ToDoが**一度も重監査を通らずに完走した**。実行者（AI）の
落ち度だが、Lattice側にもそれを許す構造があった。

1. `todo migrate`（extraction v2）で作ったplanはphaseを持たない。Phase gate
   （`todo phase review` → evidence束縛の`todo phase accept`）が存在しないので、全ToDoを
   軽量確認だけで閉じられ、どの時点でも警告が出ない。
2. 事後にPhaseを被せる救済経路が無い。`revise-phase`のv3は`state_policy: carry`に対し
   `phase_id`を含む意味論比較を行うため、Phase割当ての獲得を`carry_semantics_changed`で
   拒否する（`src/todo-store.mjs`の`phaseV3CarrySemantics`／`validatePhaseV3Carry`。
   `phaseV3CarrySemantics`はtaskのphase_idを比較対象へ含め、`null`正規化してでも
   before/after一致を要求する）。`reset_pending`にするとdoneが消える。
3. 実測: v1/v2のphase revisionが使う`taskSemantics`（同file）は比較対象に`phase_id`を
   **含まない**ので、v2経路ならcarryでPhaseを獲得できる。ただしv2はsource_inventory／
   reconciliation／cutoverを持たないため、reconciledなv3 planには使えない（この
   `phase-audit-and-cli-discovery` plan自身がregistered_unreconciledだったためv2で
   Phaseを獲得した——救済経路が偶然の隙間にしか存在しないことの実例）。
4. オーナー規範は「**Phaseごとに重監査。Phaseの定義がない小さいplanなら最後にやる**」。
   Latticeはこの既定をどこにも表現していない。

直列化と同じ構図である。`all_ready_parallel_by_default`は規則として書かれていたが、AIが
読み飛ばして直列化する事例が出た。0.35.0で`PARALLEL_DISPATCH_RECONSIDER`
（`src/todo-cli.mjs`・`src/todo-dispatch-shape.mjs`）という機構にした——直列の申告を一度
突き返し、再考させてから`--serial-confirmed`だけを受理する。重監査も同じで、**規則を
書くだけでは飛ばされる。機構で守る。**

## 裁定

1. **監査の既定は「有り」。無しは明示の宣言が要る。** phaseを持つplanは各Phaseの
   `accept`が既存どおりevidence束縛の重監査を担う。**phaseを持たないplanは、終端に
   重監査が自動で要る。** 全task doneは「完走」ではなく「監査待ち」であり、終端監査の
   記録が積まれるまでplanは閉じない。
2. **終端監査は新概念にせず、Phaseの特例として表現する。** phase無しplanの終端監査は
   「全taskを含む暗黙の単一Phaseのaccept」と同型に扱う。既存のreview → accept／
   evidence slot／journal eventをそのまま再利用し、新しい状態機械を追加しない。
3. **作成時にphase無しを拒否しない。通知に留める。** `plan create`／`todo migrate`は
   phase無しplanの作成を通し、結果へ「終端監査が要る」ことを明示するだけにする。
   小さいplanでphase定義を強制すると authoring が重くなり、Markdownへ逃げる誘因になる。
4. **doneを保ったままのPhase獲得は、carryの緩和ではなく専用state_policyで表現する。**
   既存`carry`／`carry_reconciled_metadata`が持つ、各policyで不変と定めた意味論の比較
   （`phaseV3CarrySemantics`によるbefore/after一致要求）はそのまま維持し、緩めない。
   「Phaseの獲得**だけ**を許し、他の変化は従来どおり拒否する」ことを、`carry`とは別の
   typed policy（例: `acquire_phase`）として型で表現する。同一の`carry`分岐へ
   `phase_id`だけ除外する特例条件を足す実装は、以後の意味論比較すべてに例外条件が
   混入する経路を開くため採らない。
5. **並列を殺さない。** 終端監査gateはplanの「閉じ」だけを止め、ToDoのdispatch可否には
   影響しない。ADR 0062が確立した「Phase前後関係／監査はToDo DAGのreadiness判定に
   混入しない」不変をそのまま継承する。通常ToDoのstart/done readinessは既存どおり
   hard dependencyとjoin（＋明示`phase_accept_dependencies`）だけで決まり、終端監査の
   有無・進行状況はこの判定に一切参照されない。
6. **Latticeは監査の中身を採点しない。** 持つのは「監査の記録なしに閉じたことにさせない」
   gateだけであり、evidenceの妥当性判断は既存どおりhost／人間の裁量に残す。

## この裁定が主張しないこと

- **監査の中身を検査・採点しない。** 何を確認すべきかはhost／人間の裁量のままで、
  Latticeはevidence slotが埋まって`accept`が記録されたことだけを見る。
- **既存のphase付きplanの挙動を変えない。** 終端監査gateはphaseを持たないplanにだけ
  掛かり、v4／v5のPhase gate契約（ADR 0043・0051・0062・0063）はそのまま。
- **`carry`の意味論比較そのものを緩めない。** 専用policyの追加であり、既存`carry`／
  `carry_reconciled_metadata`の各policyが定めるbefore/after一致要求（`phaseV3CarrySemantics`・
  `taskSemantics`）は変更しない。
- **store canonical形式・digest計算を変えない。** journal eventの追加は既存event型の
  範囲に収める。
- **特許請求項（Patent/Lattice、12項凍結）を逸脱しない。** 本裁定は工程storeのgateと
  CLI案内の改善であり、請求項本文には触れない。
