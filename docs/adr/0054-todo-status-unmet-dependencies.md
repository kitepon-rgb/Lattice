# ADR 0054: todo status v2 の依存未達表示

- Status: accepted
- Date: 2026-07-19
- 前提: [ADR 0053](0053-todo-store-and-gantt-surface.md)、
  [ADR 0044](0044-rc3-runtime-contract.md)

## Context

`lattice todo status` の `active_set` は in-progress task の集合であり、着手可能集合ではない。
ADR 0053 Decision 2a は historical import の in-progress task に依存充足を要求せず、その状態を
`active_set` へ渡すことを明記している。通常の `start` も監査理由付き override では依存未達を許す。
したがって「active かつ依存未達」は合法だが、v1 の task 表示には両者を区別する情報がなく、consumer が
active を着手可能と誤読できる。

## Decision

- `active_set` の意味論は in-progress 集合のまま維持する。依存未達 task を除外したり blocked へ投影しない。
- `lattice.todo_status_result.v1` は不変とし、CLI の成功 result を
  `lattice.todo_status_result.v2` へ上げる。
- v2 の top-level exact keys は v1 と同じとする。`active_set[]` だけを exact keys
  `plan_key, task_id, label, unmet_dependencies` へ変更する。
- `unmet_dependencies[]` は exact keys `plan_key, task_id` を持ち、hard dependency と all-of join を
  展開した直属 predecessor のうち、現在 status が done でないものを列挙する。重複を除き、
  `plan_key`、`task_id` の順で決定的に整列する。空配列は依存充足済みを表す。
- `next_ready` は従来どおり、全 predecessor が done の pending task とする。blocked と member head の
  shape・意味論も変更しない。
- result digest と 64 KiB capture 上限は新 field を含む v2 の全 result に適用する。

## Consequences

- consumer は active と dispatchable を同一視せず、`unmet_dependencies` が空でない active task を
  依存未達として明示できる。
- dotagents は自身の編入工程で v2 exact-key parser と表示を更新してから Lattice の pin を上げる。
  Lattice は dotagents の hook を同一 commit では変更しない。
