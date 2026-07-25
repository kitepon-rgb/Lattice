# Changelog

## 0.12.18 — 2026-07-25

- 工程図の表示規約を[ADR 0066](docs/adr/0066-gantt-live-scope-drops-finished-work.md)として正典化した。ADR 0053の折畳み前提を採らず、既定表示は完走した工程を図から除き代わりの箱も置かない、という現行実装の決定を根拠つきで記録する。
- 公開契約・README・design仕様・CLI helpを現行の表示規約へ揃えた。CLI helpの「完走した枝を畳む」はまとめnodeを置いていた時代の文言だったので「図から除く（一覧には残る）」へ直した。
- design仕様の右ペイン節を実装どおり（概要・選択工程・全工程の3面）に書き直し、toolbarの「元Markdown全文」boxが全工程一覧を開くというラベルと実体の不一致、および出力へ載らないMarkdown描画を未裁定として明示した。

## 0.12.17 — 2026-07-25

- 段間隔を段ごとの実需で決めるようにした。従来は図全体で最も混雑した配線帯の幅を全段へ一律適用しており、実storeでは第0段の下を通る52本のedgeが要求する636pxが、edge 1本しか通らない47段にもそのまま適用されて、段間隔704pxのうち箱は68px＝縦の90%が空白だった。
- 依存を持たないToDoを段の中で折り返して格子に並べるようにした。前提を持たないToDoは全て第0段へ入るため、依存宣言の少ないstoreでは数百件が横一列に並んでいた（実storeでは781件中567件が依存edgeを1本も持たない）。edgeを持つnodeは経路計算の前提を保つため段の先頭行に残す。
- 実測（dotagents全工程）: 幅 182656 → 14784px、高さ 36004 → 8028px。面積で1/55。
- gantt renderer versionを`v14`にした。

## 0.12.16 — 2026-07-25

- 図から外した工程の件数バッジを、そのまま展開の入口にした。押すと全工程を描いた図へ切り替わり、もう一度押すと戻る。展開図は同じページへ同梱する（生成物はfile://でも開くため、問い合わせ先のあるlive dashboardを前提にできない）。実storeで+1.2MB、render +40ms。外した工程が無い場合は同梱もbuttonも出さない。
- gantt renderer versionを`v13`にした。

## 0.12.15 — 2026-07-25

- 概要パネルの決着済みPhase（accepted・rejected）を閉じたdetailsへまとめ、進行中のPhaseだけを展開するようにした。従来は状態に関係なく全件を展開しており、実storeでは10件すべてが受理済み、つまり進行中が1つも無いのに縦を占領していた。
- gantt renderer versionを`v12`にした。

## 0.12.14 — 2026-07-25

- 完走した工程を図から外し、代わりのまとめnodeも置かないようにした。畳み込みnodeは1個につき1列を占めるため、完走したplanが9つあれば9列が履歴のためだけに残り、図が生きた工程の何倍もの幅に伸びていた。nodeを除くだけでは閉路が生まれないので、縮約に必要だった粒度探索・閉路検査・合成node生成をすべて削除した。
- 上部のlane見出し帯を、図が描いているlaneだけに絞った。全plan全laneのchipを並べていたため、実storeでは82個のchipがSVGを11764pxへ広げ、graph本体1644pxの7倍を空列で占めていた。chipの件数は従来どおり外す前の全ToDoを数える（描画node 606→14、lane chip 82→8、SVG幅 11764→1684px）。
- 外した工程の情報は凡例・右ペイン「全工程」・各工程の詳細が持つ。詳細の前提・後続は外す前の依存から表示する。
- gantt renderer versionを`v11`にした。

## 0.12.13 — 2026-07-25

