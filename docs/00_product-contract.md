# Lattice 製品契約（0.37.0）

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

公開CLIは`run start`、`list --json`、`observe`、`status`、`resume`、`close`、`abandon`、`activate`、
`conflict`、`hold`、`recompile`、`reprocess`、`finding record`、`seam resolve`、`seam profile`と
`event verify`を持つ。

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

## 実行時競合とseam処置面（ADR 0138・0143〜0146）

実行中は宣言でなく実変更を観測する。書き込み観測はfindingとして記録し、独立に再導出できない
findingは記録しない。宣言超過だけで他の進行中作業と重ならない観測はconflictにしない
（ADR 0144——境界は予測であって制約ではない）。1 taskしか名指さないfindingをconflict操作へ
渡した場合は`FINDING_NOT_A_CONFLICT`で拒否する。

conflictの処置は2系統である。直列化（一方をholdし他方の確定後に再開）と、変換
（双方を止め、`run seam resolve`で観測由来のseam変換を隔離worktree・受入五条件で通し、
phase revisionの`runtime_seam_split`で再コンパイルして双方を再開する）。振り分けの材料として
statusの投影は`treatment_advice`（finding digest・severability・transform可否）を機械可読で返す。
`run seam resolve`は宣言witnessを観測へ整合させる翻訳段（`reconciled`）を持ち、観測に裏づけの
ない拡幅は`observation_unbacked`系のtyped理由で拒否する。

受入五条件（ADR 0138）の`behavior_equivalent`は公開export面の保存に加えて切断参照の網
（ADR 0145）を含む——移した先が残余面のsymbolへ束縛なしで言及していれば不認定にする。網は
受入の一点だけで過程を監視せず、失敗は理由と次の一歩を返す不認定であって、回数・失敗を誰にも
記録しない。

機械変換は確実にできる内容だけ行う。前提の正典は`SEAM_GATE_PRECONDITIONS`で、resolutionの
`gate`が拒否理由を`fix_declaration`（宣言修正で機械再試行可）と`hand_to_ai`（機械の変換能力の
外＝操作AIが変換すべき）へ分類する。未知の理由は確実側へ丸めず安全側の手渡しにする（ADR 0146）。

切断コストの内訳は投影であって記録ではない。`run seam profile`（run-time）と
`todo seam-profile --plan <key> --file <path>`（plan-time）が、数えられる事実——相互参照、
read/write区別つき共有module状態、共有関数、共有import、循環、symbol行数、深さ別影響——を
盲点のconfidence申告つきで返す。閾値・採点・履歴台帳を持たず、digest済みartifactへ焼き込まない。

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
`lattice plan create --input <lattice.plan_create_input.v4>`である。入力はrepo内のcanonical
JSON+LFに限定し、`lattice.todo_plan.v7`と同じPhase／task／topology制約を満たすfull desired stateを
一回のtransactionでstoreへ登録する。移行専用の`todo migrate`を新規authoringへ流用しない。
v2/v4は既存planの互換契約として維持する。

`.lattice/todo/`のcanonical journalを工程状態の唯一正本とし、snapshotは再生成可能な投影として扱う。
工程表HTMLはfileへ生成せず、動的viewerがstoreから応答時に描画する。読取CLIは
`lattice todo status / bindings / independence / verify / snapshot --rebuild / gantt serve`、
一回きりの移行入口は`todo migrate`である。`todo bindings [--plan <key>] --json`は`compile_binding`が設定された
Taskだけを`project_id`／`plan_key`／`plan_version`／`task_id`つきで投影し
（`lattice.todo_binding_projection.v1`・ADR 0124）、TODO工程とruntime実行を結ぶ唯一の公開読み取り面とする。
`compiled_plan_digest`から`runtime_plan.v1`→`executor_packet.v1`→`executor_receipt.v1`まで辿れる。
`todo_status_result.v4`は変更せず、加算の別面とする。

ToDoの作業記憶はlifecycle journal／snapshotと分離したtask-scoped append-only note chainが正本である
（ADR 0149）。追記は`todo note --plan <key> --task <id> (--message <text>|--input <file>)`、全履歴の
診断面は`todo note list --plan <key> [--task <id>] --json`とする。ただし、操作AIがこの診断commandを
知っていることを通常経路の前提にしない。`todo show --plan <key> --task <id> --json`と、成功する
`todo start`は、最新bounded note群、元plan version／元task、訂正状態、note head digest、overflow、
全履歴commandを`note_context`として必ず自動同梱する。note chainを読めない時は空配列へ丸めず、
`todo start`はlifecycle event追記前にfail closedする。revisionを跨ぐ投影は`task_migration`だけを根拠にし、
removed taskのnoteはarchived束へ分離する。

