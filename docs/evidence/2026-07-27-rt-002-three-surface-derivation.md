# rt-002: seam提案から三面の変換候補を導出した

- 日付: 2026-07-27
- plan: `real-transform` / task `rt-002`
- 契約: [ADR 0137](../adr/0137-real-transform-acceptance-contract.md)（三面）・
  [ADR 0138](../adr/0138-transform-acceptance-five-conditions.md)（五条件）

## 作ったもの

`src/seam-derivation.mjs`。記録済みのseam提案と宣言から、実行可能な変換候補
（`lattice.bounded_seam_candidate.v2`）を導く。

- `buildSeamDerivationQuerySet(symbols)` — 宣言symbolのcalleeを引くquery set。
  pathのconflictはaffected testしか観測していないため、同一file内の依存は別途引く必要がある
  （ADR 0133が「pathの競合には分割すべきcall graphが無い」と述べた面）。
- `deriveBoundedSeamCandidate({...})` — 三面を導き、循環を作る構成を棄却する。

契約は`lattice.bounded_seam_candidate.v1`から**v2**へ上げた。v1は単一`anchor`を前提とし、
複数symbolを複数taskへ振る形を表現できない。また検証条件が3つで、ADR 0138の五条件を持てない。

## 導出の規律

| 規律 | 理由 |
|---|---|
| 未宣言の依存先は**推移的に**共有面へ集める | 1段で止めるとhelperのhelperが原pathに残り、共有面から原pathへの辺が生き残る |
| calleeは**同一fileのexact path一致**で絞る | sensorのsymbol解決は同名の別fileへ寄る。絞らないと無関係なsymbolを共有面へ引き込む |
| 共有面から所有面へ辺が1本でもあれば**棄却** | 切ると循環importになる。所有者のいないコードが所有者のいるコードへ依存する構造そのものを作らない |
| 残余面はsymbolを**列挙しない** | 移らなかったものすべてという補集合であり、列挙すると原fileの全symbol目録が契約の一部になる |
| 宣言の無いtaskがある構成は棄却 | 片側の宣言から他方の担当を補完しない（ADR 0132 Decision 4と同じ理由） |

## 実データでの導出結果

`todo-independence-ops`の実conflict（`src/todo-gantt-html.mjs`、`tio-008`×`tio-009`）へ適用した。
宣言はstoreにcommit済みのものをそのまま使い、一切変えていない。

| 面 | path | 所有 | symbol |
|---|---|---|---|
| residual | `src/todo-gantt-html.mjs` | — | （補集合・列挙しない） |
| task_owned | `src/todo-gantt-html.seam-13d0e295b0efa4c1.mjs` | `tio-009` | `dispatchBasis`, `renderDiagramLegend`, `renderIndependenceNote`, `renderRightPane`, `summarizeIndependence` |
| task_owned | `src/todo-gantt-html.seam-952ce9f0993da67e.mjs` | `tio-008` | `CSS` |
| shared | `src/todo-gantt-html.seam-shared.mjs` | — | `DOCUMENT_STATUS`, `SEVERABILITY_LABEL`, `escapeHtmlAttribute`, `escapeHtmlText`, `foldIndex`, `planActivity`, `presentationLookup`, `refKey`, `renderPhaseProgress`, `renderRelationList`, `renderSeamProposalOverview`, `renderTaskIndex`, `statusMarkup`, `taskReference` |

**循環は無い。** 共有面14 symbolのいずれも所有面を呼んでいない。

共有面が14 symbolになったのは`renderRightPane`が推移的に引く分である。ADR 0137 Open question 1
（共有surfaceの粒度）が実データで顔を出した形だが、正しさには影響しない——依存の向きは
一方向を保っている。粒度は閉ループが1周してから決める。

## 検証

- `node --test test/seam-derivation.test.mjs` — 8 pass。三面の導出、同一file外calleeの除外、
  循環構成の棄却、依存が無い場合の二面、宣言欠落、二重所有、五条件を緩めた候補の契約拒否、query set。
- `npm test` — 971 pass / 0 fail。

## この記録が主張しないこと

- 変換はまだ実行していない。本工程は「何をどこへ移すか」を決めるところまでである。
- 共有面の粒度は裁定していない。1つにまとめる以外の選択肢を検討していない。
- 導出は宣言とsensor観測だけを入力にしており、**宣言が実態からずれていれば導出もずれる**。
  宣言の誠実さが上限であるという性質は変わらない。
