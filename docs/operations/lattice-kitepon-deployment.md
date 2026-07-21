# lattice.kitepon.dev 配備記録

2026-07-21 に、Lattice dashboardを既存のDocker Caddyとremote-managed Cloudflare Tunnel経由で公開した。
Cloudflare管理APIの資格情報はリポジトリへ置かず、operator共通の
`~/.config/cloudflare-api.env`（mode 0600）から読み込む。Tunnel実行tokenを設定APIには使用しない。

## 配備構成

- Mac bridge: `192.168.1.102:53939`
- Docker/Caddy host: `192.168.1.2`
- Public hostname: `lattice.kitepon.dev`
- Tunnel origin: `https://caddy:443`
- Origin request: `Match SNI to Host`を有効化

既存TunnelのIngressは保持し、catch-all 404の直前へLattice用ruleだけを追加した。DNSは同じTunnelを指す
proxied CNAMEとし、Caddy側は`lattice.kitepon.dev`をMac bridgeへreverse proxyする。

## 受入結果

次のgateを順番に確認した。

1. `192.168.1.2`からMac bridgeへ許可Host付きでアクセスし、project一覧がHTTP 200。
2. Docker CaddyへHTTPSでアクセスし、project一覧がHTTP/2 200。
3. Cloudflare公開HTTPSを別hostの通常DNS resolverから取得し、project一覧がHTTP 200。
4. `/projects/lattice/`がHTTP 200で、HTML titleが`Lattice — Lattice 依存工程図`。
5. `/projects/lattice/events`が接続直後に`event: state`と現在の`head_digest`を返す。

公開URLは `https://lattice.kitepon.dev/projects/lattice/`。
