# ADR 0055: TODO revision と source reconciliation の successor 契約

- Status: accepted
- Date: 2026-07-19
- 前提: [ADR 0053](0053-todo-store-and-gantt-surface.md)（journal 唯一正本、immutable
  topology、successor activation、migration wave）、[ADR 0054](0054-todo-status-unmet-dependencies.md)。
  `lattice todo revise` の入力 wire を G5 着手時に固定する ADR 0053 の open item を閉じる。
- 根拠: dotagents 現役 7 文書の inventory は未完 153、完了 503、計 656 件であり、factory store は
  110 task（done 83 / pending 24 / in-progress 3）、sequence 86 を保持する。これは migration 後に
  Markdown を正本へ戻したり、状態を作り直したりせず、source inventory と store の差を一回だけ
  解消すべき実測根拠である。
- 同日実装追補（2026-07-19）: legacy v1 journalを変更せず初回revisionへ束縛するreconciliation anchorと、
  event v2 `state_migration`のexact wireをDecision 5aへ固定した。既存v1 bytesの受理集合は変更しない。

## Context

ADR 0053 は topology を immutable とし、変更を `lattice todo revise` による successor version
発行へ限定した。しかし、revision input の exact wire、初回 migration 後の source inventory をどの
ように閉じるか、そして既存 state をどの条件で successor へ移すかは未裁定だった。この空白のまま
Markdown の再読を常設化すると、journal 唯一正本、historical import の一回きり性、及び state の
監査可能性が同時に崩れる。

登録完了後の TODO 正本は Lattice であり、Markdown は照合元である。したがって source の発見は
desired state を構成する入力であって、runtime の fallback、store 削除後の再 migration、又は履歴の
再生成を正当化しない。初回 migration で `registered_unreconciled` となった plan は、exact な
revision を一回適用して `reconciled` となる。この境界を factory store から先に通す。

Codegraph は candidate dependency、owned symbol/path、caller/callee、impact、affected test を示す
構造 sensor として使える。ただし revision の正当性を証明しない。正当性は source inventory、旧 plan、
journal/manifest の digest と、発行する desired plan の digest で判断する。

## Decision

### 1. 公開入口、正本境界、対象順序

- topology と source reconciliation の唯一の公開入口は
  **`lattice todo revise --plan <plan-key> --input <revision.json>`** とする。1 invocation は 1 plan の
  full desired-state successor を発行する。patch、部分 CRUD、Markdown fallback、implicit source scan は
  持たない。
- migration 完了後は Lattice store が TODO 正本であり、Markdown は revision を作る際の照合元に限る。
  store の削除・再 migration、既存 journal/snapshot の書換え、Markdown からの status/history 再生成、
  未解決 source を pending と推測して発行することを禁止する。
- 既存 6 plan と queue は、各 plan を一度だけ migration し `registered_unreconciled` として登録した後、
  plan ごとに一度だけ reconcile revision を発行して `reconciled` にする。migration 済み plan の再 migration
  は入力 bytes が同じ場合を含めて拒否する。factory store をこの順序の最初の受入対象とする。
- revision は multi-plan atomic ではない。cross-plan edge の topology binding は ADR 0053 の activation
  gate に従い、必要な各 plan を個別の successor として発行する。`command_id`、dry-run、TODO MCP、
  generic transition、task merge、description/acceptance/priority/owner の管理面、及び transition verb の
  追加は初回の非目標とする。ADR 0053 の mutation に dry-run を持たない裁定を維持する。

### 2. `lattice.todo_revision.v1` の exact input

`revision.json` は UTF-8、BOM/CR/trailing bytes なしの canonical JSON value + LF とし、schema は
literal **`lattice.todo_revision.v1`** とする。top-level exact keys は次だけである。

`schema, project_id, plan_key, predecessor, desired_plan, task_migration, source_inventory,
reconciliation, revision_digest`