個別ToDo右ペインの「作業記録」は同じbounded contextを表示する。loopbackへ閉じた`gantt serve`と常設
dashboardは作業者本人が読む面なので記録込みで描く。note本文を落とすのはrepo外へHTMLを出す公開配信面
だけとし、その入口が`includeNotes: false`を強制する。公開配信面は現時点で存在せず、入口だけを残す。

依存edgeの不在は順序制約の無申告であって、書き込み境界の非干渉ではない。両者を公開面で区別するため、
`todo independence compile --plan <key> --input <witness_set>`が`lattice.todo_witness_set.v2`の宣言と
実sensor観測から並列可否を判定し、`lattice.todo_independence.v3`をplan versionディレクトリへ並置記録する
（ADR 0127・0132）。conflictは`conflict_resources`のresource idを参照し、kindと衝突した実体
（symbolまたはrepo相対path）を辞書側で一度だけ保持する。既知の旧契約で書かれた記録は`superseded`として
再compileを案内し、壊れた記録とは区別する。記録は`(plan_version, topology_digest, base_sha)`へ束縛し、
dirty worktreeでは記録しない。
記録はwitness setから再生成できるhost localの投影として扱い、git追跡するのは入力のwitness setだけとする。
witness setは`concern_anchors`を任意で持てる。これは係争資源の内側で自分が触るsymbolをToDoごとに
名前で宣言する束縛専用の入力であり、並列可否の判定へは写らない——判定入力へ合成する時点で落とすので、
宣言が誤っていてもconflictを作ることも消すこともできない。concern anchorを持たない
`lattice.todo_witness_set.v1`の宣言もそのまま受理し、書き換えを要求しない。
`todo independence [--plan <key>] --json`はready frontierを検証済み並列グループ・要直列の組・未検査へ
分けて投影し（`lattice.todo_independence_projection.v2`）、参照時にsensorを引かない。
記録の鮮度は`coverage`が`verified`／`stale`／`superseded`／`missing`で示し、現在のコード状態を
指していない記録をverified独立として読ませない。`dispatch_frontier`の
`all_ready_parallel_by_default`は変更せず、independenceはhostがsubsetを選ぶ根拠を与える別面とする。

readyが複数ある状態での直列着手は、`--override-reason`の申告だけでは通さない。一度
`PARALLEL_DISPATCH_RECONSIDER`で突き返し、同じ理由に`--serial-confirmed`を付けた再実行だけを
受理する。足止めは一度だけとし、再実行した直列着手は受理する。さらに、理由がworker数・
セッション構成・作業者の都合を述べただけで実際の干渉を述べていない場合は
`PARALLEL_DISPATCH_INVALID`で拒否し、`--serial-confirmed`があっても通さない——実行主体が
1つしか無いことは並列にできない理由ではなく、直列化の根拠になるのは同一fileへの書込衝突・
外部資源の排他・順序依存だけである。既定が並列であることを規則として書くだけでは読み飛ばされる
実例が出たため、再考をコマンドの往復で強制する。

同じ検査をplan作成時点にも掛ける。`plan create`と`todo migrate`は依存グラフから
`dispatch_shape`（`task_count`／`critical_path_length`／`max_frontier_width`／
`serialization_ratio`）を計算して結果へ載せ、`serialization_ratio`が閾値を超えるplanを
`PARALLEL_DISPATCH_RECONSIDER`で一度突き返す。再考後の`--serialization-reviewed`だけを受理し、
6 task未満のplanは対象外とする。判定はstore書込みの前に行い、拒否時はstoreへ何も書かない。
着手時のgateだけではplanが直列に組まれた時点で並列が生まれないため、同じ既定を計画時点へ
前倒しする。

