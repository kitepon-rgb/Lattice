# Changelog

## 0.6.1 — 2026-07-19

- NPM pack前にsensorを必ずbuildし、gitignoreされた古い`dist`が公開物へ混入する経路を塞いだ。
- `0.6.0`の公開物でNode.js 26を誤って遮断した生成物を、source契約どおりNode.js 25だけを拒否する生成物へ更新した。

## 0.6.0 — 2026-07-19

- `lattice todo revise`で、active planを直接書き換えずsuccessor revisionを原子的に発行できるようにした。
- `lattice.todo_plan.v3`、`lattice.todo_event.v2`、
  `lattice.todo_revision.v1`を追加し、task stateのcarry・reset・removedを
  機械検証する。
- source inventoryとreconciliation digestをrevisionへ固定し、source drift、
  stale predecessor、異なるretry bytesをfail closedにした。
- `lattice todo status`と`lattice todo verify`へrevision・reconciliation状態を
  公開した。
- removed taskのpredecessor journalとevidenceを不変保存し、crash recoveryとexact retryを検証した。
- Node.js 26を正式サポートし、既知の非互換があるNode.js 25だけを拒否するようにした。

## 0.5.0 — 2026-07-18

- 依存工程図renderer v7と、active taskの未達依存を示すstatus v2を追加した。
