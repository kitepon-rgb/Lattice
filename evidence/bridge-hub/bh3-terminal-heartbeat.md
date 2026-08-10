# bh3-terminal-heartbeat — 端末 bridge の hub 登録・heartbeat 実装

## 作ったもの

- `src/bridge-config.mjs`: bridge configへ`hub: {url}|null`フィールドを追加。
  `normalizeBridgeHubUrl`でHTTP(S) origin以外を拒否し、`validateBridgeConfig`／
  `configureBridge`／`validateMutation`へ配線した。
- `src/bridge-cli.mjs`: `--hub <URL>`（設定）/`--hub none`（解除）を`setup`/`reconfigure`へ
  追加。未指定時はreconfigureで現在値を持ち越す（`--upstream`と同じ扱い）。
  結果schemaを`lattice.bridge_cli_result.v3`へ（v2→v3差分は`hub`フィールド追加）。
- `src/bridge-hub-heartbeat.mjs`（新規）: bh1の`bridge-hub-protocol.mjs`とbh2の
  `bridge-hub-server.mjs`（`POST /__lattice/hub/register`）を端末側から使う実装。
  - `readOrCreateBridgeHubTerminalId`: 端末固有のterminal_idを`~/.lattice/bridge-hub-terminal.json`
    へ初回生成・永続化する。再起動のたびに変えないのは、bh1の登録が
    terminal_idキーの全件置換（full-state reconciliation）だからで、毎回変えると
    旧idがTTL失効するまで同じproject_idを自分自身と衝突させてしまう。
  - `buildBridgeHubRegistrationRequest`: project_idsを重複排除・整列し、
    `validateBridgeHubRegistrationRequest`（bh1）で検証してから返す。
  - `sendBridgeHubHeartbeat`: `bridge-registrar.mjs`と同じ思想でnetwork/remote失敗を
    投げずtyped resultで返す（hub到達不能を理由にlocalのbridge配信を落とさない）。
  - `createBridgeHubHeartbeatController`: `bin/lattice-bridge.mjs`の既存250ms
    pollループへ相乗りする周期controller。`BRIDGE_HUB_HEARTBEAT_INTERVAL_MS`
    （30秒）で自己throttleし、hub未設定なら即nullを返してdisk/networkに触れない。
- `bin/lattice-bridge.mjs`: 起動時に`createBridgeHubHeartbeatController`を生成し、
  既存の250ms reconcileループ内で`tick({config})`を呼ぶ。heartbeat失敗は
  fail-closed対象に含めない（`controller.close()`を呼ばない）——hub到達不能は
  hub側の合成一覧の話であり、この端末自身のdashboard配信を止める理由にならない。
- `scripts/verify-product-reachability.mjs`: bh1の暫定宣言（`src/bridge-hub-protocol.mjs`）を
  削除（このtaskの配線で製品経路から実際に到達可能になったため）。bh2の
  `src/bridge-hub-server.mjs`が起動entry point未配線のまま宣言漏れだったのを
  bh1と同型の宣言で補った（bh4「疑似2端末の統合テスト」がentry pointを配線するまでの
  暫定。tsumugiへ経緯を共有し合意済み・room 2396/2397）。
- `test/bridge-hub-heartbeat.test.mjs`（新規12件）・`test/bridge-config.test.mjs`（+2件）・
  `test/bridge-cli.test.mjs`（+1件、`--hub`設定/持ち越し/`none`解除の往復）。

## 検証

- `node --test test/bridge-config.test.mjs test/bridge-cli.test.mjs test/bridge-hub-heartbeat.test.mjs
  test/bridge-hub-protocol.test.mjs test/bridge-hub-server.test.mjs test/bridge-daemon.test.mjs
  test/bridge-registrar.test.mjs test/cli-help.test.mjs`: 79/79 green。
- `node scripts/check-syntax.mjs`: **red（1/154）だが自分の変更に無関係**。
  `src/todo-store.mjs:1066`の既存NULバイト（`f3b3b5c`由来、tsumugiのbh2 evidenceでも
  同一finding済み・別途復旧commit `29b69a3`とは無関係の残存separate defect）。
  自分が変更した全fileは対象外。
- `node scripts/verify-product-reachability.mjs`: green（101 product modules /
  34 declared research artifacts / undeclared_unreachable=[] / stale_declarations=[]）。
- `node scripts/verify-cli-surface.mjs`: green（67 commands、undocumented/unexercised=[]）。
  `--hub`を`src/cli-help.mjs`の`bridge setup`/`bridge reconfigure`usageへ追記済み。
- `node scripts/verify-open-questions.mjs`: green（109 ADR、unanchored=[]）。
- `node --check bin/lattice-bridge.mjs`・`node --check src/bridge-hub-heartbeat.mjs`: 構文OK。
- 実CLI smoke（`node bin/lattice.mjs bridge setup --hub http://192.168.1.2:8080 ...`）は
  この開発機（Linux/WSL）に`launchctl`が無く`BRIDGE_LAUNCHCTL_UNAVAILABLE`で止まる
  ——**bridge setupのLaunchAgentインストール手順自体がmacOS限定**（plan_bridge-hub.mdの
  既知の罠「Windows端末の常駐: LaunchAgentは無い」と同じ制約領域）で、bh3固有の欠陥ではない。
  focused testは`launchAgent`をdouble化して実際のsetup→reconfigure→hub往復の
  ロジックパスを検証しており（`test/bridge-cli.test.mjs`新規test含む）、実LaunchAgent連携は
  macOS実機でのbh6実端末配線の検証範囲とする。
- `npm test`・`npm run ci`は実行していない（NUL byte既知障害により現HEADで
  syntax check自体が赤いため、full run baselineとして意味を持たない。この点はbh1/bh2の
  evidenceと同じ判断）。

## 未実装（意図的に対象外）

- project_id衝突時の`adopt`自動化: heartbeatは常に`adopt: []`で送る。衝突が起きた場合は
  `state: 'rejected', status: 409`として観測できるが、自動解決はしない
  （ADR 0162非目標・plan「明示採用で解決」に従い、対話的な採用UXは別task）。
- bridge setup対話wizard（`collectBridgeSetupWizard`）への`--hub`統合。design_memoが
  要求する設定面は`setup`/`reconfigure`のflagだけで、wizardは対象外と判断した。

## commit対象

`src/bridge-config.mjs`・`src/bridge-cli.mjs`・`src/bridge-hub-heartbeat.mjs`（新規）・
`bin/lattice-bridge.mjs`・`src/cli-help.mjs`・`scripts/verify-product-reachability.mjs`・
`test/bridge-hub-heartbeat.test.mjs`（新規）・`test/bridge-config.test.mjs`・
`test/bridge-cli.test.mjs`・`evidence/bridge-hub/bh3-terminal-heartbeat.md`・
`.lattice/todo/`のbh3-terminal-heartbeat done化分。
