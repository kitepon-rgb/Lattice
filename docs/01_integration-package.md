# Lattice integration package（現行公開面）

- Updated: 2026-08-08
- 位置づけ: hostや工場へ組み込む公開面の索引。**各契約の正典は参照先ADR**であり、
  本書は所在と編入条件だけを固定する（複製しない）。
- 根拠裁定: [ADR 0051](adr/0051-rc4-phase-gate-support.md)（RC4条件付きsupport・Decision 6のcarry-over）

## 1. runtime CLI 6面の安定契約

正典: [ADR 0044 Decision 8](adr/0044-rc3-runtime-contract.md)。

- 面: `lattice plan compile / plan verify / run start / run observe / run status / event verify`
  （＋既存`--version`。`doctor --json`は[ADR 0052](adr/0052-cli-error-v2-and-doctor-retirement.md)で
  退役＝typed失敗envelopeも`lattice.cli_error.v2`（optional `detail`）へ更新済み）
- stdout=versioned JSONのみ・診断はstderr・exit 0/1/2契約・fail closed・暗黙provider fallbackなし
- envelope schema（`plan_compile_result.v1`等8種）の所有は[ADR 0045 Decision 4](adr/0045-rc3-phase-gate-support.md)
- failure envelopeは`lattice.cli_error.v2`へ統一済みで、optional `detail`を保持する。
- request契約の取得は`plan compile --schema --json`か`run start --schema --json`
  （[ADR 0123](adr/0123-runtime-contract-distribution-and-diagnosability.md)）。
  `INVALID_RUN_REQUEST`は`detail`へ`{ reason, path }`を返す。

## 2. schema一覧

正典: [ADR 0044 Decision 2](adr/0044-rc3-runtime-contract.md)（RC3所有10 schema表）＋
[ADR 0045 Decision 4](adr/0045-rc3-phase-gate-support.md)（CLI envelope 8 schema・genesis sentinel）。

- RC2公開済み継承: `lattice.boundary_verdict.v2`・`lattice.plan_graph.v2`・RC2 artifact manifest系（同名変更禁止）
- 共通規律: exact key・bounded collection・canonical serialization・SHA-256 digest・fail closed。
  field追加・意味変更はversionを上げ新ADRで裁定（in-place拡張禁止）
- 配布されるJSON Schema: `plan_create_input` v1〜v4に加え、`todo_revision.v2`、
  `todo_revision_set.v3`、`phase_todo_revision.v3`、`todo_extraction` v2〜v3、`run_request.v1`・`executor_packet.v1`・
  `executor_receipt.v1`・`runtime_adapter_registration_input.v1`を`docs/schemas/`で同梱する。
  この4 schemaの正本は配布ファイルであり、ADR 0044 Decision 2の表ではない（ADR 0123・0125）。
- TODO工程とruntime実行の相関: `todo bindings [--plan <key>] --json`が
  `lattice.todo_binding_projection.v1`を返す（[ADR 0124](adr/0124-todo-binding-projection.md)）。
  `todo_status_result`とは独立した加算の別面なので、statusの版に関わらず既存hostはそのまま動く。
- TODO工程: 現行authoringは`lattice.plan_create_input.v4`、planは`lattice.todo_plan.v7`、
  eventは`lattice.todo_event.v4`、snapshotは通常`lattice.todo_snapshot.v1`／`v2`、`test_result`を
  一度でも持つplanでは`v3`／`v4`（後者がPhase付き）、Phase revisionは
  `lattice.phase_todo_revision.v3`、cross-plan revisionは`lattice.todo_revision_set.v3`、
  statusは`lattice.todo_status_result.v6`を使う（`audit_pending`に加えて工程に属する義務を出す
  `plan_notes`、調整方式の宣言を出す`coordination`、並列候補を出す`parallel_candidates`を持つ。
  ADR 0159・ADR 0160）。
  旧schemaは既存storeの読取・移行互換としてだけ維持する。

### 2.1 ToDo設計メモと動的工程表

- 新規authoring／抽出／revisionの各ToDoは、非空Markdownの`design_memo`を持つ。ファイル参照だけの本文を
  受理せず、実装方針を持たない時だけ正確なsentinel `NO_PLAN`を受理する。
