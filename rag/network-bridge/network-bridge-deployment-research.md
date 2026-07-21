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

途中状態を成功扱いしない。LAN bridge 200、Caddy経由HTTP/2 200、Cloudflare DNS／Tunnel経由HTTPS 200は
別々のgateであり、最後のpublic hostnameが未設定なら「Caddyまで完了、外部公開は未完了」と明示する。
