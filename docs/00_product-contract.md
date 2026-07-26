# Lattice 製品契約（0.12.25）

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

実dispatchへ到達する経路も公開面で閉じている（ADR 0125・0126）。executor adapterの登録は
`run adapter register --input <file>`／`run adapter list --json`であり、入力schemaは
`run adapter register --schema --json`で取得する。digestは利用者に手計算させず、
binary／config／capabilities／自己digestはCLIが導出する。
決定論的な参照controllerを`lattice-scripted-adapter`として配布し、公開CLIと配布binだけで
`run activate`から実write・receipt受理・`resume`／`close`まで到達できる。
初回駆動は配布binをlaunch argvへ明示したmanaged runだけに効く。実dispatchの所有者はhostである。
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
未索引projectでは、AI hostが現在または予定作業の反復Read／Grep削減効果と一回限りの索引費用を比較し、
workspace書込とshell実行が許可されていれば対象projectを明示して`lattice sensor init <path> --json`を
自律実行してよい。権限またはshell面がなければbuilt-in toolで継続し、正規init commandをユーザーへ示す。
「索引はユーザーだけが判断・実行する」というMCP guidanceは禁止する。
CLIの`lattice sensor sync`を未初期化projectで実行した場合は`LATTICE_SENSOR_NOT_INITIALIZED`を返し、
`detail.next_action`へ同じpathの正規`lattice sensor init ... --json`を示す。その他のsensor失敗も
exit code、signal、最大16 KiBのstderrをtyped detailへ保持し、原因を汎用messageへ隠さない。

## TODO工程store面（ADR 0053・0055・0056・0058）

CLIの発見入口は`lattice --help`／`lattice help`、公開namespaceとsubcommandの発見入口は
`lattice <namespace> [<subcommand>] --help`／`lattice help <namespace> [<subcommand>]`とする。helpはstoreやnetworkを読まず、
決定的なplain textをstdoutへ返してexit 0とする。未知namespaceは従来どおりusage違反exit 2で拒否する。

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
投影として扱う。読取CLIは`lattice todo status / bindings / verify / snapshot --rebuild / gantt`、一回きりの
移行入口は`todo migrate`である。`todo bindings [--plan <key>] --json`は`compile_binding`が設定された
Taskだけを`project_id`／`plan_key`／`plan_version`／`task_id`つきで投影し
（`lattice.todo_binding_projection.v1`・ADR 0124）、TODO工程とruntime実行を結ぶ唯一の公開読み取り面とする。
`compiled_plan_digest`から`runtime_plan.v1`→`executor_packet.v1`→`executor_receipt.v1`まで辿れる。
`todo_status_result.v4`は変更せず、加算の別面とする。topologyとsource reconciliationの変更はfull desired-state successorを
発行する`todo revise`／`todo revise-phase`だけが所有し、Markdown fallback、部分CRUD、独立`todo reconcile`を持たない。
通常revision inputはcanonical JSON+LFの`lattice.todo_revision.v1/v2`、Phase revisionは
`lattice.phase_todo_revision.v1/v2`とする。v2はdesired plan v5を所有する。cross-plan successorは`todo revise-set`で一括公開し、
`lattice.todo_revision_set.v3`はPhase revisionを必須として通常revisionとの混在を許す。全desired graphと
predecessorを検査し、artifactをdurable化した後、一つのmanifest activationで全planを同時に切り替える。
Phase v3のactive source移転は、同じrevisionの`source_cutover_batch`が旧refとdigestを明示し、その操作から
決定されるarchive refとdigestをdesired source inventoryが所有する場合だけ受理する。対応するcutover証拠のない
predecessor source消失は`predecessor_source_silently_dropped`として拒否する。
成功は単体通常revisionが`lattice.todo_revise_result.v1`、revision setが
`lattice.todo_revision_set_result.v1`、statusはreconciliation identityを含む
`lattice.todo_status_result.v4`、verifyはsource inventoryを再検査する`lattice.todo_verify_result.v2`を返す。
status v4の`dispatch_frontier`は`next_ready`全件を既定の同時dispatch集合とし、推奨同時数、
frontier digest、subset選択時の理由要否を機械表示する。readyが複数でactive taskがない時の最初の
`todo start`は`--parallel-frontier`による並列開始宣言、または`--override-reason <reason>`による
意図的直列化理由のどちらかを必須とする。これはPhase、監査回数、task DAGを増やさない。
`--parallel-frontier`は開始時のdispatch方針宣言であり、LatticeがAI hostのagentを直接生成する契約ではない。
宣言後の実dispatchはhostが所有し、Latticeは`active_set`と残存`next_ready`から実状態を投影する。