- `predecessor` の exact keys は `plan_digest, journal_head_digest, plan_version`。いずれも active
  manifest member と exact 一致しなければならず、null anchor、旧 digest、又は別 plan を拒否する。
- `desired_plan` は Decision 3 の完全な `lattice.todo_plan.v3` である。predecessor digest は
  `predecessor.plan_digest`、project/plan key は top-level と exact 一致する。revision は差分でなく全 desired
  topology を渡すため、入力に無い旧 task/edge/join も意図的な削除候補として検査できる。
- `task_migration` は predecessor の全 task をちょうど一度ずつ列挙する配列である。各 entry の exact keys は
  `from_task_id, to_task_id, state_policy`、`to_task_id` は successor task ID 又は literal `removed`、
  `state_policy` は `carry | reset_pending | removed` のいずれかとする。`removed` は
  `to_task_id: removed` とだけ組み合わせ、非 removed target は `carry` 又は `reset_pending` とだけ
  組み合わせる。同一 predecessor ID の重複、欠落、unknown target、new task への migration entry を
  拒否する。
- `source_inventory` の exact keys は `active, excluded_tombstones`。各 active entry は exact keys
  `task_id, source_ref, source_digest`、各 excluded tombstone は exact keys
  `source_ref, source_digest, exclusion_reason` とする。`source_ref` は repo 相対の固定 source item ref、
  `source_digest` はその source item の canonical digest、`exclusion_reason` は bounded な明示理由である。
  active task ID は desired plan task と 1:1 で重複なく対応し、tombstone は active と source item を重複
  させない。source inventory は Markdown 本文の writer-side 再解釈を許す schema ではない。
  `active`はdesired planのtask順（task ID昇順）、`excluded_tombstones`は`source_ref`昇順に固定し、
  logical inventoryが配列順だけで別revision identityになることを禁止する。
  `source_ref`は`<repo相対path>#L<1-based line>`のexact grammarとし、pathはsymlinkを含まないrepo内
  regular file、lineはcurrent worktreeのraw UTF-8をLFだけで分割した固定行である。`source_digest`は
  行末LFを含まない当該raw line bytesのSHA-256。別行探索、title match、CR除去、Unicode正規化をしない。
  ref不正、file/line欠落、digest不一致は`RECONCILIATION_INCOMPLETE`でactivation前に拒否する。
- `reconciliation` の exact keys は `predecessor_reconciliation_digest, source_inventory_digest,
  reconciliation_digest`。前二者はそれぞれ predecessor の現在 reconciliation digest と本 input の
  inventory digest を束縛し、最後はそれら、predecessor、desired plan、migration を含む canonical
  preimage の self digest とする。`revision_digest` は top-level から自身を除く canonical bytes の
  SHA-256 である。canonical input bytes と revision digest は、同じ revision retry を識別する。

### 3. `todo_plan.v3` と親子検査

- `lattice.todo_plan.v3` は v2 を継承し、**新 field は task の `parent_task_id` だけ**とする。v3 task の
  exact keys は `task_id, title, lane, narrative_ref, narrative_anchor, compile_binding, parent_task_id`。
  `parent_task_id` は null 又は同一 plan の task ID である。description、acceptance、priority、owner を
  v3 又は revision に追加しない。
- v1/v2 reader は既存 bytes を既存 schema として読み続ける。v3 reader は v3 を dispatch して読む。
  active v2 を in-place upgrade せず、v3 successor だけが導入できる。旧 `todo_event.v1` の raw bytes と
  digest preimage は再解釈しない。
- v3 の local validation は task ID の一意性に加え、各 non-null parent の存在、self parent の禁止、及び
  parent chain の cycle 禁止を hard 検査する。親子は表示/分解の局所構造であり、hard dependency、join、
  lane、compile binding、又は status 遷移を暗黙に生成しない。
- desired plan の hard dependency/join は ADR 0053 の local reference、duplicate、self edge、join
  closure、DAG 検査を再実行する。removed task を指す残存 edge/join/parent は発行前に拒否する。

### 4. state migration と source-seeded task

