# bh5-deploy 段階① — hub daemon entry point（非H操作）

tsumugiとの合意（room 2411）どおり、bh5を①entry point実装（非H）→②H操作申請起票→③承認後配備
の3段階に分けた。本証跡は①のみを対象とする。実環境（192.168.1.2・Caddy・逆トンネル）への
操作は一切行っていない。

## 作ったもの

- `src/bridge-hub-server.mjs`: `startBridgeHubServer`のlisten addressを`LOOPBACK`固定から
  `listenAddress`（既定`127.0.0.1`）の注入可能な引数へ変更。**設計上の発見**:
  `docs/operations/lattice-kitepon-deployment.md`の実配備構成を読むと、192.168.1.2上の
  Docker Caddyはbridgeネットワークのcontainerでありhostの`127.0.0.1`へ直接到達できず、
  到達できるのはhost側でdocker bridge gatewayとしても機能する`172.18.0.1`のような
  アドレスへbindされたsocketだけである（現行構成はここへMacからの`ssh -R`が着地している）。
  bh2はこのbind先設計を意図的にbh5へ委譲していた（bh2 evidence決定②）ため、無断上書きでは
  なくtsumugiへ確認のうえ合意を得て実施した（room 2414/2415）。安全境界はbind addressでは
  なく既存の`allowedHosts`によるHost検査のまま——`bridge-config.mjs`のDHCP追従
  （`resolveBridgeListenAddress`のsubnet内rebind）はhubの配備先が固定サーバであり
  端末のように動かないため移植していない（tsumugi合意）。
- `bin/lattice-hub.mjs`（新規）: hub daemonのsystemd起動entry point。
  `bin/lattice-bridge.mjs`と異なり、DHCP追従・health attestation・LaunchAgent連携は
  持たない——systemdが唯一のprocess supervisorであり、hubの配備先自体はDHCPで動かない
  固定serverのため、その複雑さは不要と判断した。設定は永続化configファイルではなく
  環境変数のみ（`bridge-registrar.mjs`の「環境変数でopt-in」流儀を踏襲）——hubの配備先は
  1台のsystemd管理serverであり、`lattice bridge`のような複数開発機向けの対話的設定は不要。
  - `LATTICE_HUB_PORT`（必須・default無し）: Caddyの上流endpointが固定である必要があるため、
    ephemeral port（0）は明示的に拒否する。
  - `LATTICE_HUB_ALLOWED_HOSTS`（必須・comma区切り）: 空ならtypedエラーで起動を拒否する
    （空集合のallowedHostsは全requestを421にするだけの無意味な起動になるため）。
  - `LATTICE_HUB_LISTEN`（任意・既定`127.0.0.1`）: 配備時は`172.18.0.1`等を明示する想定。
  - SIGTERM/SIGINTで`hub.close()`を呼び正常終了する。

## 検証

- `node --test test/bridge-hub-server.test.mjs test/bridge-hub-integration.test.mjs
  test/bin-lattice-hub.test.mjs test/bridge-hub-protocol.test.mjs test/bridge-hub-heartbeat.test.mjs
  test/bridge-config.test.mjs test/bridge-cli.test.mjs test/bridge-daemon.test.mjs
  test/bridge-registrar.test.mjs test/cli-help.test.mjs`: 90/90 green。
  `test/bin-lattice-hub.test.mjs`（新規5件）は実際に`bin/lattice-hub.mjs`を子processとして
  起動し、必須環境変数の欠落・不正値がtypedエラー+exit 1になること、port 0の明示拒否、
  妥当な設定での起動→HTTP到達確認→SIGTERMでのexit 0までを実測した。テスト後の
  orphan process残存が無いことを`ps aux`で確認済み。
- `src/bridge-hub-server.mjs`のlistenAddress変更は既存9件のtest（default挙動）に加え、
  新規2件（明示listenAddressでのbind確認・不正値のtyped拒否）で回帰していないことを確認。
- `node scripts/check-syntax.mjs`: red（1/155）だが既知の`src/todo-store.mjs:1066`NULバイト
  のみ（bh1〜bh4のevidenceで既報告・自分の変更に無関係）。
- `node scripts/verify-product-reachability.mjs`: green（102 product modules /
  undeclared_unreachable=[] / stale_declarations=[]）。bin/lattice-hub.mjsが新規entry
  pointとなり、bh1のbridge-hub-protocol.mjs宣言に続きbh2のbridge-hub-server.mjs暫定宣言も
  今回で製品経路から実到達可能になったため除去した（entry_points 17→18）。
- `node scripts/verify-cli-surface.mjs`・`verify-open-questions.mjs`: green（変更なし）。
  `bin/lattice-hub.mjs`は`bin/lattice-bridge.mjs`と同じく`lattice <subcommand>`のCLI surface
  には現れないdaemon entry pointであり、cli-help.mjsへの登録は不要（既存daemon entry point
  との対称性を確認済み）。

## commit対象

`src/bridge-hub-server.mjs`・`bin/lattice-hub.mjs`（新規）・
`scripts/verify-product-reachability.mjs`・`test/bridge-hub-server.test.mjs`・
`test/bin-lattice-hub.test.mjs`（新規）・`evidence/bridge-hub/bh5-step1-entry-point.md`。

## 次

②のH操作申請起票へ進む（実配備・Caddy差替・逆トンネル退役の対象・影響・戻し方・実行手順・
検証gate）。実環境操作はオーナー承認後のみ実施する。
