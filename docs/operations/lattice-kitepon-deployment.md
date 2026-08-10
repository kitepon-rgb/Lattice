# lattice.kitepon.dev 配備記録

2026-07-21 に、Lattice dashboardを既存のDocker Caddyとremote-managed Cloudflare Tunnel経由で公開した。
2026-07-26に、経路の最後の1hopをMac発の逆トンネルへ置き換えた。
Cloudflare管理APIの資格情報はリポジトリへ置かず、operator共通の
`~/.config/cloudflare-api.env`（mode 0600）から読み込む。Tunnel実行tokenを設定APIには使用しない。

## 配備構成

```
Cloudflare Tunnel → Docker Caddy → ssh逆トンネル → Mac loopbackのbridge
```

- Public hostname: `lattice.kitepon.dev`
- Tunnel origin: `https://caddy:443`（Origin requestで`Match SNI to Host`を有効化）
- Docker/Caddy host: `192.168.1.2`
- Caddy upstream: `172.18.0.1:53939` 固定。`172.18.0.1`は`license-server_default`
  networkのgatewayで、Caddy container自身から見た到達先である。
- Mac bridge: `127.0.0.1:53939`。LANへは一切bindしない。

MacからDocker/Caddy hostへ`ssh -R 172.18.0.1:53939:127.0.0.1:53939`を常駐させ、Mac側が接続しに行く。
**MacのLAN addressはこの経路のどこにも現れない**ため、DHCPのlease変更でreverse proxyのリテラルが
陳腐化する余地がない。有線USB LANとWi-Fiのどちらで繋がっていても、経路が1つあれば成立する。

以前はCaddyがMacのLAN addressをリテラルで持ち、`lattice bridge register`がlease変更のたびに
Caddyfileを書き換えて追従していた。現構成ではその追従自体が不要になったため、registrarは配線しない
（bridgeのLaunchAgentから`LATTICE_BRIDGE_REGISTRAR_*`を外してある）。registrar機能は製品側に残っており、
逆トンネルを張れない配備では引き続き使える。

### この構成に必要な設定

| 場所 | 設定 | 理由 |
| --- | --- | --- |
| Docker/Caddy host `sshd_config` | `GatewayPorts clientspecified` | 既定の`no`では`ssh -R`が`127.0.0.1`にしかbindできず、container から届かない。`yes`と違い、clientが明示したaddressだけにbindするのでLANへは晒さない。 |
| Docker/Caddy host `ufw` | `allow in on br-<network id> to 172.18.0.1 port 53939 proto tcp` | INPUT policyがDROPのため、container からhost gatewayへの接続が落ちる。 |
| Mac LaunchAgent | `dev.kitepon.lattice.bridge-tunnel` | `KeepAlive`で常駐。`ExitOnForwardFailure=yes`により、転送口を開けない時は転送なしで生き続けず、落ちて張り直す。 |

既存TunnelのIngressは保持し、catch-all 404の直前へLattice用ruleだけを追加してある。DNSは同じTunnelを指す
proxied CNAME。

## 受入結果

次のgateを順番に確認した。

1. Docker/Caddy hostから`http://172.18.0.1:53939/projects/`が許可Host付きでHTTP 200。
2. Caddy container内から同じendpointがHTTP 200。ufw許可前はここだけがtimeoutした。
3. Cloudflare公開HTTPSを別hostの通常DNS resolverから取得し、project一覧がHTTP 200。
4. `/projects/lattice/`がHTTP 200で、HTML titleが`Lattice — Lattice 依存工程図`。
5. `/projects/lattice/events`が接続直後に`event: state`と現在の`head_digest`を返す。
6. 逆トンネルのsshを`kill -9`した後、LaunchAgentが張り直し、公開URLがHTTP 200へ復帰する。

公開URLは `https://lattice.kitepon.dev/projects/lattice/`。

## 2026-07-30 v0.35.0・ブランド404反映

`@quolu/lattice@0.35.0`のglobal install後も、常駐bridgeは起動時に読み込んだ旧moduleを保持していた。
配備経路や設定を変更せず、次の正規入口でbridgeだけを再起動した。

```bash
launchctl kickstart -k "gui/$(id -u)/dev.kitepon.lattice.bridge"
```