- migration は predecessor task ごとに一回だけ評価する。**意味同一の 1→1** は `carry` の唯一の受理
  条件である。意味同一とは、from/to が 1→1 で、task の実行上の意味を定める task identity、title、
  parent、lane、narrative binding、compile binding、及び当該 task の hard dependency/join 参加が、ID の
  名前替えを除き canonical に等しいことである。これを満たす場合だけ status（pending / in-progress /
  blocked / done）、started/done timestamp、blocked reason、evidence、`imported` を carry する。
- task の意味又は依存/親構造が変わる 1→1 は `reset_pending` を必須とする。reset は predecessor の
  state を successor journal へ持ち込まず、successor task を pending、timestamp/evidence/blocked reason
  なしで開始する。writer が carry 可否を推測して reset 又は carry へ丸めることはない。
- N→1 merge は初回から拒否する。1→N split も carry を許さず、各 successor task を new/source-seeded 又は
  明示 `reset_pending` とする。`removed` task は successor active topology から除くが、旧 plan version、
  旧 journal、snapshot、event evidence を不変の履歴として残す。
- desired plan にのみ存在する task は source inventory の active entry を必須とする。これを
  **source-seeded** と呼び、初期 state は pending とする。source checkbox が完了又は作業中であっても、
  successor が status/timestamp/evidence/imported を推測して seed してはならない。既存 state を引き継ぐ
  には上記 migration entry が必要である。
- successor genesis は migration disposition、state policy、predecessor plan/head digest、revision digest、
  reconciliation digest を immutable payload として記録する。carry された状態は genesis の versioned
  migration payload から projection され、通常 authoring event を偽造しない。旧 version の genesis は
  `registered_unreconciled`、revision successor の genesis は `reconciled` という literal reconciliation
  state を持つ。

### 5. event v2 と legacy 保全

- revision successor の journal genesis とその migration payload は `lattice.todo_event.v2` とする。
  v2 は v1 envelope を in-place 拡張しない別 schema であり、`reconciliation_state`, `revision_digest`,
  `reconciliation_digest`, `state_migration` を versioned exact fields として追加する。readerはv1/v2を
  schema dispatchし、revision successorでは先頭のv2 genesis 1件と、それに続く既存v1 transitionだけを
  許す。v2 transition、v1 genesisとの混在、2件目のgenesis、又はv2以外から始まるrevision successorを
  拒否する。
- `lattice.todo_event.v1` は legacy reader の受理集合と bytes を不変に保つ。v1 event の digest を v2
  preimage で再計算する、v1 genesis を補正する、snapshot から v1 event を復元する、又は既存 journal
  segment を rewrite することを禁止する。
- revision 以外の既存 transition の event v1/v2 化と transition verb の設計は後続 ADR に委ねる。初回
  revision は closed event kind を増やさず、`plan_genesis` の versioned payload で state migration を
  表す。

### 5a. reconciliation anchor と `state_migration` exact wire（実装追補）

- active predecessorがlegacy `lattice.todo_event.v1` genesisの場合、現在のreconciliation anchorは保存fieldを
  推測せず、exact object `{schema: lattice.todo_reconciliation_anchor.v1, state:
  registered_unreconciled, plan_digest, journal_head_digest}`のcanonical digestとして導出する。
  plan/headはactive manifestが検証済みの実digestである。同じlegacy bytesから常に同じanchorを得て、
  journalへ追記・補正しない。
- active predecessorがrevision発行済みの`lattice.todo_event.v2` genesisの場合、現在anchorはgenesisの
  `reconciliation_digest`である。v2でliteral `registered_unreconciled`を新規発行してはならない。
- event v2 envelopeのexact keysはv1の13 keysに`reconciliation_state, revision_digest,
  reconciliation_digest, state_migration`を加えた17 keysである。初回v2は`kind: plan_genesis`,
  `task_id: null`, `reconciliation_state: reconciled`に限定する。通常transitionはADR 0056どおりv1を維持する。
