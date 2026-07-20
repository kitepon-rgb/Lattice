# Lattice integration package（現行公開面）

- Updated: 2026-07-21
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

## 2. schema一覧

正典: [ADR 0044 Decision 2](adr/0044-rc3-runtime-contract.md)（RC3所有10 schema表）＋
[ADR 0045 Decision 4](adr/0045-rc3-phase-gate-support.md)（CLI envelope 8 schema・genesis sentinel）。

- RC2公開済み継承: `lattice.boundary_verdict.v2`・`lattice.plan_graph.v2`・RC2 artifact manifest系（同名変更禁止）
- 共通規律: exact key・bounded collection・canonical serialization・SHA-256 digest・fail closed。
  field追加・意味変更はversionを上げ新ADRで裁定（in-place拡張禁止）
- TODO工程: 現行authoringは`lattice.plan_create_input.v3`、planは`lattice.todo_plan.v5`、
  eventは`lattice.todo_event.v4`、snapshotは`lattice.todo_snapshot.v2`、Phase revisionは
  `lattice.phase_todo_revision.v2`、cross-plan revisionは`lattice.todo_revision_set.v3`を使う。
  旧schemaは既存storeの読取・移行互換としてだけ維持する。

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

## 5. Lattice Sensor同梱契約（完了）

正典: [ADR 0059](adr/0059-lattice-sensor-identity-and-tool-name-cutover.md)。

- MIT license notice・attribution維持（`sensor/LICENSE`・`sensor/NOTICE`・fork時点upstream `841beea`）
- runtimeは配布物内の`./sensor/dist`だけを直接起動し、外部CLI・外部SDKへfallbackしない
- index管理の公開入口は`lattice sensor init|sync [path] --json`、MCP入口は`lattice-mcp`
- project stateは`.lattice/sensor/`だけに作り、別製品のcache/dataを入力・移行元・fallbackとして読まない
- MCP公開toolは`lattice_sensor_*`だけ、設定は`lattice-sensor.json`、環境変数は`LATTICE_SENSOR_*`だけを使う
- standalone installer・upgrade・uninstall・独立binは配布しない

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
