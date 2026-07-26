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
