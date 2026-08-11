# Optional network bridge

Latticeのproject dashboardは既定でloopbackだけにbindし、bridge用socketや設定を作らない。
LAN上のreverse proxyなどから閲覧する時だけ、利用者がlisten IPを明示してbridgeを有効化する。
`postinstall`では質問やnetwork公開を行わない。

TTYでは`lattice bridge setup`で安全側既定の対話wizardを開始できる。最初の公開確認は既定で無効を選び、
cancelした場合は設定を変更しない。非TTYではhangせず、次の非対話commandを案内する。
portを省略するか`auto`にすると、49152–65535から候補を重複なく選び、
実際のexclusive bindとhealth確認に成功したportだけを保存する。

```bash
lattice bridge setup --listen 192.168.1.50 --port auto --dashboard --allow-host lattice.example.com --json
```

`--dashboard`は現在のlocal dashboard descriptorをrequestごとに解決するため、dashboard再起動でportが変わっても
bridge設定はstaleにならない。固定upstreamを使う場合だけ`--upstream http://127.0.0.1:4318`を指定する。
listen IPは常に許可Hostへ入り、reverse proxyで公開するhostnameは`--allow-host`を反復して追加する。
許可されていないHostは421となるため、DNS rebinding originへ工程情報を返さない。

```bash
lattice bridge status --json
lattice bridge reconfigure --listen 192.168.1.50 --port auto --dashboard --json
lattice bridge disable --json
```

設定は`~/.lattice/bridge.json`へmode 0600でatomic保存する。`setup`／`reconfigure`は実bridge daemonが
選択socketをexclusive bindしhealthを返すまで成功にしない。起動に失敗した場合は旧設定へ戻す。
`disable`もbridge socketの停止確認後に成功し、loopbackのlocal dashboardは停止しない。
configまたはdaemon descriptorが壊れている場合、`disable`は公開socketのfail-closed停止を優先して破損control
fileを除去し、JSON結果の`recovery`へ処置を明示する。その後は`setup`で再設定できる。

自動化・隔離testではabsoluteな`LATTICE_CONFIG_DIR`で設定rootを変更できる。無効な設定、低いport、
使用中の明示port、危険なrequest target、到達不能upstreamはsilent fallbackせずtyped errorを返す。

## 常駐が黙って死んでいないか確かめる

`reachable`は「設定したaddressで誰かが応答しているか」しか答えない。常駐設定（macOSのLaunchAgent、
WindowsのStartup launcher）が消えたbinaryを指していると、supervisorは起動できないprocessを回し続け、
どこにもエラーが出ないまま公開面から端末だけが消える。`status`はそれを1回で名指しする。

```bash
lattice bridge status --json
```

bridgeが無効な間は以下すべてnullで、bridgeを有効にしている時だけ観測する。

**`persistence`** — 常駐設定が実際に起動する対象。

| field | 意味 |
| --- | --- |
| `state` | `installed`／`not_installed`／`unreadable` |
| `loaded` | launchdへ読み込み済みか。Windowsには対応概念が無いのでnull |
| `node_path`・`node_exists` | 起動するNode実行体と、それが今も存在するか |
| `bridge_path`・`bridge_exists` | 起動するbridge scriptと、それが今も存在するか |
| `error` | `unreadable`のときだけtyped code（例`BRIDGE_LAUNCH_AGENT_PLIST_UNSAFE`） |

**`runtime`** — いま応答しているprocess自身の申告。`state`は`running`／`not_running`／`unattested`／
`descriptor_invalid`で、`running`以外では各値がnullになる。`running`でも、identityを返さない
0.55.0より前のdaemonが走っている間は`version`以下がnullになる（この場合`runtime_drift`は空になり、
乖離の有無は判定できていない——「乖離なし」ではない）。

`reconfigure`直後は、identityの確認requestが400msで打ち切られるため一時的に`unattested`を返すことが
ある（daemonの起動直後と競合する）。数秒おいて引き直せば`running`になる。続くようなら本物の不整合で、
`reachable`がtrueでも公開面は認証できていない。

| field | 意味 |
| --- | --- |
| `pid` | 応答しているprocessのpid |
| `version` | そのprocessが読み込んでいるLatticeの版 |
| `node_path`・`node_version` | そのprocessを実行しているNodeの実体pathと版 |
| `bridge_path` | そのprocessが実行しているbridge script |