切断可能と分類されたconflictについて、`todo seam-proposal compile --plan <key>`が独立性記録と実sensorから
`lattice.seam_proposal.v2`を生成し、`todo seam-proposal [--plan <key>] --json`がsensorを引かずに
`lattice.seam_proposal_projection.v1`として投影する（ADR 0132）。提案の単位はconflict pairではなく
conflict componentとし、`seam_candidate`／`intentional_serial`／`unknown_requires_evidence`のsum typeで
全conflictを覆う。提案が持つのは切断の手順ではなく変更前後のsurfaceとその所有者であり、
seam候補は提案後ownershipで残余conflictが0になるものだけとする。ToDoへの割り当てをcaller／callee／impactの
edgeから導出せず、witnessのtask固有anchorが束縛できない場合はtyped unknownを返す。
witnessの`concern_anchors`は、当たったskeletonでは粗いanchorに優先する束縛根拠になり、pathのconflictでは
宣言そのものが切断候補（`declared_partition`）になる。componentの全taskが同じpath内でsymbolを名指しした
場合だけ候補にし、片側の宣言から他方の担当を補完しない。宣言symbolはsensorのexact一致・資源内包含・
task間排他で検証し、破れた宣言は候補にせずkindの異なるtyped unknownで返す（ADR 0133）。投影の`guidance`は
記録の鮮度が`verified`の時、載っている束縛失敗のうち直す対象が一意に決まるものを選んで種別と次の一歩を述べ、
束縛できなかったcomponentを「記録は一致している」で終わらせない（ADR 0130）。提案は構造証拠であって
意味的独立やbehavior preservationの証明ではなく、実変換は本面に含まれない。記録はindependence記録と同じく
plan versionディレクトリへ並置し、再生成できるhost localの投影として扱う。

session開始時にhostが必要とする現在地は`lattice session-context --json`が
**1プロセス・1回のstore読み**で返す（`lattice.session_context.v1`、ADR 0131）。
`status`フィールドは`project_status.v1`、`todo`フィールドは`todo_status_result.v4`をそのまま埋め、
`independence`はreadyのあるplanだけの並列可否要約を持つ。既存2面は不変で、これはその合成である。
この面はdashboard活動を登録しない読み取り専用面とする。消費者へexact key検証を要求せず、
知っているkeyだけを読んでよい——Lattice側は既存keyの意味を変えるときだけschema版を上げる。

topologyとsource reconciliationの変更はfull desired-state successorを
発行する`todo revise`／`todo revise-phase`だけが所有し、Markdown fallback、部分CRUD、独立`todo reconcile`を持たない。
通常revision inputはcanonical JSON+LFの`lattice.todo_revision.v1/v2`、Phase revisionは
`lattice.phase_todo_revision.v1/v2`とする。各v2は設計メモを持つdesired plan v6／v7を所有する。
cross-plan successorは`todo revise-set`で一括公開し、
`lattice.todo_revision_set.v3`はPhase revisionを必須として通常revisionとの混在を許す。全desired graphと
predecessorを検査し、artifactをdurable化した後、一つのmanifest activationで全planを同時に切り替える。
Phase v3のactive source移転は、同じrevisionの`source_cutover_batch`が旧refとdigestを明示し、その操作から
決定されるarchive refとdigestをdesired source inventoryが所有する場合だけ受理する。対応するcutover証拠のない
predecessor source消失は`predecessor_source_silently_dropped`として拒否する。
成功は単体通常revisionが`lattice.todo_revise_result.v1`、revision setが
`lattice.todo_revision_set_result.v1`、statusはreconciliation identityを含む
`lattice.todo_status_result.v4`、verifyはsource inventoryを再検査する`lattice.todo_verify_result.v3`を返す。
verify v3の各memberは`reconciliation_guidance`を持ち、`registered_unreconciled`がsource inventoryの
検証状態であってlifecycle操作とdashboard表示を塞がないこと、および正規のrevision schema取得・適用commandを示す。
status v4の`dispatch_frontier`は`next_ready`全件を既定の同時dispatch集合とし、推奨同時数、
frontier digest、subset選択時の理由要否を機械表示する。readyが複数でactive taskがない時の最初の
`todo start`は`--parallel-frontier`による並列開始宣言、または`--override-reason <reason>`による
意図的直列化理由のどちらかを必須とする。これはPhase、監査回数、task DAGを増やさない。
`--parallel-frontier`は開始時のdispatch方針宣言であり、LatticeがAI hostのagentを直接生成する契約ではない。
宣言後の実dispatchはhostが所有し、Latticeは`active_set`と残存`next_ready`から実状態を投影する。

**監査の既定は「有り」であり、無しは表現できない**（ADR 0147）。phaseを持たないplan
（`todo_plan.v1/v2/v3`）は予約Phase `terminal-audit`を暗黙に1つ持ち、所属taskはそのplanの全taskとする。
状態機械は既存のPhase gateと同一で、全task doneは`gate_ready`＝監査待ちであって完走ではない。
予約id以外のphase eventは`event_phase_missing`で拒否する。工程図のlive scopeは監査未了
（`gate_ready`／`reviewing`／`rejected`）のplanのToDoを畳まない——完走扱いで図から消えることが
「閉じた」の可視表現であり、監査の記録なしにそこへ行かせない。作成は拒否せず通知に留め、
`todo migrate`と`plan create`の結果、および最後のpending taskがdoneになった`todo done`のadvisoryへ
`terminal_audit_required`を載せる。`todo phase status`はphase無しplanでも暗黙Phaseを返し、
`implicit`で機械可読に示す。**終端監査はToDoのdispatch可否へ影響しない**——ADR 0062の
「Phase監査順とToDo schedulingの分離」を継承し、`next_ready`／`active_set`／`dispatch_frontier`は
暗黙Phaseの状態遷移で不変である。Latticeは監査の中身を採点せず、accept記録の存在だけを見る。