通常の状態遷移は`todo start / block / unblock / done / evidence promote / reopen`のclosed面で行う。
mutation callerは`LATTICE_TODO_ACTOR_HOST`, `LATTICE_TODO_ACTOR_SESSION`,
`LATTICE_TODO_ACTOR_AGENT`をすべてtodo identifierとして明示し、欠落時は書き込まない。`done`の
evidenceはrepo内descriptor JSONとpinned Git objectをwrite時にhard検証する。成功は
`lattice.todo_mutation_result.v1`一行、失敗は`lattice.cli_error.v2`一行、usage違反は人間向け診断一行で、
失敗時のstore bytesは不変とする。actor解決失敗はrequired／missing／invalid環境キーと正規次操作を
error detailへ返し、OS由来の偽identityへfallbackしない。

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

工程図の既定scope`live`は、後続に作業中・未着手が残っていない完了ToDoを図から除く。まとめnodeや
placeholderを代わりに置かず、生きたToDoとその直接の前提ToDoは必ず描く。除いたToDoは凡例の件数、
右ペインの全工程一覧、各ToDoの詳細から辿れ、詳細の前提・後続は除外前のグラフから表示する。総数・進捗・
最長依存鎖・ready frontierは除外前の全工程で数える。件数バッジは展開の入口を兼ね、押すと同梱した全工程の
図へ切り替わる。`--scope all`は何も除かない。表示規約は[ADR 0066](adr/0066-gantt-live-scope-drops-finished-work.md)が正。
依存線はカードとカードの間の列境界を通り、図の右端の外へ迂回せず、カードの矩形の内部を通らない。真下へ
繋ぐ線は折れずに一直線で降りる。依存edgeを持たないToDoのブロックは接続済みToDoの上へ置き、接続済み
ToDoが段の最下行になる。配線規約は[ADR 0068](adr/0068-gantt-routes-run-between-the-columns.md)が正
（ADR 0066 Decision 7を置き換える）。
右ペインはToDo storeを見せる面であり、元plan Markdown本文を再表示しない。全工程一覧は、動いているplanを
最終活動の新しい順で上、全ToDoが図から外れた完走planを古い順で下へ並べ、plan内は登録順を保つ。
右ペインの規約は[ADR 0067](adr/0067-right-pane-shows-the-store-and-orders-by-activity.md)が正。

静的`todo gantt`はoffline証拠として維持する。`todo gantt serve --port <0..65535>`はloopback-onlyの
foreground read-only viewerで、stable store readとSSEにより更新を反映し、mixed viewを最新として表示しない。
live result v2は`project_id`、`/projects/<project_id>/`のproject固有URL、同じnamespace配下の`events_url`を返す。
各projectのforeground sessionは独立portで同時起動でき、project間でHTML、SSE、store stateを共有しない。
共有dashboardのactive project判定はrecent session activityまたはstoreの非空`active_set`だけを根拠にする。
activity TTLを越えてもactive runがあるprojectを一覧から除外せず、active run終了かつTTL期限切れで除外する。
dashboard daemonは起動時に読み込んだ版数をhealthで名乗り、installされた版と食い違うdaemonは新版へ
置き換える。publishとinstallを終えた版が、古いdaemonの生存を理由に配信面へ届かないままになることを
許さない。置き換えの待ち時間は固定秒数で打ち切らず、spawnした子が生きている間は待ち、子の死で即座に
`DASHBOARD_DAEMON_UNAVAILABLE`を返す。
静的生成時はHTMLと`<output_ref>.status.json` descriptorを発行する。`todo gantt status [--out <ref>]`は
現在の決定的renderとdescriptor／HTML digestを照合し、`current / stale / missing`を返す。
片側欠落、non-canonical descriptor、digest不一致、project不一致は`GANTT_ARTIFACT_INVALID`として失敗し、
staleまたはcurrentへ丸めない。
