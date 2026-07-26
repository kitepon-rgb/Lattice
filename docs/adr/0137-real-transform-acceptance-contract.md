# ADR 0137 — 実変換の受入契約：所有・共有・残余の三面と、循環しない切り方

- Status: Accepted
- Date: 2026-07-27
- Relates: [ADR 0032](0032-rc2-bounded-graph-compiler-and-three-way-seam.md)（bounded変換とthree-way seam）・
  [ADR 0044](0044-rc3-runtime-contract.md)（隔離worktree executor）・
  [ADR 0132](0132-seam-proposal-read-only-surface.md)（提案面とstable role。本ADRはそのOpen question 2を裁定する）・
  [ADR 0133](0133-concern-anchor-binding.md)（宣言anchorとdeclared_partition。本ADRはそのOpen question 2を裁定する）

## Context

`seam_candidate`は「どこで切れば競合が消えるか」を、提案後ownershipでの仮想再compile（残余conflict 0）まで
確かめて記録する。しかし**そのまま実行できない**。実データの候補を適用しようとして分かった。

対象は`src/todo-gantt-html.mjs`で、`tio-008`が`CSS`、`tio-009`が
`dispatchBasis`／`renderDiagramLegend`／`renderIndependenceNote`／`renderRightPane`／`summarizeIndependence`を
宣言している。記録された提案surfaceは所有側の2つだけである。

素朴に「宣言symbolを新fileへ移す」を実行すると3つ壊れる。

1. **宣言されていない共有helperが宙に浮く。** 移す5 symbolは`escapeHtmlText`、`escapeHtmlAttribute`、
   `refKey`、`compareText`、`taskReference`、`presentationLookup`、`foldIndex`、`statusMarkup`、
   `DOCUMENT_STATUS`、`SEVERABILITY_LABEL`に依存する。どのToDoもこれらを宣言していない。
2. **循環importになる。** 原fileに残る`renderTodoGanttHtml`が`renderRightPane`を呼び、新fileの
   `renderRightPane`が原fileのhelperを呼ぶ。
3. **残余が記録に無い。** 提案は原pathに何が残るかを述べていない。適用後の姿が一意に決まらない。

これはADR 0133 Open question 2（宣言が資源の一部しか覆わない時の残余）と、ADR 0132 Open question 2の
実務上の現れである。read-onlyで止まっている限り露見しなかった。

## Decision

### 1. 変換後の姿は所有・共有・残余の三面で記述する

適用可能な候補は、次の3種のsurfaceを**すべて**挙げる。

- **所有surface**（`task_owned`）: 宣言anchorのsymbolを持つ、ToDoごとの新path。
- **共有surface**（stable role）: 所有surfaceが依存し、かつ誰も宣言していないsymbolを集めた新path。
  所有者を持たない（`owner_task_ids: []`）。
- **残余surface**（stable role）: 原pathに残るもの。公開入口と、どこへも移らなかったsymbol。

現行の候補は所有surfaceしか持たないため、**そのままでは実行できない**。候補生成側が三面すべてを
出すようにする（工程`rt-002`）。三面が揃わない候補は変換の入力として受理しない。

### 2. 共有surfaceは所有surfaceへ依存してはならない

依存の向きを「所有 → 共有」「残余 → 所有」の一方向に固定する。共有surfaceが所有surfaceを参照した
時点で、その候補は循環を作るので拒否する。

これは美観の問題ではない。共有surfaceは誰も所有しないため、そこへ辺が入ると「所有者のいないコードが
所有者のいるコードに依存する」ことになり、片方のToDoの変更が共有面の意味を変えうる。
分離の目的そのものが壊れる。

### 3. 呼び出し側の書き換えは変換のscopeに含めない

原pathは残余surfaceとして生き残り、移動したsymbolを再export する。したがって原pathをimportしている
外部のfileは**一行も変わらない**。

呼び出し側を書き換える案も採らない。変更pathが宣言境界の外へ際限なく広がり、
`allowed_paths`による封じ込め（ADR 0032）が意味を失う。分離の便益は所有の分離で得られるので、
importの書き換えは不要である。

### 4. 受入は4ゲート全通過とし、1つでも欠けたら不採用にする

`bounded-seam.mjs`の器をそのまま使う。`transform`と`verify`の中身を製品側が供給する。

- `behavior_equivalent`: 変換前後で外部挙動が同じであること
- `focused_tests_passed`: 候補の`affected_tests`が変換後のworktreeで通ること
- `sensor_fresh`: 変換後のworktreeを再indexし、その索引で観測できること
- `overlap_reduced`: 再indexした索引と**同じ宣言**で再compileして残余conflictが0であること

`overlap_reduced`は仮想再compileの再実行ではなく、**変換後の実ソースに対する実compile**とする。
仮想で0だったことは、実ソースで0であることの証拠にならない。

変更pathが`allowed_paths`の外に出た、または`required_paths`が変わっていない場合は、
ゲート評価の前に`scope_drift`で落とす。本repositoryが変換で変化していないことは器が既にassertする。

### 5. rc2系は変換器の実装後に退役させる

`rc2-campaign.mjs`と`rc2-delivery-policy-transform.mjs`はどこからもimportされておらず、
`npm run check`の対象にも入っていない。壊れていても気づけない状態で、実装根拠として参照するには弱い。

ただし先に消さない。隔離worktreeでの限定変換、変換前後のoracle比較、mutation matrix、
再indexへの同一query set適用という知見はこの2ファイルにしか無い。`rt-003`と`rt-004`で
変換器と検証器へ吸収し、**吸収を終えてから**退役させる。順序を逆にすると参照先を失う。

## Consequences

候補生成（`seam-proposal compile`）が出す情報が増える。三面を出せない構成——たとえば共有helperが
所有surfaceへ依存してしまう構造——は、候補にならず`unknown_requires_evidence`のまま残る。
**適用できない候補を候補と呼ばなくなる**ので、実データで候補が出る件数は一時的に減りうる。

実データの`src/todo-gantt-html.mjs`は三面へ分かれる見込みである。所有2面、共有1面（helper群）、
残余1面（原path、公開入口と再export）。

外部挙動同等性の判定基準は本ADRでは決めない。`rt-004`が、focused testの通過に加えて何をもって
「同じ」とするかを裁定する。

## Open questions

1. **共有surfaceの粒度。** 所有surfaceが依存する未宣言symbolを1つの共有fileへまとめるか、
   依存の塊ごとに分けるか。実データ1件では判断材料が足りない。
2. **外部挙動同等性の基準。** `rt-004`で裁定する。focused testの通過だけで足りるとは決めていない。
3. **所有surfaceのpath命名。** 現在は`<stem>.seam-<hash><ext>`である。人が読む名前へ変えるかは、
   閉ループが1周してから決める。命名を先に議論すると、動くものが遅れる。
