# Changelog

## 0.9.0 — 2026-07-21

- first-class Phase controlを追加し、ToDo完了時の軽量確認とPhase境界の重監査を分離した。
- `todo phase status/review/accept/reject/reopen`、Phase state migration、Decision evidenceを追加した。
- `todo revise-set` v3でPhase revision同士、およびPhase revisionと通常revisionのcross-plan atomic activationに対応した。
- `todo status/verify --json`の互換aliasを復旧し、cross-plan start/done/reopenの判定をmerged storeへ統一した。
- loopback-onlyのlive Ganttを追加し、静的Ganttには`current / stale / missing`を判定するdigest付きstatus面を追加した。
- bounded seamの隔離transform契約を追加し、許可locus外の変更をfail closedにした。
- 外部Codegraph runtime・旧cache/dataへの依存を廃止し、配布物内のLattice sensorだけを正式runtimeとした。
- Phase revisionの全6 durability境界と、通常／Phase混在revision setのcrash retryを検証した。

## 0.8.0 — 2026-07-20

- project-local run storeと`run list/resume/close/abandon`を正式化した。
- runtime/control timestampをcanonical UTC millisecondsへstrict化した。

## 0.7.3 — 2026-07-20

- private Lattice sensor runtimeを配布物へ固定し、公開`codegraph` binを除去した。

## 0.7.0 — 2026-07-20

- Codegraph由来実装をLattice所有sensorへ吸収し、公開入口を`lattice sensor`へ切り替えた。

## 0.6.4 — 2026-07-19

- `readTodoStore`のpinned source検証を1回のread内でcommit・blob単位にmemoizeし、同じsourceを持つhistorical import taskごとの重複`git cat-file`を除去した。
- 653 active tasks / 7 plansのdotagents実storeで`lattice todo status`を8.41秒から0.29秒へ短縮し、Claude/Codex SessionStart hookの内部5秒timeout内へ戻した。

## 0.6.3 — 2026-07-19

- source verifierで`0a. [x]`や`6A. [ ]`など数字＋英字付き番号のcheckboxを正規TODOとして認識するようにした。
- dotagents inventoryとLattice reviseのcheckbox認識を揃え、migrate後のanchor校正が`source_item_not_todo`で停止する不一致を解消した。

## 0.6.2 — 2026-07-19

- `carry_reconciled_metadata`を追加し、実行意味と依存を変えずにsource provenanceと親子関係だけを校正できるようにした。
- metadata校正時も既存task state・evidenceを保存し、title・lane・compile binding・dependency・join変更はfail closedで拒否する。

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