**監査していない歴史は「監査なしで閉じた」として閉じる**（ADR 0148）。Phaseは`accepted`／`rejected`に
加えて`closed_unaudited`を持つ。過去の工程は監査できない——監査対象のコードが既に変化しているため、
監査を要求すれば誤検出か中身を見ない`accept`のどちらかを誘発する。`closed_unaudited`は専用event kind
`phase_close_unaudited`で理由つきに記録し、前提は`gate_ready`とする。**`accepted`へ化けない**——
`phase_accept_dependencies`は`accepted`の厳密一致だけで解錠し、`closed_unaudited`では解錠しない。
工程図では畳むので監査待ちの札が外れ、`phase_reopen`でやり直せる。
一括入口`todo phase baseline --reason <text> [--except <plan_key>]...`は、現在`gate_ready`かつ
phase eventを一度も持たないPhaseをまとめて宣言し、除外・対象外・失敗を区別して返す。
**自動実行しない**——どれを監査しどれを歴史として畳むかは人／AIが決め、装置は宣言を受け取って
記録するだけとする。「変化したか」の機械判定と時間ベースの推定は持たない。監査待ちを返す面は、
何が起きたかと次に打つコマンドをtyped guidanceへ載せる。

phase無しで作ったplanへ後からPhaseを被せる救済経路は、`revise-phase`の
`state_policy: acquire_phase`が所有する。未割当（`phase_id`なし）→割当の向きだけを許し、
既にphaseを持つtaskの付け替えは拒否する。設計メモをまだ持たないlegacy taskが初めて
`design_memo`を獲得する時だけ通常`carry`を許す。一度メモを持ったtaskの本文変更は、通常`carry`だけでなく
互換入力された`acquire_phase`でも拒否し、
明示`carry_reconciled_metadata`だけがstateを保持して変更できる。そのpolicyは後継genesisの
`state_migration`へ記録する。v6／v7から設計メモを持たないschemaへの後退は、単体・Phase・revision setの
全activation入口で拒否する。
journal eventのschema列は、v1 genesisのjournalへ`phase_*` eventだけをv3 tailとして混在許可する
（既存eventのbytesとdigest計算は不変、v3のtask eventは従来どおり拒否）。

authoring契約のJSON Schemaは各入口から取得できる。`plan create --schema --json`の既定は最新版
（現在v4）で、`--schema-version <1|2|3|4> --json`が版を明示する。`todo revise`／`revise-set`／
`revise-phase`／`migrate`も`--schema --json`を持ち、実際に受理する最新契約を返す（storeを読まない
決定的出力）。schema違反は`detail`へ互換fieldの`violation_reason`／`violation_path`と、構造化した
`violation_kind`／JSON `pointer`／`expected`／`actual`／`task_id`／`next_action`を載せる。
`todo migrate --input <ref> --dry-run --json`はstoreとdashboard registryを変更せず、独立した違反を
上限付き配列でまとめて返す。digest不一致は期待digest、ソート違反はsort key、未来時刻は現在時刻と
許容5分窓を返す。循環等のtopology違反とstore／I/O障害を混同せず、除外taskを登録taskのparent・
dependency・joinから参照する入力はcompile前にpointer付きで拒否する。未知subcommand、不正引数、
repo外絶対inputはそれぞれ`UNKNOWN_SUBCOMMAND`、
`INVALID_ARGUMENTS`、`INPUT_OUTSIDE_REPOSITORY`へ分ける。`lattice plan show <plan_key> --json`は`lattice.plan_show_result.v1`として
plan本体（phase定義と状態・task一覧と状態・依存本数・topology要約）を投影する——
`todo bindings`が`compile_binding`付きtaskだけを投影することによる「planが空」という誤読を塞ぐ面である。

