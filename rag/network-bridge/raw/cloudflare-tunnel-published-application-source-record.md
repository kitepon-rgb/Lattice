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
追加する。