- 完走した枝の畳み込み粒度をplan単位へ粗くした。連結成分で束ねる従来の粒度は、完了ToDoが互いに依存を宣言していないstoreでは1件1nodeへ空振りし、実storeでは767件が592個の畳み込みnodeになって箱の数がほぼ減らなかった。粗い順にplan、plan+kept段数、plan+waveを試し、縮約が非閉路になる最初の粒度を採る（767件 → 9node、描画node 606 → 23）。
- 畳み込みnodeをクリックで開けるようにした。従来は合成nodeに詳細パネルが無く、図のnodeも一覧の畳み込み済み工程も選択が無反応で、生成済みの詳細パネルへ到達する経路が存在しなかった。畳み込みnodeは構成工程を並べ、各工程からは代表している畳み込みnodeへ戻れる。
- 畳まれた工程の前提・後続を縮約前の依存から表示するようにした。従来はunit内部edgeが捨てられた後のグラフを読んでいたため、依存があるのに「登録済みの前提工程はありません」と表示していた。
- 古い版を配信し続けるdashboard daemonを自動で置換するようにした。daemonは起動時に読み込んだコードを配信し続けるため、新版をinstallしても公開面が古いままになる（実際に公開工程表が9時間前のrendererを返し続けた）。health payloadへ起動時の版数を載せ、`lattice status`が通るたびに版差を検知して入れ替える。
- gantt renderer versionを`v10`にした。

## 0.12.12 — 2026-07-25

- `bridge status`が到達性を報告するようにした。設定したlisten addressがホストに存在するか（`listen_state`）、実際に接続を受け付けるか（`reachable`）を別々に返す。従来は`enabled: true`とだけ答え、公開surfaceが落ちていても健全に見えていた。
- bridgeが同一subnet内の現アドレスへ自動で再bindするようにした。別network・loopbackは自動採用せず、代替が無ければ`BRIDGE_LISTEN_ADDRESS_ABSENT`でtypedに失敗する。
- 新しいbindingを張るたびにreverse proxy hostへupstreamを自己登録するようにした（`lattice bridge register`で手動実行も可能）。`ssh <host> <script> <port>`の固定形だけを実行し、アドレスは送らずremote側がssh送信元から決めるため、呼び出し側は自分自身しか登録できない。`LATTICE_BRIDGE_REGISTRAR_SSH_HOST`と`LATTICE_BRIDGE_REGISTRAR_SCRIPT`の両方が設定された時だけ動く。
- registrar設定をLaunchAgent plistへ引き継ぐようにした。launchdはshell環境を継承しないため、これが無いとdaemonの自己登録が永久に発火しない。

## 0.12.11 — 2026-07-25

- 依存工程図が既定で完走した枝を畳むようにした。生きた工程とその直接の前提工程は必ず展開したまま残し、全件を描くには `todo gantt --scope all` を使う。総数・lane集計・最長依存鎖・ready frontierは畳み込み前の全工程で数える。
- `todo gantt` artifact descriptorを`v2`にしてscopeを記録し、`todo gantt status`がscope違いの生成物を陳腐化と誤判定しないようにした。
- revisionでcarryされた完了時刻不明のimported ToDoへ`evidence promote`できるようにした。reopenと同じくplan_genesisのstate migrationへ束縛する。
- publish前検査がuntrackedファイルも拒否するようにした。従来はtrackedのdirtyしか見ておらず、未commitのファイルが公開tarballへ混入しうる状態だった。ignore済みは従来どおり対象外。

## 0.12.10 — 2026-07-25

- revisionでcarryされた完了ToDoを`todo reopen`できるようにした。後継journalにdoneイベントが無い場合でも、完了を運んだ`plan_genesis`のstate migrationへ束縛する。doneでないtaskのreopenは従来どおり拒否する。
- `todo status --json | head`のように結果を部分的に読んでも、未処理EPIPEでstack traceを出してexit 1になることをやめ、静かにexit 0で終えるようにした。EPIPE以外のstream errorは従来どおり失敗として落とす。

## 0.12.9 — 2026-07-25

