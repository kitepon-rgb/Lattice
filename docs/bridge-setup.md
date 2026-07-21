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