**`runtime_drift`** — 両者の食い違い。空配列は「差が無い」または「`runtime`が名乗っていないので
判定できない」のどちらかである。

| 値 | 意味 |
| --- | --- |
| `bridge_path` | 常駐設定と違うtreeのcodeが走っている（開発treeの残骸など） |
| `node_path` | 常駐設定が指すnodeと実走nodeが別実体。焼くのは意図的にaliasなので、比較はrealpathで行う |
| `version` | npm更新後まだ旧moduleを保持している |

**`remedy`** — 自己解消しない状態にだけ、打つべきコマンドが入る。出るのは次の4つ。

- `persistence.node_exists`または`bridge_exists`がfalse（起動対象が消えた）
- `persistence.state`が`not_installed`（bridgeは有効なのに常駐設定が無い。いま走っているdaemonが
  最後の1つで、再起動しても戻らない）
- `persistence.state`が`unreadable`（常駐設定を読めない）
- `runtime_drift`に`node_path`または`bridge_path`がある

`version`だけの差には`remedy`を出さない。daemonは60秒ごとにon-diskのpackage.jsonと自分の版を
突き合わせ、差があれば自ら終了してsupervisorに新codeで起動し直させる。放っておいて最大1分ほどで
解消するので、コマンドを出す状態ではない。自己解消する差にコマンドを出すと、本物の障害が埋もれる。

`remedy`が出たら`reconfigure`で作り直す。plistやlauncherを手で書き換えない。

```bash
lattice bridge reconfigure --json
```

### 公開面から自分のprojectが消えた時（`last_heartbeat`）

hubへ繋いでいる端末では、`runtime.last_heartbeat`が最後にhubへ名乗った結果を持つ。公開一覧で
自分のprojectがofflineになっている時、原因が端末側か配線側かはここで分かれる。

| `state` | 意味 | 打つ手 |
| --- | --- | --- |
| `accepted` | 全件受理された。公開面に出ていないならhub側の可視性設定を見る | — |
| `partial` | 一部が他の生きた端末に所有されている。`rejected_projects`が名指しする | 意図した端末なら放置。奪うなら`adopt` |
| `rejected` | hubがrequest全体を拒否した。`detail`にtyped code | detailのcodeで分岐 |
| `unreachable` | hubへ届かない。配線かhubの停止 | hubのURLと生死を確認 |
| `skipped_no_projects` | 配信しているprojectが0件。名乗るものが無い | 正常な静止。公開したいならそのrepoで作業する |
| `skipped_no_dashboard` | dashboard daemonを観測できない。配信そのものが立っていない | daemonの生死を見る。`todo`系commandを1回打てば起動する |
| `null` | hub未設定、またはまだ1回も送っていない | — |

名乗る集合はdaemonが実際に配信している集合そのもの（ADR 0165）。登録簿の`last_seen_at`が古い
ことは露出に影響しない——**人がCLIを叩かなくなっただけで公開面から消えることはない**。

### 焼き込むnode pathの選び方（ADR 0163）

常駐設定へ焼くnodeのpathは、版付きの実体（homebrewの`Cellar/node/<version>/bin/node`、nvm-windowsの
版ディレクトリ）ではなく、**同じbinaryを指すとrealpathで検証できた安定alias**（`/opt/homebrew/bin/node`、
`C:\Program Files\nodejs\node.exe`）を選ぶ。`brew upgrade node`が旧versionのディレクトリごと消しても
起動対象が残るようにするためである。

安定aliasを検証できない環境（shim方式のasdf／volta等。shimは自身のlauncherへ解決されるので実体と
一致しない）では、版付きpathのまま焼く。検証していないpathを推測で焼けば別のnodeでdaemonが起動して
しまうためで、そこでの防御は起動継続ではなく`node_exists`による消滅の可視化である。

> **0.55.0より前に設定した常駐は自動では移行しない。** 焼き直しは`reconfigure`を実行した時にだけ
> 起きるので、Latticeを更新しただけの端末は版付きpathを抱えたままになる。更新後に各端末で
> `lattice bridge reconfigure --json`を1回打つ。現在どちらを焼いているかは`persistence.node_path`で読める。