再起動直後の最初のlocalhost probeはlisten前で接続に失敗し、その後のhealth確認で起動完了を確認した。
ssh逆トンネル、Caddy、Cloudflare Tunnel、LaunchAgent plist、portは変更していない。

反映後に次を確認した。

1. `/`、`/projects/`、`/projects/lattice/`が公開HTTPSで200。
2. 未知URLへ`Accept: text/html`を付けると、HTTP 404、`Content-Type: text/html`、
   `kitepon.dev / Lattice`の帰属、`noindex, nofollow`、一覧とkitepon.devへの戻り先を返す。
3. 同じURLへ`Accept: application/json`を付けると、HTTP 404と既存の
   `lattice.todo_gantt_http_error.v1` JSONを返す。
4. npm latest、GitHub Release、source tagがすべて`v0.35.0`へ揃う。

GitHub Releaseは
[`v0.35.0`](https://github.com/kitepon-rgb/Lattice/releases/tag/v0.35.0)。

## 2026-08-10 v0.53.0・bridge hub配備（サーバー側手順1〜6）

`docs/plan_bridge-hub.md`の設計どおり、配信元を単一Mac固定から複数端末を集約するhubへ切り替える
配備を開始した。本節はサーバー側手順（1〜6、bellがH操作として実行）の記録。Mac側手順（7〜8、
逆トンネル退役とbridge reconfigure）はオーナー実施待ちで別途追記する。

### 変更後の配備構成（サーバー側のみ完了、Mac側は移行中）

```
Cloudflare Tunnel → Docker Caddy → hub（192.168.1.2常駐、systemd）→ 各端末のbridge
```

- hub: `192.168.1.2`にsystemd unit `lattice-hub.service`として常駐（`User=kite`、
  `Restart=on-failure`）。`@quolu/lattice@0.53.0`の`bin/lattice-hub.mjs`。
- **listen port: `53943`。** 申請時の想定`53940`は同一host `172.18.0.1`で稼働中の別サービス
  （spotter dashboard）と衝突するため、配備直前の偵察で発見し変更した。今後この構成に触れる時は
  `53943`を正とする（room内の初期申請に残る`53940`は訂正済みの旧案）。
- `LATTICE_HUB_LISTEN=172.18.0.1`（Docker bridge gateway。Caddy containerからは`127.0.0.1`へ
  直接到達できないため、既存bridgeと同じgateway経由の構成）。
- `LATTICE_HUB_ALLOWED_HOSTS=lattice.kitepon.dev`。
- ufw: `172.18.0.1:53943`へのcontainer→host許可を追加（既存`53939`ルールと対）。
- Caddy upstream: `172.18.0.1:53939` → `172.18.0.1:53943`へ差替、`caddy validate`後`caddy reload`。

### 受入結果（サーバー側6手順）

1. `172.18.0.1:53943/projects/`へHost付きcurlがHTTP 200（Docker/Caddy host上）。
2. Caddy container内から同endpointがHTTP 200。
3. `https://lattice.kitepon.dev/`が公開HTTPSでHTTP 200。
4. `https://lattice.kitepon.dev/projects/`がHTTP 200、端末が未登録のため空一覧
   （fail-closed設計どおり——黙って旧配信元を出し続けない）。

### 既知の罠への追補

- **H申請の事前確認漏れ**: 対象portの実況（既存listenerとの衝突）確認をH操作申請の手順へ
  含めていなかった。今後192.168.1.2上へ新規サービスを追加するH操作では、対象portが
  空いていることを申請段階で確認する手順を含める。
- Mac側手順（7: `lattice bridge reconfigure --listen <Mac LAN IP> --port auto --dashboard
  --hub http://192.168.1.2:53943 --allow-host lattice.kitepon.dev --json`、8: 逆トンネル
  LaunchAgent `dev.kitepon.lattice.bridge-tunnel`の退役）はMac端末が必要なためオーナー実施待ち。
- Windows端末（ChromeBlocker）のbridge常駐はbh6の範囲。WSL2はLANから到達不能なため、
  bridgeはWindows native側で常駐させる必要がある（plan既知の罠「Windows端末の常駐」）。