- authoring入口は「If you have not thought through this ToDo, write exactly `NO_PLAN` in its design memo.」を
  機械可読guidanceへ含める。`NO_PLAN`は空欄を成功に見せるdefaultではなく、無計画を明示する申告である。
- `todo show`と成功する`todo start`は初期設計メモを自動返却する。append-only noteは開始後に増えた
  作業記憶の別層であり、初期設計メモを代替しない。
- 個別ToDo右ペインはあらゆる動的viewerで初期設計メモとappend-only note本文を表示する。面による
  除外は無い（ADR 0153の公開面除外は0.50.0で廃止）。
- 運用表示面は動的dashboardだけとし、project別HTMLやstatus sidecarを生成しない。
  `todo gantt`／`todo gantt status`は`STATIC_GANTT_RETIRED`で正規の動的入口を返す。
- `todo migrate --schema --json`は最新`lattice.todo_extraction.v4`を返し、`--dry-run`は書込なしで
  diagnostics、source inventory、cutover batchを検査する。検証結果は`lattice.todo_verify_result.v3`、
  foreground viewer起動結果は`lattice.todo_gantt_live_result.v3`で返す。

## 2.5 ready frontier dispatch契約

正典: [ADR 0063](adr/0063-ready-frontier-dispatch-contract.md)。

- `todo status`の`dispatch_frontier`は`next_ready`全件、推奨同時数、frontier digest、subset理由要否を返す。
- readyが複数かつactive taskがない時、最初の`todo start`は`--parallel-frontier`か
  `--override-reason <reason>`を必須とする。
- hostがagent生成と実dispatchを所有する。Latticeは宣言後の全件着手完了を成功扱いせず、
  `active_set`と`next_ready`へ実状態だけを投影する。
- Phase、監査回数、task DAGをこの契約から追加・変更しない。

## 3. run store／artifact規約

正典: [ADR 0044 Decision 3](adr/0044-rc3-runtime-contract.md)（event store）・
[Decision 10](adr/0044-rc3-runtime-contract.md)（event／artifact rootの所有境界）。

- 判定・受入は保存bytesから独立再計算可能（RC3検証規律）。artifactはatomic発行・
  manifest digest照合・artifact-only verification（RC4実績: `v4-landing` 19 check green）
- 既知の未解消: `patches_bound_to_accepted_receipts`はpath照合のみ
  （[ADR 0051 Decision 4](adr/0051-rc4-phase-gate-support.md)・maintenance queue移管済み）
- 評価残（fsync耐久性・並行発行競合・多epoch CLI replay等）はADR 0045 Decision 4の非blocker列挙が正

## 4. executor adapter契約

正典: [ADR 0044 Decision 9](adr/0044-rc3-runtime-contract.md)（adapter境界・opaque handle・
packet帰属）＋[ADR 0050](adr/0050-stage1-executor-isolation-implementation.md)（実装形＝
subagent executor・packet `isolation_contract`・fingerprint境界検証・diff observer）。

- dispatchは`executor_packet.v1`必須・receiptは`packet_digest`帰属・CLIはprovider sessionを所有しない
- 実証済みadapterは`claude-implementer-subagent`のみ（単一provider＝
  [ADR 0051 Decision 2](adr/0051-rc4-phase-gate-support.md)のclaim境界。クロスprovider executorは未実証）
- adapter登録は公開面である（[ADR 0125](adr/0125-public-runtime-adapter-registry-cli.md)）。
  `run adapter register --input <file>`／`run adapter list --json`／`run adapter register --schema --json`。
  digestは利用者に手計算させず、binary・config・capabilities・自己digestをCLIが導出する。
- 決定論的な参照controllerを`lattice-scripted-adapter`として配布する
  （[ADR 0126](adr/0126-distribute-scripted-adapter-controller.md)）。公開CLIと配布binだけで
  `run activate`→実write→receipt受理→`resume`／`close`まで到達する。初回駆動は配布binを
  launch argvへ明示したmanaged runだけに効き、実dispatchの所有者はhostのままである。

## 5. Lattice Sensor同梱契約（完了）

正典: [ADR 0059](adr/0059-lattice-sensor-identity-and-tool-name-cutover.md)。

