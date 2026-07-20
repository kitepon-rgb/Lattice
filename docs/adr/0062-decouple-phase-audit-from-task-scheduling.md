# ADR 0062: Phase監査順とToDo schedulingを分離する

- Status: accepted
- Date: 2026-07-21

## Context

`lattice.todo_plan.v4`はPhaseを第一級の重監査境界として復活させた一方、前段Phaseのacceptを後段Phase所属ToDoの
start/done条件へ暗黙に追加した。この結合により、ToDo DAGが許す並列作業までPhase単位で直列化される。
必要なのはPhaseを消すことでも重監査を増やすことでもなく、既存Phaseとその監査契約を保ったまま実行順の責務を
ToDo DAGへ戻すことである。

## Decision

1. v4は互換契約として変更しない。
2. `lattice.todo_plan.v5`では、通常ToDoのreadinessをhard dependencyとjoinだけで決める。
3. `predecessor_phase_ids`はPhase review/acceptの順序だけを表す。
4. Phase acceptが本当に必要なToDoだけを`phase_accept_dependencies`のPhase ref→task refで宣言する。
5. task→所属Phase gate、Phase前後関係、明示Phase accept dependencyを通常task graphと合成し、cycle、dangling ref、
   cross-plan topology bindingをactivation前に検査する。
6. 初期authoringは`lattice.plan_create_input.v3`、successorは`lattice.phase_todo_revision.v2`を使う。
7. v5導入はPhase数、監査回数、required evidence slotを増減しない。

## Consequences

- Phaseが監査上lockedでも、ToDo DAG上readyな所属ToDoは並列に開始できる。
- Phase reviewは所属ToDoが全てdoneかつ前段Phase acceptedの時だけ開始できる。
- 明示Phase accept dependencyのtargetだけはacceptまで開始・完了できない。
- accepted Phaseのreopenは、明示dependency先が開始済みならoverrideを要求する。単に後段Phase所属ToDoが先行開始した
  だけではreopenを閉じない。
- GanttはPhase監査状態とToDo候補を別の意味として表示する。

## Evidence

[2026-07-21 Phase scheduling decoupling](../evidence/2026-07-21-phase-scheduling-decoupling.md)を参照する。
