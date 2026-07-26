# Lattice network bridge配備の根拠

- 更新日: 2026-07-26
- 確度: 公式仕様は高。対象環境の到達性・Caddy反映・逆トンネル経路は実測済み。
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

## reverse proxyがLAN addressを持つ構成の寿命（2026-07-26 実測）

上の構成はreverse proxyがbridge hostのLAN addressをリテラルで持つ。このリテラルはDHCPのlease変更で
黙って陳腐化し、公開siteが502になる。bridge processは健康なのでprocess supervisorは再起動せず、
古いsocketは存在しないaddressの上に残るため、`bridge status`も`enabled: true`を返し続ける。実際に
2026-07-25から翌朝まで誰にも気付かれず停止した。

追従機構（lease変更を検知して再bindし、reverse proxyへ自己登録する）を足せば直るが、追従が必要な依存
そのものを消す方が強い。bridge hostからreverse proxy hostへ`ssh -R`を常駐させ、reverse proxyは固定
endpointだけを見る形にすると、bridge hostのLAN addressは経路のどこにも現れない。bridgeはloopbackだけに
bindすれば足り、LANへ晒す面もなくなる。

この経路で実測した必要条件は3つある。

1. **sshdの`GatewayPorts`**。既定の`no`では`ssh -R`は`127.0.0.1`にしかbindできない。`clientspecified`に
   すると、clientが明示したaddressだけにbindする。`yes`は全interfaceへ晒すので選ばない。
2. **転送口のbind先**。reverse proxyがDocker container内にある場合、containerの`127.0.0.1`はcontainer
   自身のloopbackであり、hostのそれではない。hostのloopbackへ開いた口には届かないため、対象networkの
   gateway（`docker network inspect <net> --format '{{.Id}}'`のbridge、`Gateway`のaddress）へbindする。
   default bridgeの`172.17.0.1`とuser-defined networkのgatewayは別物で、後者を使う構成では前者を指定しても届かない。
3. **host firewall**。`ufw`のINPUT policyがDROPだと、containerからhost gatewayへの接続が落ちる。
   `allow in on br-<network id> to <gateway> port <port> proto tcp`で当該1 portだけ許可する。

切り分けでは、**hostからは200なのにcontainer内からだけtimeoutする**症状が3の指紋になる。1が未設定なら
そもそもhostからも繋がらないので、host→container の順で叩けば1と3を分離できる。

常駐には`ExitOnForwardFailure=yes`を付ける。転送口を開けないまま接続だけ生き続ける状態を防ぎ、
落としてsupervisorに張り直させる。`ServerAliveInterval`と併せると、経路が有線から無線へ替わっても復帰する。

## gate

途中状態を成功扱いしない。LAN bridge 200、Caddy経由HTTP/2 200、Cloudflare DNS／Tunnel経由HTTPS 200は
別々のgateであり、最後のpublic hostnameが未設定なら「Caddyまで完了、外部公開は未完了」と明示する。
外部HTTPS gateは、`/projects/`の一覧、`/projects/<project_id>/`の200とproject別title、
`/projects/<project_id>/events`の200かつ`text/event-stream`を一組で検査する。SSEは接続直後の`state`、
接続中にheadが変わった時の次の`state`、切断・再接続後の最新`state`が通ることを必要条件とし、単発のHTTP 200で
streaming成功を代用しない。
