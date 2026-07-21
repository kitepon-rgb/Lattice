# Caddy reverse proxy／validate／reload — 取得記録

- 出典: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- 出典: https://caddyserver.com/docs/command-line
- 取得日: 2026-07-21
- 取得方法: Caddy公式ドキュメントをWeb検索・閲覧し、必要な契約だけを要約した。
- 確度: 高（Caddy公式ドキュメント）

`reverse_proxy`は受信したmethodとURIを既定で維持して上流へ転送する。上流をLAN内HTTPで指定でき、
長時間応答では`flush_interval -1`によりbufferingを抑制できる。

設定変更は、構文adaptだけでなくmodule provisionまで行う`caddy validate`で検査する。productionでは
process停止・再起動ではなく`caddy reload`によるgracefulな設定反映が推奨される。

本件ではDockerの単一ファイルbind mountを使うため、別途Caveatにあるinode固定の罠も適用する。
ホスト側Caddyfileはrename置換せずinodeを維持して更新し、コンテナ内の同一mountからvalidateとreloadを行う。
