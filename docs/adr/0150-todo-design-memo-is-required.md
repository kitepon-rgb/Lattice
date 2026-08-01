# ADR 0150: ToDoは設計メモを持ち、個別工程の右ペインが自動供給する

- Status: Accepted
- Date: 2026-08-01
- Supersedes in part: [ADR 0067](0067-right-pane-shows-the-store-and-orders-by-activity.md) Decision 1、
  [ADR 0149](0149-task-notes-are-a-third-layer.md) Decision 8
- Plan: [AIが壊さず使えるToDo authoringと設計メモ表示](../plan_ai-safe-todo-authoring.md)

## Context

従来、AIはToDo／PLAN Markdownへ、短い題名だけでは復元できない設計判断、実装方針、棄却案、
注意、受入条件を蓄積していた。Lattice移行後は依存と状態だけがstoreへ入り、`narrative_ref`は
file参照、task noteは任意の後付けになった。その結果、新規planを追加してもnote chainは空、
`narrative_anchor`はnullのまま成功し、次のAIとGantt右ペインへ詳細情報が届かなかった。

ADR 0067は元Markdown本文を右ペインへ描画しないと決め、ADR 0149は公開面からnote本文を一律除外した。
どちらも「個別ToDoを見れば設計メモを理解できる」という製品要求と両立しない。情報漏洩対策を、
必要情報の不在で実現してはならない。

## Decision

1. **新規ToDoはMarkdown設計メモを必須とする。** 題名、file参照、空note chainだけでは
   authoringを成功させない。実際に何も考えていない場合は、設計メモ本文へ固定値`NO_PLAN`を明示する。
   Latticeは設計内容の質を採点せず、空欄だけを拒否する。
2. **初期設計メモと作業noteを分ける。** 設計メモはplan versionへ束縛されたToDo内容、noteは
   着手後に増えるappend-only作業記憶である。どちらもLatticeの個別ToDoから読める。
3. **通常入口へ自動供給する。** `todo show`、成功する`todo start`、動的dashboardの
   右ペインは、別commandを要求せず設計メモを返す。noteはその下へ来歴付きで表示する。
4. **公開面は設計メモを表示する。** 設計メモへ秘密を書かない規範を維持し、公開を理由に全文を
   一律除外しない。非公開情報が必要な場合は明示的なvisibility契約で扱い、silent suppressionをしない。
5. **authoring gateを置く。** migrate／plan create／revisionの新規ToDoについてcoverageを検証し、
   欠落task ID、必要field、次の一手をtyped errorで返す。欠落時はstore bytesを変えない。
6. **既存Markdownを捨てない。** live planのToDo／PLAN Markdownに残る設計メモを対応ToDoへ一度移送し、
   公開右ペインの実表示を受入証拠にする。
7. **Latticeは文章生成を所有しない。** 操作するAIが文章を作り、Latticeは存在、上限、束縛、移行、
   表示、欠落時の拒否を所有する。
8. **AIへの問いかけを固定する。** authoringのschema、dry-run、拒否detail、scaffold／helpは、
   「あなたがこのToDoに対して、何も考えていないならば、設計メモに `NO_PLAN` と書いてください」
   と案内する。`NO_PLAN`を受理した場合も隠さず、通常readと右ペインへそのまま表示する。

## Consequences

- task schema／authoring schema／通常read result／Gantt rendererのversioned拡張が必要になる。
- legacy planはread可能に保つが、詳細欠落を右ペインで明示する。
- plan authoringの入力は増える。しかし次のAIが設計を再調査する往復と、空の工程を着手する事故を防ぐ。
  本当に無計画ならそれが可視化され、AIや人が計画不在を事実として判断できる。
- ADR 0067の「元Markdownを一切描画しない」、ADR 0149の「公開面で本文を一律除外する」は、
  本Decisionと衝突する範囲で失効する。