- MIT license notice・attribution維持（`sensor/LICENSE`・`sensor/NOTICE`・fork時点upstream `841beea`）
- runtimeは配布物内の`./sensor/dist`だけを直接起動し、外部CLI・外部SDKへfallbackしない
- index管理の公開入口は`lattice sensor init|sync [path] --json`、MCP入口は`lattice-mcp`
- project stateは`.lattice/sensor/`だけに作り、別製品のcache/dataを入力・移行元・fallbackとして読まない
- MCP公開toolは`lattice_sensor_*`だけ、設定は`lattice-sensor.json`、環境変数は`LATTICE_SENSOR_*`だけを使う
- standalone installer・upgrade・uninstall・独立binは配布しない

## 5.1 hooks導線（sensor気づかせ導線）

正典: [設計契約r5](evidence/2026-08-01-sah-p1-design-contract.md)。公開構文は
`lattice hooks <install|status|uninstall|emit> --host <claude|codex>`で、v1はPOSIX専用とする。
native Windowsでは`HOST_PLATFORM_UNSUPPORTED`を返し、設定やstateへ書き込まない。

- `install`はClaudeの`~/.claude/settings.json`またはCodexの`~/.codex/hooks.json`の
  `hooks.UserPromptSubmit`へ、絶対Node実行体、実在する絶対`bin/lattice.mjs`、
  `hooks emit --host <host>`からなるcanonical commandを1件だけ冪等マージする。pathはPOSIX shellで
  argvを往復できるようquoteし、NUL・CR・LFを含むsourceは`INSTALL_SOURCE_UNRESOLVED`で拒否する。
  両hostのhandler timeout keyは`timeout: 5`であり、`timeoutSec`は書かない。Codex handlerはさらに
  `async: false`と`statusMessage: null`を持つ。成功schemaは`lattice.hooks_install_result.v1`、
  stateは`wired|already_wired`である。
- 設定更新前には既存bytesのbackupをO_EXCL・0600で作り、fileと親directoryをfsyncする。
  preimage再検証、既存fileのhard-link退避、dev/ino再検証、atomic rename、親directory fsync、
  read-backを順に通す。不在設定は`link(tmp,target)`でno-clobber作成する。通常成功時はbackupと
  displaced preimageを種類ごとに新しい5世代まで残す。commit前失敗では当回artifactだけを回収し、
  commit後に失敗した当回artifactは保持する。復元にも失敗した場合は`RESTORE_FAILED.detail`の
  `backup_path`と`displaced_path`へ両pathを返す。世代回収だけの失敗は成功結果の非致命warning
  `GENERATION_PRUNE_FAILED`として可視化する。
- install identityは`lattice.hooks_install_receipt.v1`のargv完全一致だけで判定する。receiptは
  `$XDG_STATE_HOME/lattice/hooks/installs/<host>.json`（`XDG_STATE_HOME`が絶対pathの時だけ採用し、未指定・
  相対path時は
  `$HOME/.local/state/lattice/hooks/installs/<host>.json`）に0600で置き、entry stateを
  `pending|committed`で管理する。state directoryは同一ownerかつgroup／world書込不可を検証し、
  新規directoryは0700で作る。30秒を超えたreceipt lockだけをstaleとして回収し、lock取得後に
  configを再読してpendingをcommitted化または除去する。receiptに一致しない
  `hooks emit --host <host>`形はforeign candidateとして数えるだけで、所有物と推定しない。
- `status`は`lattice.hooks_status_result.v1`の一行JSONで、`host`、`config_path`、`state`、
  `canonical_command`、`matched_handler_count`、`foreign_candidate_count`、`executable_ok`、
  `next_action`を返す。stateは`wired|drift|not_wired|unreadable`である。`wired`は現canonical handlerが
  exactに1件、foreign candidateが0件、Nodeとscriptがともに実行可能な時だけである。matchedと
  foreign candidateがともに0件なら`not_wired`、読取可能だがそれ以外なら`drift`、dir／file／platformを
  安全に読めなければ`unreadable`とする。
  `unreadable`だけexit 1、その他はexit 0である。