- Phaseを持たない先行planからのcarryを、typed `REVISION_INVALID`で拒否するようにした。
- `phase_todo_revision.v1`/`v2`の適用でmanifestの`active_revision_digest`を追従させ、revision後にstoreを読めなくなる欠陥を直した。
- 新規plan authoringの入口の記述を実装どおりに書き直した。
- publish対象commitが既定ブランチの祖先であることを`prepublishOnly`の機械gateで強制するようにした。

## 0.12.8 — 2026-07-23

- Phase v3の後続revisionで、既存active sourceを同じ`source_cutover_batch`の明示操作により新しいarchiveへ移転できるようにした。
- cutover操作・旧ref/digest・移転先inventoryが一致しないsource消失は、従来どおり`predecessor_source_silently_dropped`で拒否する。

## 0.12.7 — 2026-07-23

- 巨大工程図のrender中にhealth応答が500msを超えても、生存中dashboardを死亡扱いして新daemonを孤児化しないようにした。
- dashboardはmanifest file identityが変わらない間のstable store readを再利用し、active projectの毎秒再読みと重複renderによるCPU・メモリの自己増幅を防いだ。
- public bridgeのloopback attestationはPID・port一致を維持したまま、正常なbusy health応答を待てる上限へ更新した。

## 0.12.4 — 2026-07-22

- `run abandon --reason`で日本語・空白・句読点を含む監査可能な説明を受理し、表示を偽装するUnicode制御文字・前後空白・256文字超過をCLIとmanaged control wireの共通validatorでmutation前に拒否するようにした。
- `BOUNDARY_UNKNOWN`へ元witnessを残し、fresh path不存在だけを`BOOTSTRAP_OWNERSHIP_SEAM`、既存path・symbol・未束縛ownershipを`ACQUIRE_OWNERSHIP_EVIDENCE`へ分けて安全な次手を機械可読化した。

## 0.12.3 — 2026-07-22

- activeな`phase_todo_revision.v1/v2`でも履歴上の有効source inventoryを解決し、`todo verify`がsource driftを検出して実件数を返すようにした。
- `phase_todo_revision.v3`適用時はinventory差分より先にpredecessor source実体を検証し、物理driftを`predecessor_source_silently_dropped`へ誤分類しないようにした。
- product suiteの並列数を4へ固定し、sensorのMCP初期化test cleanupへbounded retryを追加して、full gateの資源競合を安定化した。

## 0.12.2 — 2026-07-22

- unpublish済みの0.12.1と同一機能を、再利用可能な新versionとしてprivate registryへ再公開した。
- `publishConfig.access`を`restricted`へ固定し、以後のnpm publishが意図せずpublicへ戻らないようにした。

## 0.12.1 — 2026-07-22

- crash後にstale daemon descriptorだけが残ったbridge再構成を`not_running`へ収束させ、停止receipt timeoutで公開経路を復旧できない問題を修正した。
- actor環境のないsession開始時の`lattice status --json`でもactive projectをdashboardへ登録し、既存セッションのprojectが一覧から欠落する問題を修正した。
- 親環境の`FORCE_COLOR`がCLI JSON-only testへNode警告を混入させないよう、子process環境を明示的に隔離した。

## 0.12.0 — 2026-07-22

- actor付きの通常TODO activityからactive projectを自動登録し、一つのloopback dashboardでproject一覧、project固有工程図、SSE更新を提供するようにした。
- Ganttの依存線を専用channelへ直交routingし、box回避、join connector、交差bridgeを追加した。
- 明示IP bindとHost allowlistを持つopt-in network bridge、daemon自動復旧、reverse proxy向けの配備手順を追加した。
- managed runtimeに保存済み競合のfreeze、全running barrier、successor再compile、epoch再bindを追加し、AIShellの実fixtureで競合回収をend-to-end検証した。
- bundled sensorのaffected結果へ`Tests/`配下および`*Tests.swift`のSwift testを含め、既存の`e2e/`分類も維持した。

