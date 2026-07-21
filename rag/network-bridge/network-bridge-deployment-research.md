# Lattice network bridge配備の根拠

- 更新日: 2026-07-21
- 確度: 公式仕様は高。対象環境の到達性・Caddy反映は実測済み。Cloudflare public hostnameは設定完了後に再検証する。
- sources: [[raw/caddy-reverse-proxy-reload-source-record]], [[raw/cloudflare-tunnel-published-application-source-record]]

Lattice bridgeはユーザーが明示的に有効化したMac上の高番portだけをlistenし、Host allowlistで公開hostnameを
限定する。サーバー側は既存のDocker復旧境界を崩さず、Cloudflare TunnelからDocker Caddyへ入り、Caddyが
LAN上のMac bridgeへHTTP reverse proxyする。

配備順序は、bridgeのproject一覧をLAN越しに確認し、Caddyfileを復元可能なbackup付きでinode維持更新し、
container内validate成功後だけgraceful reloadする。その後、Cloudflareのremote-managed Tunnelへpublic
hostnameを追加し、外部HTTPSからproject一覧とproject別工程表を確認する。

remote-managed routeはpublic hostname `lattice.kitepon.dev`から`https://caddy:443`へ接続し、TLSの
Origin Server Nameを`lattice.kitepon.dev`へ固定する（同等の`Match SNI to Host`でもよい）。
`http://caddy:80`はCaddyのHTTPS redirectを公開URLへ返すため選択しない。外部gateはredirect追従を無効にし、
最初のHTTPS応答が200であることを要求する。

途中状態を成功扱いしない。LAN bridge 200、Caddy経由HTTP/2 200、Cloudflare DNS／Tunnel経由HTTPS 200は
別々のgateであり、最後のpublic hostnameが未設定なら「Caddyまで完了、外部公開は未完了」と明示する。
外部HTTPS gateは、`/projects/`の一覧、`/projects/<project_id>/`の200とproject別title、
`/projects/<project_id>/events`の200かつ`text/event-stream`を一組で検査する。SSEは接続直後の`state`、
接続中にheadが変わった時の次の`state`、切断・再接続後の最新`state`が通ることを必要条件とし、単発のHTTP 200で
streaming成功を代用しない。
