# Lattice編入パッケージ要件（dotagents工場コア編入・L6引き渡し文書）

- Date: 2026-07-18
- 位置づけ: dotagents導入plan（`dotagents/docs/plan_lattice-factory-integration.md` Phase L6）への
  引き渡し台帳。**各契約の正典は参照先ADR**であり、本書は所在と編入条件だけを固定する（複製しない）。
- 根拠裁定: [ADR 0051](adr/0051-rc4-phase-gate-support.md)（RC4条件付きsupport・Decision 6のcarry-over）

## 1. CLI 6面の安定契約

正典: [ADR 0044 Decision 8](adr/0044-rc3-runtime-contract.md)。

- 面: `lattice plan compile / plan verify / run start / run observe / run status / event verify`
  （＋既存`--version`。`doctor --json`は[ADR 0052](adr/0052-cli-error-v2-and-doctor-retirement.md)で
  退役＝typed失敗envelopeも`lattice.cli_error.v2`（optional `detail`）へ更新済み）
- stdout=versioned JSONのみ・診断はstderr・exit 0/1/2契約・fail closed・暗黙provider fallbackなし
- envelope schema（`plan_compile_result.v1`等8種）の所有は[ADR 0045 Decision 4](adr/0045-rc3-phase-gate-support.md)
- 既知の未解消: `cli_error.v1`がcompile失敗の`detail`を落とす（maintenance queue移管済み。
  schema変更はenvelope正式化と同時に裁定）

## 2. schema一覧

正典: [ADR 0044 Decision 2](adr/0044-rc3-runtime-contract.md)（RC3所有10 schema表）＋
[ADR 0045 Decision 4](adr/0045-rc3-phase-gate-support.md)（CLI envelope 8 schema・genesis sentinel）。

- RC2公開済み継承: `lattice.boundary_verdict.v2`・`lattice.plan_graph.v2`・RC2 artifact manifest系（同名変更禁止）
- 共通規律: exact key・bounded collection・canonical serialization・SHA-256 digest・fail closed。
  field追加・意味変更はversionを上げ新ADRで裁定（in-place拡張禁止）

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

## 5. Lattice sensor同梱・独立Codegraph退役方針

正典: [ADR 0047](adr/0047-codegraph-absorption-and-sensor-ownership.md)（fork吸収・sensor自前所有）＋
[ADR 0049](adr/0049-lattice-mcp-surface-contract.md)（MCP面の公開契約・製品同一性分離・外部通信遮断）。

- MIT license notice・attribution維持（`sensor/LICENSE`・`sensor/NOTICE`・fork時点upstream `841beea`）
- runtimeは配布物内の`./sensor/dist`だけを直接起動し、PATH上の`codegraph`、
  `npx @colbymchenry/codegraph`、外部SDKへfallbackしない
- index管理の公開入口は`lattice sensor init|sync [path] --json`、MCP入口は`lattice-mcp`
- 単独Codegraph配線の退役はdotagents側plan L7が所有し、受入fixture通過後に原子的cutoverする。
  `codegraph_*`互換tool名の提供者識別と次期majorでの改名はADR 0059が正

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

core product編入の配線（native factory diagnostics・runtime error store・配布形態・
product contracts台帳・host/product matrix・install/verify・BugHub source登録）、
単独Codegraph退役のhost別手順・rollback。正典はdotagents
`docs/plan_lattice-factory-integration.md`（L6/L7/Q22）。