なお`setup`／`reconfigure`をnode_modules配下でない実体（開発tree）から実行すると、結果の`warnings`へ
`BRIDGE_PERSISTED_FROM_DEVELOPMENT_TREE`が入る（該当しなければ空配列）。そのtreeを動かすと常駐が
止まり、`npm`更新も反映されない。開発treeから常駐させること自体は正当な操作なので拒否はしない。

## listen IPがDHCPで動く場合

設定したlisten IPがホストから消えると、古いsocketは死んだアドレスへ取り残され、LANから到達できなくなる。
daemonは各reconcileで実効アドレスを解決し直し、同一subnet（IPv4 /24、IPv6 /64）に生きたアドレスがあれば
そこへbindし直す。VPNや別NICなど異なるnetworkのアドレスは採用せず、候補が無ければ
`BRIDGE_LISTEN_ADDRESS_ABSENT`で公開socketをfail-closedにする。再bind先は許可Hostへ自動で加わる。

`LATTICE_BRIDGE_REGISTRAR_SSH_HOST`と`LATTICE_BRIDGE_REGISTRAR_SCRIPT`を両方設定すると、新しいbindingを
張るたびに`ssh <host> <script> <port>`でreverse proxy hostへ自己登録する。アドレスは送らず、remote側が
ssh送信元から決めるため、各hostは自分自身しか登録できない。登録の失敗はbridgeを落とさずstderrへ
typedに報告する。この配線が無いと、Caddy等が持つリテラルはlease変更のたびに黙って陳腐化する。

## reverse proxyへ逆トンネルで繋ぐ（LAN bindを使わない）

reverse proxy hostへsshで到達できるなら、LANへbindせずloopbackだけで公開できる。bridgeが動くhostから
接続しに行くため、そのhostのLAN addressはreverse proxyのどこにも現れず、追従も自己登録も不要になる。

```bash
lattice bridge setup --listen 127.0.0.1 --port 53939 --dashboard --allow-host lattice.example.com --json
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -R 172.18.0.1:53939:127.0.0.1:53939 proxy-host
```

reverse proxyはこの固定endpointだけを見る。転送口のbind先は、reverse proxyが到達できるaddressにする。
Docker上のreverse proxyでは、containerの`127.0.0.1`はcontainer自身のloopbackでありhostのそれではないため、
hostのloopbackへ開いた口には届かない。対象networkのgateway（`docker network inspect`の`Gateway`）へbindする。

sshdは既定の`GatewayPorts no`だと`127.0.0.1`にしかbindできない。`clientspecified`にすると、clientが明示した
addressだけにbindする（`yes`と違い全interfaceへは晒さない）。host firewallがINPUTをDROPしている場合は、
その1 portだけを許可する。`ExitOnForwardFailure=yes`は、転送口を開けないまま接続だけ生かす状態を防ぐ。
常駐はprocess supervisorのKeepAliveに任せ、切断時は張り直す。

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

公開viewerの404も、ブラウザとAPIの両契約を別々に確認する。未知URLへ`Accept: text/html`を
付けたrequestはHTTP 404かつ`Content-Type: text/html`で、`noindex, nofollow`と
`/projects/`、`https://kitepon.dev/`への戻り先を持つ。`Accept: application/json`では
HTTP 404かつ`Content-Type: application/json`で、既存の
`lattice.todo_gantt_http_error.v1`を返す。

```bash
curl --silent --show-error --include --header 'Accept: text/html' \
  https://lattice.kitepon.dev/unknown
curl --silent --show-error --include --header 'Accept: application/json' \
  https://lattice.kitepon.dev/unknown
```

外部gateはHTMLだけで閉じず、各projectの
`https://lattice.kitepon.dev/projects/<project_id>/events`も確認する。応答は200かつ
`Content-Type: text/event-stream`で、接続直後に`event: state`と現在の`head_digest`を返さなければならない。
接続を開いたまま正規のTodo更新を行い、新しい`state`が同じstreamへ届くことを確認する。切断後に再接続しても
再び初回`state`が届き、そのdigestが最新headと一致することまでを継続・再接続gateとする。

```bash
curl --fail --show-error --include --no-buffer --max-time 15 \
  https://lattice.kitepon.dev/projects/PROJECT_ID/events
```