## 0.11.3 — 2026-07-21

- TODO mutationのactor解決失敗へrequired／missing／invalid環境キーと正規次操作を追加した。
- OS由来identityへのfallbackとstore変更は行わず、callerが設定不備を機械判定して同じ操作を再試行できるようにした。

## 0.11.2 — 2026-07-21

- bundled sensor失敗時にexit code、signal、bounded stderrを保持し、未初期化をtyped errorへ分類した。
- 未初期化syncへ同一pathの正規`lattice sensor init`次操作を返し、silent initやfallbackを追加せず根因を公開した。

## 0.11.1 — 2026-07-21

- 公開subcommandの`--help`／`help`入口を追加し、`todo reopen`等の正規optionをstore非依存で確認可能にした。
- namespace helpと同じclosed surfaceからusageを返し、未知subcommandは従来どおりusage違反で拒否する。

## 0.10.0 — 2026-07-21

- `todo status` v4へ全readyを同時dispatchする`dispatch_frontier`契約を追加した。
- readyが複数の最初の`todo start`に並列開始宣言または意図的直列化理由を必須化した。
- Ganttのready表示を「依存候補」から「同時dispatch推奨」へ更新した。
- Phase監査境界・監査回数・ToDo DAGは変更せず、Phase groupingによる暗黙直列化を再導入しない。

## 0.9.1 — 2026-07-21

- PhaseをToDoの直列化groupから重監査境界へ分離し、通常ToDoはDAGだけで並列readyを判定するv5契約へ更新した。
- Phase受理が本当に必要なToDoだけを閉じる`phase_accept_dependencies`と、v3 authoring schemaを追加した。
- fresh projectのtyped discoveryがv3 authoring schemaと生成commandを`next_action`で返すよう更新した。
- live GanttをSSEで自動更新し、静的Ganttのdigest付き`current / stale / missing`検証を維持した。
- runtime、project state、設定、環境変数、MCP tool名をLattice Sensorへ完全切替し、旧製品dataを入力・移行元・fallbackとして読まない契約を固定した。
- 新規AIShell cloneで48 files／797 nodes／2078 edgesを構築し、`DevelopmentRuntimeService`のdepth 3 impactが74 nodes／107 edgesになることを現行sensorだけで確認した。
- 製品testと退役済みartifact replayを分離し、公開判定が現行runtime surfaceだけを評価するようにした。

## 0.9.0 — 2026-07-21

- first-class Phase controlを追加し、ToDo完了時の軽量確認とPhase境界の重監査を分離した。
- `todo phase status/review/accept/reject/reopen`、Phase state migration、Decision evidenceを追加した。
- `todo revise-set` v3でPhase revision同士、およびPhase revisionと通常revisionのcross-plan atomic activationに対応した。
- `todo status/verify --json`の互換aliasを復旧し、cross-plan start/done/reopenの判定をmerged storeへ統一した。
- loopback-onlyのlive Ganttを追加し、静的Ganttには`current / stale / missing`を判定するdigest付きstatus面を追加した。
- bounded seamの隔離transform契約を追加し、許可locus外の変更をfail closedにした。
- 外部の旧上流runtime・旧cache/dataへの依存を廃止し、配布物内のLattice sensorだけを正式runtimeとした。
- Phase revisionの全6 durability境界と、通常／Phase混在revision setのcrash retryを検証した。

## 0.8.0 — 2026-07-20

- project-local run storeと`run list/resume/close/abandon`を正式化した。
- runtime/control timestampをcanonical UTC millisecondsへstrict化した。

## 0.7.3 — 2026-07-20

- private Lattice sensor runtimeを配布物へ固定し、公開`codegraph` binを除去した。

## 0.7.0 — 2026-07-20

- 旧上流由来実装をLattice所有sensorへ吸収し、公開入口を`lattice sensor`へ切り替えた。

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
