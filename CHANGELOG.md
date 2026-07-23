# Changelog

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
