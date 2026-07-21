# Cloudflare Tunnel published application — 取得記録

- 出典: https://developers.cloudflare.com/tunnel/routing/
- 取得日: 2026-07-21
- 取得方法: Cloudflare公式ドキュメントをWeb検索・閲覧し、公開hostname経路の契約だけを要約した。
- 確度: 高（Cloudflare公式ドキュメント）

Cloudflare TunnelでWeb applicationを公開する時は、public hostnameをtunnelから到達可能なlocal serviceへ
対応付ける。Dashboardからrouteを追加した場合、hostnameからtunnel subdomainへのDNS recordもCloudflareが
作成する。公開経路はCloudflare edgeでCDN／WAF等を通った後、tunnelを経由してoriginへ到達する。

本件のcloudflaredはDocker内Caddyへ接続するremote-managed構成である。したがってLatticeの公開追加は、
既存cloudflared tokenを解析・転用せず、Cloudflareの正規管理画面でpublic hostnameを既存Caddy serviceへ
追加する。対象routeは次の値で固定する。

- public hostname: `lattice.kitepon.dev`
- service: `https://caddy:443`
- TLS origin name: `lattice.kitepon.dev`（管理面の同等機能として`Match SNI to Host`も可）

このCaddyはHTTPを同一hostnameのHTTPSへredirectするため、serviceを`http://caddy:80`にすると公開URLへ戻る
redirect loopを作り得る。外部受入ではredirect追従後の最終200を証拠にせず、最初のHTTPS応答が200であることを
検査する。Tunnel実行tokenや個人tokenはroute設定、取得記録、証拠へ記載しない。

公開routeの受入範囲は通常のHTMLだけではない。`/projects/`とproject別URLに加え、
`/projects/<project_id>/events`のSSEが`text/event-stream`を返し、接続直後の`state`、接続中の更新、
切断後の再接続時の最新`state`までCloudflare Tunnel越しに保持されることを検査する。
