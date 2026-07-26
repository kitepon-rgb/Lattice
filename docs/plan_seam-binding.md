# 係争資源内の担当concernを宣言し、切断候補を束縛する

seam提案が実データで`unknown_requires_evidence`に留まる主因——「係争中のfileの中でどの部分が
どのToDoのものかを宣言する場所が無い」——を、判定へ影響しない束縛専用の宣言fieldで解消する工程群。

実変換（隔離worktreeでの実行）は本planの非目標であり、後続campaignが持つ。

工程状態の正本はLattice storeの`seam-binding` plan。本書は目的・思想・非目標・受入条件・罠を持つ。

## なぜ今これか

[ADR 0132](adr/0132-seam-proposal-read-only-surface.md)のOpen question 1が本planの対象である。
初回の実データ実行（[docs/evidence/2026-07-26-seam-proposal-first-real-run.md](evidence/2026-07-26-seam-proposal-first-real-run.md)）で、
このrepoの唯一の実conflictは`semantic_owner_binding_missing`を返した。`tio-009`が宣言した境界の
全部が係争中のfile（`src/todo-gantt-html.mjs`）そのもので、固有anchorを持たないためである。

判定は正しい。しかし**情報は存在する**。当該fileは34 symbolに分かれ、`tio-009`の仕事は
`renderRightPane`・`renderIndependenceNote`・`summarizeIndependence`・`dispatchBasis`に乗り、
`tio-008`の仕事は大半が別file（`src/todo-gantt-svg.mjs`）に乗っている。宣言できないのは
入口が無いからであって、構造が足りないからではない。

実変換へ賭ける前にここを通しておく理由は、実変換の入力が`seam_candidate`だからである。
実データで候補が1件も出ない状態のまま変換器を作ると、検証が全部fixture上になる。

## 着手時点の現状（実装で確定した事実）

- `uniqueIntentAnchors`（[src/seam-proposal.mjs:758](../src/seam-proposal.mjs)）は束縛用anchorを
  `owns`・`writes`・`affected_tests`から導き、**全task中でちょうど1 taskだけが持つanchorだけ**を残す。
  係争資源しか宣言していないToDoは残余ゼロになり、`semantic_owner_binding_missing`へ落ちる。
- **既存の`owns`にsymbolを書いて代用する道は塞がっている。** write交差の免除規則
  （[src/runtime-front-end.mjs:518](../src/runtime-front-end.mjs)）は「両者が同一pathを`owns`で
  主張している時だけ」交差を許す。ToDoがfile所有をやめてsymbol所有へ絞ると、`writes`の交差が
  未解決になり`undeclared_write_overlap`で判定全体が`BOUNDARY_UNKNOWN`へ落ちる。
  `owns`はwrite所有権の解決キーを兼ねており、担当concernの宣言を載せられない。
- `bindSkeleton`はtaskが2つ以上のpartitionに当たった時点で`semantic_owner_binding_ambiguous`にする。
  `module_frontier`のpartitionはfile単位なので、係争file内にconcernを持ちつつ別fileも所有するToDoは
  粗いanchorのままだと必ず複数partitionに当たる。anchorの優先順位を決めない限り解けない。
- 提案後ownershipの検証（virtual witnessの再compileで残余conflict 0を要求）は実装済みで、
  本planはその入力側だけを増やす。

## 設計方針（本planが守る線）

**宣言は判定へ影響しない。** concern宣言は束縛（どこで切るか）にだけ効き、独立性判定
（競合があるか）には一切効かない。したがって宣言が嘘でも競合を消せない。悪化するのは提案の質だけで、
「宣言の誠実さが判定の上限」という既存の性質をこれ以上前へ出さない。この非影響は文章で主張せず、
宣言の有無でindependence artifactが不変であることをtestで固定する。

**宣言は機械が裏を取る。** 宣言されたsymbolは、sensorが返した名前とpathのexact一致で照合し
（AGENTS.md所定のfuzzy解決対策）、宣言した係争資源の内側にあることを確認し、
task間で重なっていないことを確認する。どれか一つでも欠ければ提案せずtyped unknownを返す。

**宣言は義務にしない。** 宣言が要るのは、実際に競合してcompilerが束縛できなかったToDoだけである。
未宣言のwitnessは従来どおり動き、従来どおりのunknownを返す。

## 非目標（本planではやらない）

- 隔離worktreeでの**実変換**の実行。
- concern宣言の自動生成・自動推論。call graphからtask IDを導出しない線（ADR 0132 §4）は動かさない。
- ADR 0132のOpen question 2〜4（複数候補のv2、`verification` digestの締め、新規fileのみのToDo）。
- `todo start`のdispatch拒否gate化。

## 受入条件

1. witness契約に、係争資源内の担当concernをsymbol名で宣言できる束縛専用fieldがある。
   契約文書がその非影響性を明記している。
2. 宣言はsensorのexact一致・資源内包含・task間排他で検証され、破れたら提案せずtyped unknownを返す。
3. 宣言の有無でindependence artifactが（自己digestを除いて）不変であることがtestで固定されている。
4. concern宣言を持つtaskは、その係争資源についてはconcern anchorだけで束縛される。
5. このrepoの実conflict（`tio-008`/`tio-009`）へ宣言を足して再compileし、結果を記録する。
   `seam_candidate`へ到達すればそれを、到達しなければ**残った理由**をevidenceに残す。
6. 不変DecisionがADRに記録され、公開契約の記述が実装と一致する。

## 既知の罠

- sensorのsymbol lookupは存在しない名前を近いsymbolへfuzzy解決する。返却名とpathのexact一致を
  照合し、不一致・空結果はunknownとして棄却する（AGENTS.md所定）。
- witness setのschema versionを上げるのは公開契約の変更である。docs/schemasと公開契約の記述を
  同じ受入単位で揃える。既存のv1宣言（`.lattice/todo/witness/`に2件）を壊さない。
- `owns`へ相乗りしない。上の「着手時点の現状」で確定したとおり、write所有権の解決が壊れる。
- 宣言を足したことでbindingが通っても、提案後ownershipの残余conflictが0でなければ候補にならない。
  受入条件5は「候補が出ること」ではなく「結果が正直に記録されること」である。

## 工程

工程の状態・依存・完了証拠はLattice storeの`seam-binding` planが正本。以下は対応表である。

- [ ] concern宣言fieldをwitness契約へ足す
- [ ] 宣言をsensorのexact一致と資源内包含で検証する
- [ ] task間のconcern重複をtyped unknownとして棄却する
- [ ] concern anchorでcut候補を束縛しanchor優先順位を定める
- [ ] 独立性判定への非影響をtestで固定する
- [ ] 実conflictへ宣言を足して再compileし結果を記録する
- [ ] 不変DecisionをADRへ記録し公開契約を実装へ揃える

## 導線

- 製品思想: [PLAN.md](../PLAN.md)
- 公開契約: [docs/00_product-contract.md](00_product-contract.md)
- 直前の前提: [ADR 0127](adr/0127-todo-independence-projection.md)（witness宣言とcompile）、
  [ADR 0132](adr/0132-seam-proposal-read-only-surface.md)（提案面とunknownの分類）
- 直前のcampaign: [docs/plan_seam-proposal.md](plan_seam-proposal.md)