- v2 genesis payloadはv1と同じexact keys `plan_digest, topology_digest, predecessor_plan_digest,
  task_migration`を持つ。`task_migration[]`はrevision inputの各entryから`state_policy`を除いた
  `{from_task_id,to_task_id}` projectionであり、旧reader互換を主張せずv2 validatorが独立検証する。
- `state_migration[]`はpredecessor taskをfrom ID順にちょうど一度ずつ列挙し、各entryのexact keysは
  `from_task_id, to_task_id, state_policy, state`である。前三者はrevision inputとexact一致する。
  `reset_pending`と`removed`は`state: null`、`carry`だけが次のexact stateを持つ。
- carry stateのexact keysは`status, started_at, done_at, blocked_reason, evidence, imported`。
  statusは`pending | in-progress | blocked | done`。pendingは他5値がnull/null/null/null/false、
  in-progressはdone/reasonがnull、blockedはnon-null reasonかつdoneがnullとする。両者のevidenceは
  authoredならnull、historical importなら元のimport source又はreopen後のnullを許す。doneは
  reason nullかつevidence non-nullとする。`started_at`/`done_at`はstrict timestamp又はnullで、
  historical unknownだけがnullを持てる。evidenceはauthored descriptor又はhistorical import source、
  `imported`はその種別と一致する。read-time注釈`evidence_unverified`はjournalへ保存せず再検証で導出する。
- v2 `reconciliation_digest`はexact preimage `{schema: lattice.todo_reconciliation_binding.v1,
  predecessor_reconciliation_digest, source_inventory_digest, predecessor, desired_plan_digest,
  task_migration_digest}`のcanonical digestとする。`task_migration_digest`はrevision inputの
  `task_migration`全体、`desired_plan_digest`は検証済みv3 plan digestへ束縛する。

### 6. reconciliation complete 性と発行 protocol

- source inventory の完全性不変条件は
  **`source_inventory_count = active_task_count + excluded_tombstone_count`** とする。全 source TODO は
  desired plan の active task 又は理由付き excluded tombstone のどちらか一方で説明される。重複、無根拠の
  tombstone、active task に対応しない source、又は count 不一致は `RECONCILIATION_INCOMPLETE` とし、
  一件でもあれば successor を発行しない。
- revision は plan 全体の all-or-nothing transaction である。source inventory、desired topology、parent
  graph、migration、state policy、cross-plan binding、anchor、新規 source-seeded state、digest の全検査を
  manifest 更新より前に完了する。未解決 item を部分 version、部分 snapshot、又は warning 成功へ丸めない。
- lock 内で active manifest/plan/journal を canonical bytes から再読し、`predecessor` の plan digest/head と
  reconciliation anchor を CAS 検査する。stale predecessor は `STORE_WRITE_CONFLICT` の
  `detail.reason: stale_predecessor` とし、store bytes を変えない。
- durability 順序は、非member staging にcanonical revision input、v3 plan、v2 genesis journal、snapshot を
  fsyncして置き、全 read
  back/verify を通した後、**manifest CAS rename を最終 commit point** とする。manifest 前の artifact は
  reader に見えず、crash recovery は ownership marker と revision digest を確認して安全に resume 又は
  garbage として隔離する。manifest 後は active member が plan/genesis/snapshot/reconciliation digest の
  全体を指す。
- 同じ `revision_digest` と canonical input bytes の retry は、既に activation 済みなら同じ
  `todo_revise_result.v1` を返し、crash 中断なら exact bytes の staging を検証して同じ結果へ resume する。
  同じ predecessor identity に異なる input bytes/revision digest を与える retry は
  `REVISION_CONFLICT` の `detail.reason: revision_bytes_conflict` とする。自動的な別 revision 選択はしない。
  plan/staging 作成、plan durable、genesis durable、snapshot durable、manifest CAS 前後の各 crash point を
  recovery fixture で固定する。

### 7. result、error taxonomy、verify

