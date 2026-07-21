# Optional network bridge

Latticeのproject dashboardは既定でloopbackだけにbindし、bridge用socketや設定を作らない。
LAN上のreverse proxyなどから閲覧する時だけ、利用者がlisten IPを明示してbridgeを有効化する。
`postinstall`では質問やnetwork公開を行わない。

TTYでは`lattice bridge setup`で安全側既定の対話wizardを開始できる。最初の公開確認は既定で無効を選び、
cancelした場合は設定を変更しない。非TTYではhangせず、次の非対話commandを案内する。
portを省略するか`auto`にすると、49152–65535から候補を重複なく選び、
実際のexclusive bindとhealth確認に成功したportだけを保存する。

```bash
lattice bridge setup --listen 192.168.1.102 --port auto --dashboard --allow-host lattice.kitepon.dev --json
```

`--dashboard`は現在のlocal dashboard descriptorをrequestごとに解決するため、dashboard再起動でportが変わっても
bridge設定はstaleにならない。固定upstreamを使う場合だけ`--upstream http://127.0.0.1:4318`を指定する。
listen IPは常に許可Hostへ入り、reverse proxyで公開するhostnameは`--allow-host`を反復して追加する。
許可されていないHostは421となるため、DNS rebinding originへ工程情報を返さない。

```bash
lattice bridge status --json
lattice bridge reconfigure --listen 192.168.1.102 --port auto --dashboard --json
lattice bridge disable --json
```

設定は`~/.lattice/bridge.json`へmode 0600でatomic保存する。`setup`／`reconfigure`は実bridge daemonが
選択socketをexclusive bindしhealthを返すまで成功にしない。起動に失敗した場合は旧設定へ戻す。
`disable`もbridge socketの停止確認後に成功し、loopbackのlocal dashboardは停止しない。
configまたはdaemon descriptorが壊れている場合、`disable`は公開socketのfail-closed停止を優先して破損control
fileを除去し、JSON結果の`recovery`へ処置を明示する。その後は`setup`で再設定できる。

自動化・隔離testではabsoluteな`LATTICE_CONFIG_DIR`で設定rootを変更できる。無効な設定、低いport、
使用中の明示port、危険なrequest target、到達不能upstreamはsilent fallbackせずtyped errorを返す。

## Docker Caddy／Cloudflare Tunnelへ接続する

bridgeを有効化したMacとreverse proxy hostの間で、まず許可Hostを付けたLAN到達を確認する。
この段階が失敗している時はDNSやTunnelを追加しない。

```bash
curl --fail --header 'Host: lattice.example.com' \
  http://MAC_LAN_IP:BRIDGE_PORT/projects/
```

Caddyは既存のDocker networkと証明書運用を維持し、Lattice用siteだけを追加する。

```caddyfile
lattice.example.com {
	reverse_proxy MAC_LAN_IP:BRIDGE_PORT {
		flush_interval -1
	}
}
```

本番反映はcontainer内で`caddy validate`を通してから`caddy reload`する。Caddyfileを単一ファイルで
bind mountしている構成では、atomic renameでhost側fileを置換するとcontainerが旧inodeを参照し続ける。
更新前backupを残し、inodeを維持するin-place更新を使うか、directory bind mountへ変更する。

remote-managed Cloudflare Tunnelでは、Tunnel実行tokenを設定APIの代用にしない。Cloudflareの正規管理面で
public hostname `lattice.kitepon.dev` を次のoriginへ対応付ける。

- Service: `https://caddy:443`
- TLS Origin Server Name: `lattice.kitepon.dev`（管理面に同等の設定がある場合は`Match SNI to Host`でもよい）

`http://caddy:80`は選ばない。CaddyのHTTPからHTTPSへのredirectをTunnelがorigin応答として返す構成は、
外部requestが同じ公開URLへ戻るredirect loopになり得るためである。外部gateではredirectを追って200にせず、
最初の応答がHTTPSの200であることを確認する。

受入は次の3 gateを独立して記録し、後段の成功で前段を代用しない。

1. **LAN bridge**: reverse proxy hostから許可Host付きで`http://MAC_LAN_IP:BRIDGE_PORT/projects/`が200。
2. **Docker Caddy**: Caddyへ`Host: lattice.kitepon.dev`を付けたHTTPS requestが200。証明書検証を省略する
   内部probeを外部公開成功の証拠にはしない。
3. **Cloudflare public HTTPS**: `https://lattice.kitepon.dev/projects/`がredirectなしで200となり、一覧から開いた
   `/projects/<project_id>/`のHTML titleが`Lattice — <project名> 依存工程図`である。

外部gateはHTMLだけで閉じず、各projectの
`https://lattice.kitepon.dev/projects/<project_id>/events`も確認する。応答は200かつ
`Content-Type: text/event-stream`で、接続直後に`event: state`と現在の`head_digest`を返さなければならない。
接続を開いたまま正規のTodo更新を行い、新しい`state`が同じstreamへ届くことを確認する。切断後に再接続しても
再び初回`state`が届き、そのdigestが最新headと一致することまでを継続・再接続gateとする。

```bash
curl --fail --show-error --include --no-buffer --max-time 15 \
  https://lattice.kitepon.dev/projects/PROJECT_ID/events
```
