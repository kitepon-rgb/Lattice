# bh6準備 — Windows端末の常駐機構 + 実機で発見したcross-platform欠陥3件

bh6-multi-terminal-proofはbh5-deploy done待ちのhard dependencyがあり正式startできない
（plan.jsonのhard_dependencies確認済み）。オーナー裁定によりWindows端末配線を先行させる
指示（room 2437・2442）を受け、実装はtodo note（bh5-deployへ記録）で経緯を追い、
bh6解錠後に正式なclaim/start/doneで追認する。

## 作ったもの

- `bin/lattice-bridge-supervisor.mjs`（新規）: Windows常駐用のsupervisor。
  descriptor.json（env var・bridgePath・pidPath）を受け取り、`bin/lattice-bridge.mjs`を
  spawn→exit待ち→再spawnのloopで動かす。自分のpidをpidPathへ書く——`taskkill /T /F`で
  process木ごと止められるようにするため（forcibly terminateされたsupervisorは自分の
  子processを片付けられないので、木ごとkillするのがWindowsでの正しい停止法）。
- `src/bridge-startup-folder.mjs`（新規）: `bridge-launch-agent.mjs`と同型の contract
  （snapshot/install/disable/restore）を持つWindows版永続化。設計判断の経緯:
  - Task SchedulerのONLOGONトリガーは非elevatedでは作成不可なことを実機で確認済み
    （`schtasks /Create /SC ONLOGON`・`Register-ScheduledTask -Trigger
    (New-ScheduledTaskTrigger -AtLogOn)`両方とも"Access is denied"、`/SC ONCE`は同条件で成功）。
    オーナーの「npm install+宛先1回設定以外の儀式は製品欠陥」という基準に照らし、
    昇格を要さないStartup folder（`%APPDATA%\...\Startup`、非elevated書込確認済み）を採用
    （tsumugiと合意・room 2451/2455/2456）。
  - cmd.exeの自前GOTOループは自分自身のpidを安定して取得できずkillが困難と判断し、
    Node自身のsupervisor（上記）へ切替。
  - Startup folder内は`.vbs`launcherだけを置く（`WScript.Shell.Run(cmd, 0, False)`で
    windowStyle=0=非表示起動——0.52.4のconsole雪崩hotfixと同じ「見える窓を作らない」
    配慮を別機構で再現）。実体（descriptor.json・pidfile）は`%LOCALAPPDATA%\Lattice\...`に
    置きStartup folderを汚さない。
- `src/bridge-cli.mjs`: `launchAgent`のデフォルトを`process.platform`で判定する
  `platformLaunchAgent()`へ変更（darwin→bridge-launch-agent.mjs、win32→上記新規モジュール）。
  `lattice bridge setup`が別コマンドを要さずWindowsでも同じ入口で動くようにした。

## 実機で発見したcross-platform欠陥3件（本タスクの副次的発見だが同一commitで修理）

`src/bridge-config.mjs`・`src/bridge-daemon.mjs`・`src/bridge-server.mjs`が、読み戻し時に
`(stats.mode & 0o777) !== 0o600`という厳格なUnix権限bit検証を無条件に行っており、
Windowsでは`fs.stat().mode`がPOSIX形式の値を返さないため**この検証が常に失敗し、
bridgeがWindowsで一切起動できない**ことを実機で発見した（`node bin/lattice-bridge.mjs`を
Windows上で直接実行し`BRIDGE_CONFIG_MODE_INVALID`を実測）。3fileとも
`process.platform !== 'win32'`でこの分岐だけ無効化する形で修理し、darwin/linuxの挙動は
一切変えていない（既存test全green・macOnly launch-agent testも無変更で通過）。

## 実機検証（Windows native、`C:\Users\kite_\Documents\Program\Lattice`のdev codeを直接実行）

- `installBridgeStartupFolder`を実際に実行→`.vbs`launcher・descriptor.jsonが正しい内容で
  atomic writeされることを確認。
- `wscript.exe`経由でsupervisorが実際に起動し、pidfileへ自分のpidを記録することを確認
  （`Get-Process`・`Get-CimInstance Win32_Process`で実プロセスとコマンドラインを確認）。
- supervisorが子として`bin/lattice-bridge.mjs`を起動し、health endpoint
  （`http://192.168.1.11:<port>/__lattice/bridge-health`）が`lattice.bridge_health.v1`を
  実際に返すことを確認（不可視window——目視でconsole flashなし）。
- **発見した設計ギャップとその解消**: hubが`172.18.0.1`（docker bridge gateway、container専用）
  にbindされておりLAN上の端末から到達不能だった。公開URL経由の登録も試したが送信元address
  がCaddyのcontainer IPになりADR 0162 Decision3（端末は自分自身しか登録できない）の安全性質
  と両立しないため却下——hubのLAN bind拡張（`0.0.0.0`）+ufw追加（サーバー側、bell対応）を
  正裁定（room 2469）、bellが即時適用（room 2471: `LATTICE_HUB_LISTEN=0.0.0.0`・
  `LATTICE_HUB_ALLOWED_HOSTS`にIP追加・ufwで192.168.1.0/24→53943/tcp許可）。
- **完全な疎通を実機で確認（コード変更・手動再登録なし）**: サーバー側修理の直後、
  既に起動していたWindows bridge daemonが次のheartbeat周期で自動的にhub登録に成功した
  （bh3の30秒周期retryどおり、手動操作ゼロ）。実測フルチェーン:
  - `http://192.168.1.2:53943/projects/`（LAN直）: `lattice`(display_name=FOX)がonline。
  - `https://lattice.kitepon.dev/projects/`（公開）: 同一内容。
  - `https://lattice.kitepon.dev/projects/lattice/`: HTTP 200、実際のGantt依存工程図HTML
    （title="Lattice — Lattice 依存工程図"）。
  - `https://lattice.kitepon.dev/projects/lattice/events`: HTTP 200、接続直後に
    `event: state`+`head_digest`を実測（plan_bridge-hub.mdの/events継続・再接続gate要件どおり）。
  これにより、オーナー受入条件「npm install + 宛先1回設定 → 自動起動・自動hub登録・
  自動常駐、以後手作業ゼロで公開面反映」をWindows端末で実機達成したと判断する。

## 検証

- `node --test test/bridge-cli.test.mjs test/bridge-startup-folder.test.mjs
  test/bridge-config.test.mjs test/bridge-daemon.test.mjs test/bridge-launch-agent.test.mjs
  test/bridge-registrar.test.mjs test/bridge-hub-heartbeat.test.mjs test/bridge-hub-protocol.test.mjs
  test/bridge-hub-server.test.mjs test/bridge-hub-integration.test.mjs test/bin-lattice-hub.test.mjs
  test/bridge-server.test.mjs`: 96/96 green（8 skip、macOnly分）。
- `node scripts/check-syntax.mjs`・`verify-product-reachability.mjs`・`verify-cli-surface.mjs`・
  `verify-open-questions.mjs`: 全green。
- Windows実機検証は上記の通り（bridge daemon起動・health確認まで）。hub到達性はサーバー側修理待ち。

## commit対象

`bin/lattice-bridge-supervisor.mjs`（新規）・`src/bridge-startup-folder.mjs`（新規）・
`src/bridge-cli.mjs`・`src/bridge-config.mjs`・`src/bridge-daemon.mjs`・`src/bridge-server.mjs`・
`test/bridge-startup-folder.test.mjs`（新規）・`evidence/bridge-hub/bh6-windows-startup.md`。
