# ADR 0180 — 往復強制のdispatch gateは助言であり拒否ではない

- Status: Accepted
- Date: 2026-08-20
- Supersedes: [ADR 0063](0063-ready-frontier-dispatch-contract.md) Decision 3–4 の拒否
- Relates: [ADR 0128](0128-todo-independence-operational-wiring.md)、
  [ADR 0160](0160-process-obligations-are-machine-held.md)、
  [ADR 0145](0145-the-verification-net-is-a-gate-not-a-cage.md)
- 維持: ADR 0063 の frontier 投影（`dispatch_frontier`、並列開始の案内コマンド）

## Context

複数readyでの plain `todo start`、直列理由の正規表現審査、`--serial-confirmed` の二往復、
`plan create` / `todo migrate` の `--serialization-reviewed` は、並列既定を「機構で守る」ために
拒否していた。結果、他のAIは着手・作成できず、トークンを儀式に焼いた。

ADR 0128 は助言であって拒否ではない、ADR 0160 は未判定は dispatch を塞がない、と既に決めてある。
往復強制はその決定を入口で破っていた。判断を製品が正規表現で再実装するのも、所有境界に反する。

## Decision

1. `todo start` は対象が ready なら `--parallel-frontier` / `--override-reason` /
   `--serial-confirmed` なしで通る。
2. 直列理由を正規表現で審査しない。理由は event payload に記録するだけである。
3. `plan create` と `todo migrate` は直列度で拒否しない。`dispatch_shape` は結果に残す。
4. `--parallel-frontier` が適用できない時（対象が `next_ready` に無い）の
   `PARALLEL_DISPATCH_INVALID` は残す。用法誤りであり、往復強制ではない。
5. 旧flagは互換のため受理し、門にしない。
6. frontier の投影は残す。並列既定は status の案内であり、進行を止めない。

## Consequences

- `PARALLEL_DISPATCH_REQUIRED`、`PARALLEL_DISPATCH_RECONSIDER`、
  `serial_reason_is_not_an_interference`、`plan_shape_too_serial` は出ない。
- 1人のAIが ready 2件を見ても、start / migrate / plan create の前にコマンドを往復しない。
- 並列を選ぶ判断は操作しているAIが持つ。装置は観測と記録を返す。
