# ADR 0182 — 未検証の independence は start を拒否する

- Status: Accepted
- Date: 2026-08-21
- Amends: [ADR 0128](0128-todo-independence-operational-wiring.md) Decision 5
- Relates: [ADR 0063](0063-ready-frontier-dispatch-contract.md)（どの ready を取るか）

## Context

ADR 0128 Decision 5 は `todo start` の advisory を助言であって拒否ではないとした。
OpenLogicool の campaign で、親が現在の ready だけを independence compile し、
後続の ready を席が `todo start` してから intake が `boundary_unverified` で hold した。
start は通り、実装が始まり、実行層だけが止めた。助言は素通りされた。

どの ready を取るかは今も host の所有である。拒否するのは配車ではなく、
記録があるのに対象工程が未検証な着手を journal へ書かないことである。
intake が hold する start を成功として残すと、工程正本が嘘をつく。

## Decision

1. **記録があるのに対象工程が未検証なら `todo start` は `INDEPENDENCE_UNVERIFIED` で拒否する。**
   対象の guidance code は `independence_task_undeclared` /
   `independence_stale_for_task` / `independence_superseded` /
   `independence_contract_superseded` / `independence_verdicts_absent`。
   記録が無い（`independence_unrecorded`）と会話調整は従来どおり助言だけ。
   競合（`independence_conflict_*`）はどの ready を取るかなので拒否しない。

2. **`independence compile` は `next_ready` が witness に無いとき
   `INDEPENDENCE_READY_UNDECLARED` で拒否する。**
   compile 本体は宣言済み subset へ閉じる（ADR 0127 Decision 4）。
   CLI は frontier の ready を落とす compile を受理しない。
   remaining A（まだ done でない blocked）は同じ witness に含める運用とし、
   含めずに compile すると次の frontier の start が Decision 1 で止まる。

## Consequences

- 部分 compile のあと、未宣言の ready を start できない。
- 記録が無い plan の既存 start 試験は通る。
- Peertable の `done.sh` は feat SHA の origin/main 祖先を別に必須にする。
  これは git 着地の軸であり、本 ADR の independence 軸とは独立である。