- 成功 result は `lattice.todo_revise_result.v1` とし、exact keys は `schema, project_id, plan_key,
  predecessor_plan_digest, predecessor_journal_head_digest, plan_version, plan_digest, topology_digest,
  journal_head_digest, revision_digest, reconciliation_digest, result_digest` とする。`plan_version` は
  循環を避けるため`plan_version`はrevision digestそのものから導かない。exact preimage
  `{schema: lattice.todo_revision_version.v1, project_id, plan_key, predecessor, desired_topology,
  task_migration, source_inventory}`のcanonical digest先頭24桁を`rev-`へ連結する。`desired_topology`は
  desired planから`schema, project_id, plan_key, predecessor_plan_digest, tasks, hard_dependencies, joins`だけを
  取り、`plan_version, topology_digest, plan_digest`を含めない。導出versionをdesired planへ設定してplan
  digestを確定し、最後にreconciliation/revision digestを確定する。同じlogical revisionは同じversion
  identityになり、時刻・乱数・retry回数で変化しない。入力version不一致は`REVISION_INVALID`で拒否する。
- typed error は既存の `STORE_CORRUPT`、`STORE_INCONSISTENT`、`STORE_WRITE_CONFLICT` を維持し、revision
  専用の `REVISION_INVALID`（exact schema/digest/policy/parent/merge 違反）、`RECONCILIATION_INCOMPLETE`
  （inventory 又は source 解決不能）、`REVISION_CONFLICT`（同一 logical revision の異 bytes）を加える。
  CLI は ADR 0053 の exit wire に従い、failure では stdout 空、stderr の `lattice.cli_error.v2` 1 行、
  store bytes 不変とする。rollback は manifest commit 前なら非member staging の再実行可能な隔離、commit
  後なら新たな successor revision のみで行い、active/legacy journal の巻戻しはしない。activation後も
  successor version直下のimmutable `revision.json`を保持し、reader/verifyはplan、genesis、migration、
  reconciliationとのexact bindingを再検証する。transaction markerだけを履歴正本にしてはならない。
- `todo verify --plan` は v1/v2 plan/event を legacy schema として byte/digest exact に検証し、v3/v2
  successor では revision digest、deterministic plan version、migration 1回性、carry/reset/source-seeded
  projection、reconciliation state、source inventory count を追加検証する。`todo status` と `todo verify` は
  unreconciled/reconciled を機械可読に表示し、reconciled の成功を inventory 検査抜きで主張しない。

### 8. 必須 red test と受入

実装前に失敗する fixture を置き、少なくとも次を受入条件とする。

- v1 event の raw bytes/digest 保持と v2 event schema dispatch、pending/in-progress/blocked/done の全 carry、
  evidence/timestamp/blocked reason/imported の carry、意味変更時 reset、removed の旧履歴保持、N→1 merge 拒否。
- source-seeded task の pending 初期化、parent の absent/self/cycle 拒否、null predecessor anchor 拒否、
  source inventory count 不一致・未説明 item 拒否、stale predecessor 拒否。
- staging から manifest activation 前後までの各 crash point recovery、同一 revision の idempotent success/
  exact-byte resume、異 bytes conflict、rollback が旧 journal を変えないこと。
- status/verify の reconciliation 表示と digest 検証、factory store の実 110 task の state
  （done 83 / pending 24 / in-progress 3、sequence 86）を migration predecessor と比較して、carry/reset
  の結果が裁定どおりであること。

## Consequences

- G5 は revision input compiler、v3 plan validator、v2 genesis reader/writer、manifest-CAS recovery、
  revision/status/verify fixture を実装する。0049 の MCP surface は変更しない。
- Markdown は今後も source reconciliation の証拠として残るが、store の読取・表示・状態遷移の fallback
  にはならない。未解決 source は明示 tombstone 又は revision 入力の修正へ戻り、store への部分反映を
  起こさない。
- Codegraph は revision 作成時の dependency 候補の根拠に留まり、source/plan/store digest を置き換えない。
