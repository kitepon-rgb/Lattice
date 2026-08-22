# ADR 0056: TODO authoring transition CLI の入力・actor・result 契約

- Status: accepted（Decision 1 の exact argv 順、Decision 2 の欠落拒否、Decision 3 の相対path／descriptor専用は [ADR 0181](0181-authoring-entry-accepts-drafts.md)、Decision 4 の historical unknown done 限定は [ADR 0183](0183-done-evidence-can-be-rebound-by-an-audited-event.md) が置き換える）
- Date: 2026-07-19
- 前提: [ADR 0053](0053-todo-store-and-gantt-surface.md)（closed 状態機械、exact argv、
  journal 唯一正本、単一 writer）、[ADR 0055](0055-todo-revision-and-source-reconciliation.md)
  （topology と source reconciliation は `todo revise` が所有）

## Context

ADR 0053 は `start / block / unblock / done / evidence promote / reopen` の argv と遷移条件を
固定したが、CLI が event envelope の actor をどこから得るか、成功 result の exact wire、
descriptor JSON の読取規律、`reopen` と evidence promotion が参照する最新 done digest の
解決境界は未裁定だった。これらを hostname、PID、曖昧な JSON、又は lock 外の read による
暗黙値で埋めると、Stop hook との相関、canonical audit、CAS が成立しない。

ADR 0055 により topology と source inventory の reconciliation は `todo revise` に統合された。
したがって ADR 0053 の独立 `todo reconcile` 行は本 ADR で廃止し、通常 authoring transition と
successor revision を別の公開面として維持する。

## Decision

### 1. 公開 verb と exact argv

- 公開 verb は ADR 0053 の `start / block / unblock / done / evidence promote / reopen` を維持する。
  flag の順序、個数、重複拒否、exit 0/1/2 wire も ADR 0053 を継承する。
- `todo reconcile` は実装しない。source reconciliation は ADR 0055 の
  `todo revise --plan <key> --input <revision.json>` が唯一の入口である。
- mutation は dry-run、自動 retry、暗黙の plan/task 選択を持たない。

### 2. actor と時刻

- mutation CLI は environment の exact 3 値
  `LATTICE_TODO_ACTOR_HOST`, `LATTICE_TODO_ACTOR_SESSION`, `LATTICE_TODO_ACTOR_AGENT` を
  event の `{host, session, agent}` へそのまま写す。3 値はすべて todo identifier でなければならない。
- 1 値でも欠落・空・不正なら `ACTOR_UNRESOLVED` / `detail.reason: actor_environment_invalid`
  で無変更拒否する。detailは`required_environment`、`missing_environment`、`invalid_environment`と
  `next_action: set_required_actor_environment_and_retry`を返し、callerが不足と形式不正を区別して
  正規設定後に同じmutationを再試行できるようにする。OS hostname、PID、ユーザー名、親 process、乱数への fallback は禁止する。
  hook と AI shell は実 session identity を明示的に渡す。
- `recorded_at` は writer が lock 取得後に観測する UTC `Date#toISOString()` とする。CLI 引数や
  environment から時刻を注入しない。test は store primitive の既存 `now` seam を使い、公開 CLI に
  test-only flag を追加しない。

### 3. descriptor input

- `done` と `evidence promote` の descriptor file は repo 内相対 ref の regular file に限定する。
  absolute／traversal refはargvのusage違反、構文上validなrefのrepo外解決、symlink、alias、欠落、
  8 MiB超過はtyped errorとして、いずれも無変更拒否する。
- bytes は UTF-8、BOM/CR なし、comment/trailing comma/duplicate key なしの単一 JSON value とする。
  value は `lattice.todo_event.v1` の evidence descriptor exact schema を満たさなければならない。
  descriptor file 自体の canonical byte 一致は要求しないが、event へは parsed value を canonicalize して
  記録する。write 時の Git object、content digest、repo mapping の hard 検証は store writer が所有する。

### 4. lock 内 target 解決

- `reopen` の `target_done_digest` は CLI が lock 外で journal を読んで渡してはならない。
  store writer が lock 内で active member を再読し、当該 task の現在有効な最新 completion digest を
  解決して event へ記録する。対象が done でない、又は後続開始済みで override がない場合は既存の
  transition error で無変更拒否する。
- `evidence promote` も同様に、lock 内で未昇格の `historical_import` done を解決し、
  `target_done_digest` を event へ記録する。authored done、strict completed_at、既昇格、非 done は拒否する。
- explicit target digest を公開 argv に追加しない。store primitive の既存 explicit digest 入力は
  fixture と内部 migration 互換のため受理集合を維持する。

### 5. mutation success result

成功 result は literal `lattice.todo_mutation_result.v1` の exact-key object とする。

`schema, project_id, plan_key, plan_version, task_id, kind, sequence, event_digest,
journal_head_digest, snapshot_digest, status, result_digest`

- `kind` は実際に append した closed event kind。`evidence promote` は `done` を返す。
- `journal_head_digest` は commit 済み manifest member の head であり、成功 invocation では
  `event_digest` と一致する。`status` は append 後 snapshot の当該 task の
  `pending | in-progress | blocked | done` 投影である。
- `result_digest` は同 field を除く object の canonical self digest。stdout は JSON 一行だけとする。
- append 後の gantt 再生成はこの result と transaction に含めない。表示は破棄可能な投影であり、
  生成失敗が journal mutation を巻き戻してはならない。

### 6. 必須受入

- 全 verb の成功 wire、actor exact 記録、journal/snapshot/manifest head 一致。
- actor 欠落、不正 argv、descriptor path/JSON/schema/Git object 不正、依存未達 start、evidence なし done、
  blocked 中 done、重複 transition、後続開始済み reopen を store bytes 不変で拒否する。
- override reason 付き start/reopen、lock 内 target 解決、evidence promotion の対象制約を固定する。
- 既存 `todo verify / status / snapshot / gantt / migrate` と store primitive の fixture を非回帰とする。

## Consequences

- hook は actor 3 値を必ず設定する。対話 shell から直接 mutation する場合も利用者が session identity を
  明示するため、便利さのための偽 identity を作らない。
- G5 通常 transition は v1 event のまま実装できる。ADR 0055 の v2 genesis、plan v3、revision recovery
  とは別の focused wave とし、通常 transition の完成を巨大な revision compilerへ巻き込まない。