通常の状態遷移は`todo start / block / unblock / done / evidence promote / reopen`のclosed面で行う。
mutation callerは`LATTICE_TODO_ACTOR_HOST`, `LATTICE_TODO_ACTOR_SESSION`,
`LATTICE_TODO_ACTOR_AGENT`をすべてtodo identifierとして明示し、欠落時は書き込まない。`done`の
evidenceはrepo内descriptor JSONとpinned Git objectをwrite時にhard検証する。成功は
`lattice.todo_mutation_result.v2`一行、失敗とusage違反は`lattice.cli_error.v2`一行で、
失敗時のstore bytesは不変とする。v2の`advisory`は`todo start`だけが非nullで返し、着手対象と
進行中ToDoの競合・切断可能性・未検査の内訳を機械可読で載せる（ADR 0128）。助言であって拒否ではなく、
ready frontier dispatch契約は変えない。ただし記録があるのに鮮度を判定できない場合は、
助言なしで通さずjournal書込前に失敗させる。actor解決失敗はrequired／missing／invalid環境キーと正規次操作を
error detailへ返し、OS由来の偽identityへfallbackしない。

PhaseはToDoの直列化groupではなく重監査の制御境界である。現行`todo_plan.v7`は各ToDoの`phase_id`、
gate policy、前段Phase、required evidence slotを所有するが、通常ToDoのstart/done readinessはToDo DAGだけで決める。
前段Phaseは監査のreview/accept順だけを制御する。特定ToDoがPhase受理を必要とする時だけ
`phase_accept_dependencies`へPhase ref→task refを明示し、task・Phase gateを合わせたmerged graphでcycleと
cross-plan topology bindingを検査する。所属ToDoが全てdoneでも`gate_ready`までしか進まず、
`phase_review`とimmutable evidence付き`phase_accept`を同じjournalへ記録して監査判断を残す。
この契約はPhase数、監査回数、required evidence slotを自動的に増やさない。旧v4／v5は互換読取契約として
維持し、v4だけはPhase acceptまで後続ToDoを暗黙に閉じる。旧plan versionやjournal headを
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
右ペインはToDo storeを見せる面であり、ToDo本体へ束縛した初期設計メモと追記noteを区別して表示する。
元plan Markdown本文を暗黙に再読込しない。全工程一覧は、動いているplanを
最終活動の新しい順で上、全ToDoが図から外れた完走planを古い順で下へ並べ、plan内は登録順を保つ。
初期設計メモはローカル／公開の動的viewerへ表示する。追記note本文だけは公開面から除外し、
「公開なので設計メモも空にする」という縮退を許さない。
右ペインの規約は[ADR 0067](adr/0067-right-pane-shows-the-store-and-orders-by-activity.md)が正。

工程表はstoreを都度読む動的viewerだけを運用表示面とする。`todo gantt serve --port <0..65535>`はloopback-onlyの
foreground read-only viewerで、stable store readとSSEにより更新を反映し、mixed viewを最新として表示しない。
live result v3は`project_id`、project scope、選択scope、起動時点で含むplan key群、HTML media type、
動的表示であること、`/projects/<project_id>/`のproject固有URL、同じnamespace配下の`events_url`を返す。
各projectのforeground sessionは独立portで同時起動でき、project間でHTML、SSE、store stateを共有しない。
共有dashboardのactive project判定はrecent session activityまたはstoreの非空`active_set`だけを根拠にする。
activity TTLを越えてもactive runがあるprojectを一覧から除外せず、active run終了かつTTL期限切れで除外する。
dashboard daemonは起動時に読み込んだ版数をhealthで名乗り、installされた版と食い違うdaemonは新版へ
置き換える。publishとinstallを終えた版が、古いdaemonの生存を理由に配信面へ届かないままになることを
許さない。置き換えの待ち時間は固定秒数で打ち切らず、spawnした子が生きている間は待ち、子の死で即座に
`DASHBOARD_DAEMON_UNAVAILABLE`を返す。
公開viewerの未知GETで`Accept`が`text/html`を含む場合は、HTTP 404のままLatticeのブランド、
`noindex, nofollow`、`/projects/`と`https://kitepon.dev/`への戻り先を持つHTMLを返す。
HTMLを要求しないclientには、従来の`lattice.todo_gantt_http_error.v1` JSON 404を維持する。
content negotiationは表示面だけの加算であり、未知URLを200へ丸めず、他methodや他errorの契約を
暗黙に変更しない。
`todo gantt`と`todo gantt status`は`STATIC_GANTT_RETIRED`で拒否する。project別HTMLとsidecarを
運用正本として生成せず、AIへ再生成やstale確認を要求しない。
dashboard registryは同じ`project_id`を別canonical rootから自動登録しようとすると
`PROJECT_ROOT_CONFLICT`でregistry bytesを不変に保つ。配信元を動かす唯一の例外は、actorを明示した
`lattice todo dashboard adopt --json`である。結果と公開画面へローカル絶対pathを露出しない。