- `uninstall`は現canonical argvとreceiptのcommitted argvに完全一致するhandlerだけを除去し、
  wrapper内のforeign handler、metadata、順序を保持する。成功schemaは
  `lattice.hooks_uninstall_result.v1`で、`removed_count: 0`も成功である。
- 引数・platform・install／uninstallのtyped failureは`lattice.hooks_error.v1`を使う。公開codeは`USAGE`、
  `HOST_PLATFORM_UNSUPPORTED`、`HOST_NOT_PRESENT`、`INSTALL_SOURCE_UNRESOLVED`、
  `CONFIG_SYMLINK_UNSUPPORTED`、`CONFIG_UNREADABLE`、`INSTALL_RECEIPT_UNSAFE`、
  `CONFIG_WRITE_FAILED`、`RESTORE_FAILED`である。`USAGE`はexit 2、その他はexit 1である。
- `emit`は最大64KiBのJSON stdinへ非空`session_id`と絶対`cwd`を要求する。
  `LATTICE_HOOKS=off`ならstateを作らず沈黙する。git repoかつ`.lattice/sensor/` directoryがある時だけ、
  session×repoで1回だけ通知する。通知markerは7日で回収されるため、同一session×repoでも7日経過後は
  再表示されうる。Claudeは
  `INFO: このrepoにはLattice sensor index（.lattice/sensor/）があります。コード構造の調査はsensor入口（MCP: lattice_sensor_explore 等／CLI: lattice sensor）を優先できます。`
  をplain 1行、Codexは`hookSpecificOutput.hookEventName: "UserPromptSubmit"`と同じ文の
  `additionalContext`を持つ一行JSONで返す。
  通知stateは同じ`$XDG_STATE_HOME/lattice/hooks`配下に置き、`.shown`は7日、`.claim`は1時間を超える
  Lattice所有名だけ回収する。非git・index不在は沈黙する。不正stdin／出力失敗は`errors.log`へ記録して
  沈黙し、記録失敗時だけ一行診断へfallbackする。git／sensor／claim／shown／回収処理の判定不能は
  記録を試みたうえで常に一行診断を出す。state root自体が利用不能なら記録せず一行診断を出す。

実装・CLI helpとの一致と上記安全則は[test/hooks-cli.test.mjs](../test/hooks-cli.test.mjs)の48件で固定する。

## 5.5 native factory diagnosticsとruntime error store（工場必須要件・実装済み）

- diagnostics: `lattice factory-diagnostics --json`（schema `lattice.native_factory_diagnostics.v1`・
  check 5本・overall failed→exit 1・read-only・秘密なし）。正典は`src/factory-diagnostics.mjs`
- runtime error store: `lattice runtime-errors <snapshot|ack|diagnostics|resolve|reopen|compact> --json`
  （schema `lattice.runtime_errors.v1`。Caveat同型の工場契約）。**opt-in**＝工場共有config
  `~/.config/dotagents/factory-reporter.json`の`collection.enabled`のみが収集を有効化し、
  reporting（BugHub送信）はdotagents adapter所有で本storeは外部送信しない（collection/reporting分離）。
  固定catalog 5 code・fingerprint集約・cursor/ack・resolved+ack済み30日compact・POSIX owner-only検査で
  fail closed。正典は`src/runtime-errors.mjs`

## 6. 編入の前提条件（残余リスク恒久化・回帰条件）

正典: [ADR 0051 Decision 5](adr/0051-rc4-phase-gate-support.md)＋
[ADR 0050 Decision 5](adr/0050-stage1-executor-isolation-implementation.md)。

- subagent executor形態の適用範囲は**公開repo内容を扱うcampaignのみ**。秘匿情報を扱う場合は
  隔離HOME回帰（オーナーによる認証用意）を前提条件とする
- RC4のclaim境界（単一provider・仕様渡し再実装・小粒patch・実timeout/reject/rollback未観測）を
  引用せずに能力を語らない（ADR 0051 Decision 2）

## 7. dotagents側導入planに委ねる項目（本repoは所有しない）

core product編入後のhost/product matrix、install/verify、BugHub source登録、将来のhost移行はdotagentsが所有する。
Lattice本体のPhase、revision、Gantt、sensor公開契約は本repoのproduct contractとADRを正本とする。
