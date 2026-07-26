# rt-001: 実変換の受入契約を裁定した

- 日付: 2026-07-27
- plan: `real-transform` / task `rt-001`
- 裁定: [ADR 0137](../adr/0137-real-transform-acceptance-contract.md)

## 分かったこと — 現行の候補は実行できない

実データの`seam_candidate`を適用しようとして、記録が足りないことが分かった。

対象は`src/todo-gantt-html.mjs`（`tio-008`と`tio-009`の係争path）。記録された提案surfaceは
所有側2つだけである。

```
current:  path src/todo-gantt-html.mjs  shared_path  ['tio-008','tio-009']
proposed: src/todo-gantt-html.seam-13d0e295b0efa4c1.mjs -> ['tio-009']  task_owned
          src/todo-gantt-html.seam-952ce9f0993da67e.mjs -> ['tio-008']  task_owned
```

宣言symbolを新fileへ移すだけでは3つ壊れる。構造はsensorで確認した。

1. **未宣言の共有helperが宙に浮く。** `tio-009`が宣言した5 symbolは、どちらのToDoも宣言していない
   `escapeHtmlText`／`escapeHtmlAttribute`／`refKey`／`compareText`／`taskReference`／
   `presentationLookup`／`foldIndex`／`statusMarkup`／`DOCUMENT_STATUS`／`SEVERABILITY_LABEL`に依存する。
2. **循環importになる。** 原fileに残る`renderTodoGanttHtml`が`renderRightPane`（移動先）を呼び、
   移動した`renderRightPane`が原fileのhelperを呼ぶ。
3. **残余が記録に無い。** 原pathに何が残るかを提案が述べていないので、適用後の姿が一意に決まらない。

これはADR 0133 Open question 2（宣言が資源の一部しか覆わない時の残余）とADR 0132 Open question 2が、
実行しようとした瞬間に実務問題として現れたものである。**read-onlyで止まっている限り露見しなかった。**

## 裁定

| 論点 | 裁定 |
|---|---|
| 変換後の姿 | 所有surface（`task_owned`）・共有surface（未宣言の依存先、所有者なし）・残余surface（原path、公開入口と再export）の**三面すべて**を候補が挙げる。三面が揃わない候補は変換の入力として受理しない |
| 依存の向き | 「所有 → 共有」「残余 → 所有」の一方向に固定。共有が所有を参照する候補は循環を作るので拒否 |
| 呼び出し側 | 書き換えない。原pathが再exportするので外部のimportは一行も変わらない。`allowed_paths`による封じ込めを守るため |
| 受入ゲート | `behavior_equivalent`／`focused_tests_passed`／`sensor_fresh`／`overlap_reduced`の4つ全通過。1つでも欠けたら不採用 |
| `overlap_reduced`の意味 | 仮想再compileの再実行ではなく、**変換後の実ソースを再indexして同じ宣言で実compile**し、残余conflict 0を確認する。仮想で0だったことは実ソースで0である証拠にならない |
| rc2系の断線 | `rt-003`／`rt-004`で知見（隔離worktreeでの限定変換、oracle比較、mutation matrix、再indexへの同一query set適用）を吸収してから退役させる。先に消すと参照先を失う |

## 帰結

候補生成が出す情報が増える。三面を出せない構造は候補にならず`unknown_requires_evidence`のまま残るので、
**実データで候補が出る件数は一時的に減りうる**。適用できない候補を候補と呼ばなくなるための代償として受ける。

実データの`src/todo-gantt-html.mjs`は所有2面・共有1面・残余1面へ分かれる見込み。

## この記録が主張しないこと

- 変換はまだ実行していない。本工程は受入契約の裁定である。
- 外部挙動同等性の基準は決めていない（`rt-004`）。focused testの通過だけで足りるとは決めていない。
- 共有surfaceの粒度と所有surfaceのpath命名は先送りした。実データ1件では判断材料が足りず、
  命名を先に議論すると動くものが遅れる。
