# ADR 0063: ready frontier全件を並列dispatchの既定にする

- Status: accepted
- Date: 2026-07-21

## Context

Phase監査順とToDo schedulingを分離しても、`next_ready`が候補一覧であるだけでは、AI hostが先頭一件を
選び続けて実行を直列化できる。必要なのはPhaseや重監査を増やすことではなく、ToDo DAGが同時にreadyと
判定した集合を実行契約として明示し、意図的なsubset選択だけに説明責任を持たせることである。

一方、LatticeはAI hostのthread、sub-agent、provider sessionを所有しない。Latticeが宣言だけで全agentの
実起動を成功扱いすると、実状態と工程投影が乖離する。

## Decision

1. `lattice.todo_status_result.v4`へ`lattice.todo_dispatch_frontier.v1`を追加する。
2. frontierは現在の`next_ready`全件を含み、policy、推奨同時数、subset理由要否、開始flag、digestを返す。
3. readyが複数かつactive taskがない時、最初の`todo start`は`--parallel-frontier`による並列方針宣言、
   または`--override-reason <reason>`による意図的直列化理由を必須とする。
4. plain startは`PARALLEL_DISPATCH_REQUIRED`でstore無変更のまま拒否する。単一ready等への不要な
   `--parallel-frontier`も`PARALLEL_DISPATCH_INVALID`で拒否する。
5. Latticeはhostのagentを生成しない。宣言後の実状態は既存の`active_set`と`next_ready`だけから投影し、
   未着手memberを開始済みへ丸めない。
6. Phase、監査回数、required evidence、hard dependency、join、`phase_accept_dependencies`は変更しない。

## Consequences

- AI hostは複数readyを無意識に一件ずつ開始できず、並列方針か直列化理由を機械的に残す。
- `--parallel-frontier`は全件起動の完了証明ではない。host障害やcapacity不足は実際のstore状態として残る。
- Ganttはready frontierを「同時dispatch推奨」と表示し、Phase groupingを暗黙のready gateに使わない。
- `todo status` consumerはv4を受理する必要がある。v3へfieldをin-place追加しない。

## Evidence

- `test/todo-status.test.mjs`: v4 exact wire、frontier digest、推奨同時数。
- `test/todo-cli.test.mjs`: plain start拒否、並列宣言、直列化理由、不要flag拒否。
- `test/project-cli.test.mjs`: typed discoveryの並列開始command。
- `test/todo-gantt-render.test.mjs`: frontier表示とPhase scheduling分離。
- [0.10.0 release evidence](../evidence/2026-07-21-v0.10.0-ready-frontier-release.md):
  公開tarball、registry、global install、実repo smoke。
