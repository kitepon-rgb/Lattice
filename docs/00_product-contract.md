# Lattice 製品契約（0.9.1）

## Product outcome

入力されたproduct outcome、codebase、実行capabilityから、証拠付きの並列TODO graphを生成する。
境界競合がcritical chainを作る場合は、隔離されたseam-refactorを実行し、検証後のcodebaseから
新しいplan versionを再生成できる。

## 初期公開面

初回vertical sliceでは次のversioned JSONを所有する。

- `lattice.plan_input.v1`: project、plan version、TODO候補、手動state／effect evidence。
- `lattice.boundary_manifest.v1`: graph evidence、owns／reads／writes、hard needs、conflicts、unknowns、tests。
- `lattice.boundary_verdict.v1`: `parallel_ready | seam_candidate | intentional_serial | unknown_requires_evidence`。
- `lattice.plan_graph.v1`: immutable node、typed edge、capacity、join、source manifest digest。
- `lattice.transform_artifact.v1`: candidate、source、bounded patch、verifier receipt、post snapshot、cleanup、accept／reject。
- `lattice.plan_diff.v1`: old／new version、code transformation artifact、失効context、node／edge差分。

schemaはexact key、bounded collection、canonical serialization、digestを持つ。未知field、欠落、過大入力、
不正pathをfail closedにし、空の成功や暗黙fallbackへ丸めない。

## Boundary evidence

Lattice内蔵sensor由来のsymbol／edge／impact／affected testと、Lattice本体が補うschema、state、transaction、generated
artifact、config、external effect、H、runtime traceを区別して保持する。構造sensorだけで独立性を宣言しない。

`boundary_manifest.graph_evidence[].result_digest`は環境依存のraw CLI outputでなく、versioned portable outcome projectionの
canonical digestを指す。raw telemetryは診断receiptとして別に保持し、project／index absolute path、index時刻、DB byte size、
node更新時刻をplan identityへ混ぜない。除外fieldはprojection versionで列挙し、未知fieldをsafe defaultで捨てない。

## Orchestration run面（ADR 0044・0060）

現役run storeは対象Git rootの`.lattice/runs/<run-id>/`だけに置き、target repoが`.lattice/runs/`を
git ignoreしていることを作成前に検証する。run refはrepo相対の同形式だけを受理し、旧実験rootや任意pathへfallbackしない。

公開CLIは`run start`、`list --json`、`observe`、`status`、`resume`、`close`、`abandon`と`event verify`を持つ。
`resume`と正常`close`は保存requestのbase SHAへbindし、stale baseを拒否する。`abandon`だけがstale runを
明示退役でき、理由を`run_closed` eventへ記録する。lifecycle writeは排他・atomicである。
runtimeのtimestampは実在する暦日のcanonical UTC millisecondsだけを受理する。

## Transformation boundary

- 初期版からdisposableな隔離worktreeで実refactorを実行対象にする。
- canonical branch、commit、外部effect、H操作は親受入または明示承認なしに行わない。
- transform前baseline、変更scope、verifier、rollback、再index query set、version barrierを必須にする。
- known mechanical refactorだけに固定しない。生成変換もbounded effectと複数verifierで研究する。

## Blocker contract

blockerは、破られる要求／不変条件、因果経路、再現証拠、隔離／rollbackでも回避不能な理由、未充足条件を
持つ。満たさない意見はrisk／hypothesis／experimentへ分類し、製品scopeを縮めない。

## Bootstrap exception

空repoにはsensor indexが存在しないため、最初のscaffoldだけboundary manifestを免除する。
bootstrap source作成直後、初期環境commitより前に`lattice sensor init . --json`を実行し、それ以後のsource TODOは通常契約へ従う。

## MCP面（session code intelligence・ADR 0049）

CLI 6面とは別種の公開面として、sensorのMCP server（entrypoint `bin/lattice-mcp`）を提供する。
plan／witness契約が消費するevidenceはCLI面・portable projectionのみであり、MCP tool出力は
根拠にしない——graph系evidenceは`plan verify`の独立再計算＋canonical digest一致が機械的に強制し、
手動evidence fieldへ入ったMCP由来テキストは人間入力と同格の未検証assertionとして扱う。

MCP serverはhost sessionのstdio子プロセス（session寿命）、共有sensor daemonはclient refcount＋
idle timeoutで自動終了するcache工程であり、どちらも自律的なdispatch・製品状態への書込を行わない
（書込はLattice sensorのproject cacheへのwatcher再indexとLattice固有のglobal管理領域・socket
rendezvous nodeに限る）。廃止済みcache/dataは入力またはfallbackとして読まない。「常駐サービス化はしない」非目標はorchestration面の規定であり、
MCP server提供と矛盾しない。MCP面は外部networkへ一切通信しない（v1受入条件）。
runtimeは配布物内の`./sensor/dist`だけを起動し、PATH上の独立CLI、npx、外部SDKを解決しない。
MCP toolは`lattice_sensor_*`だけを公開し、提供者と所有者を`lattice`として機械表示する。

## TODO工程store面（ADR 0053・0055・0056・0058）

project discoveryの唯一の正規入口は`lattice status --json`である。CLI version、git project、
canonical store ref、active plan、active run、`uninitialized | ready | active_run | invalid`、
`can_create_plan`、次の正規commandを`lattice.project_status.v1`として返す。未初期化はexit 0の
正常状態であり、`.lattice/`の存在を接続判定へ使わない。`invalid`はexit 1のtyped状態とし、
Markdownへ暗黙fallbackしない。

未初期化projectの初期authoring入口は
`lattice plan create --input <lattice.plan_create_input.v3>`である。入力はrepo内のcanonical
JSON+LFに限定し、`lattice.todo_plan.v5`と同じPhase／task／topology制約を満たすfull desired stateを
一回のtransactionでstoreへ登録する。移行専用の`todo migrate`を新規authoringへ流用しない。
v2/v4は既存planの互換契約として維持する。

`.lattice/todo/`のcanonical journalを工程状態の唯一正本とし、snapshotとガントHTMLは再生成可能な
投影として扱う。読取CLIは`lattice todo status / verify / snapshot --rebuild / gantt`、一回きりの
移行入口は`todo migrate`である。topologyとsource reconciliationの変更はfull desired-state successorを
発行する`todo revise`／`todo revise-phase`だけが所有し、Markdown fallback、部分CRUD、独立`todo reconcile`を持たない。
通常revision inputはcanonical JSON+LFの`lattice.todo_revision.v1/v2`、Phase revisionは
`lattice.phase_todo_revision.v1/v2`とする。v2はdesired plan v5を所有する。cross-plan successorは`todo revise-set`で一括公開し、
`lattice.todo_revision_set.v3`はPhase revisionを必須として通常revisionとの混在を許す。全desired graphと
predecessorを検査し、artifactをdurable化した後、一つのmanifest activationで全planを同時に切り替える。
成功は単体通常revisionが`lattice.todo_revise_result.v1`、revision setが
`lattice.todo_revision_set_result.v1`、statusはreconciliation identityを含む
`lattice.todo_status_result.v3`、verifyはsource inventoryを再検査する`lattice.todo_verify_result.v2`を返す。

通常の状態遷移は`todo start / block / unblock / done / evidence promote / reopen`のclosed面で行う。
mutation callerは`LATTICE_TODO_ACTOR_HOST`, `LATTICE_TODO_ACTOR_SESSION`,
`LATTICE_TODO_ACTOR_AGENT`をすべてtodo identifierとして明示し、欠落時は書き込まない。`done`の
evidenceはrepo内descriptor JSONとpinned Git objectをwrite時にhard検証する。成功は
`lattice.todo_mutation_result.v1`一行、失敗は`lattice.cli_error.v2`一行、usage違反は人間向け診断一行で、
失敗時のstore bytesは不変とする。

PhaseはToDoの直列化groupではなく重監査の制御境界である。`todo_plan.v5`は各ToDoの`phase_id`、
gate policy、前段Phase、required evidence slotを所有するが、通常ToDoのstart/done readinessはToDo DAGだけで決める。
前段Phaseは監査のreview/accept順だけを制御する。特定ToDoがPhase受理を必要とする時だけ
`phase_accept_dependencies`へPhase ref→task refを明示し、task・Phase gateを合わせたmerged graphでcycleと
cross-plan topology bindingを検査する。所属ToDoが全てdoneでも`gate_ready`までしか進まず、
`phase_review`とimmutable evidence付き`phase_accept`を同じjournalへ記録して監査判断を残す。
この契約はPhase数、監査回数、required evidence slotを自動的に増やさない。旧v4はPhase acceptまで後続ToDoを
暗黙に閉じる互換契約として維持する。旧plan versionやjournal headを
下流eventの永続依存先にはしない。revisionではPhase定義と所属ToDo集合が同じ時だけDecision stateをcarryし、
意味が変わればresetを必須にする。Phase revisionと通常revisionはrevision set v3で同時公開できる。
reject/reopenはDecisionへ束縛し、開始済み後続を持つreopenは明示overrideなしに拒否する。

静的`todo gantt`はoffline証拠として維持する。`todo gantt serve --port <0..65535>`はloopback-onlyの
foreground read-only viewerで、stable store readとSSEにより更新を反映し、mixed viewを最新として表示しない。
静的生成時はHTMLと`<output_ref>.status.json` descriptorを発行する。`todo gantt status [--out <ref>]`は
現在の決定的renderとdescriptor／HTML digestを照合し、`current / stale / missing`を返す。
片側欠落、non-canonical descriptor、digest不一致、project不一致は`GANTT_ARTIFACT_INVALID`として失敗し、
staleまたはcurrentへ丸めない。
