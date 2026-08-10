# bh4-integration-test — 疑似2端末の統合テスト（受入条件2）

## 作ったもの

- `test/bridge-hub-integration.test.mjs`（新規3件）: bh2の単体testでは組み合わせて
  いない振る舞いだけを対象にした。実LAN・実Caddyには依存せずloopback上の疑似端末で完結する。
  1. **疑似端末2台が同時に登録された状態で片方だけheartbeatが途絶える**:
     `now`をtest側で操作できるよう`startBridgeHubServer`へ注入し、`ttlMs`を短くして
     片方だけ再heartbeatさせもう片方は放置する。合成`/projects/`が両方の状態を
     **同時に**（一方だけの単発testではなく）正しく出すこと、online側は200で
     中継、offline側は503+`BRIDGE_HUB_PROJECT_OFFLINE`で拒否されることを確認した。
     bh2のTTL testは端末1台だけの単発だったため、複数端末が混在した状態での
     差分投影はこのtaskで初めて検証した。
  2. **SSEは新しい接続のたびに初回stateを即座に送る**: plan_bridge-hub.mdの既知の罠
     「再接続時の初回 state 再送」を検証する。疑似端末を2回連続でfetchし、
     それぞれが独立した`event: state`を即座に受け取ることを確認した。hubの
     proxyはconnection単位の状態を持たないstream中継なので、これは新規実装ではなく
     既存proxy実装（`.pipe()`ストリーミング）の振る舞いの確認である。
  3. **heartbeatはonlineのまま端末processが実際に停止している場合**: ADR 0162の
     失効判定はheartbeat途絶のTTLだけを見る仕様であり、process生死そのものは
     見ない。registryが`online`のままでも、実際に接続を試みたproxyが
     `ECONNREFUSED`を502 `BRIDGE_HUB_UPSTREAM_REFUSED`として明示することを確認し、
     「heartbeatの隙間で死んだ端末」がhangやHTMLエラーで露出しないことを示した。

## 実装への変更

- なし。3件とも既存のbh1/bh2実装（`applyBridgeHubRegistration`・`projectBridgeHubRegistry`・
  `startBridgeHubServer`）に対する追加のcharacterization testであり、
  実装側の欠陥は見つからなかった。

## 検証

- `node --test test/bridge-hub-integration.test.mjs`: 3/3 green。
- `node --test test/bridge-hub-server.test.mjs test/bridge-hub-integration.test.mjs
  test/bridge-hub-protocol.test.mjs test/bridge-hub-heartbeat.test.mjs
  test/bridge-config.test.mjs test/bridge-cli.test.mjs`: 56/56 green。
- `node scripts/check-syntax.mjs`: red（1/154）だが`src/todo-store.mjs:1066`の
  既知NULバイト（bh1/bh2/bh3のevidenceで既報告・自分の変更に無関係）のみ。
- `node scripts/verify-product-reachability.mjs`: green（101 product modules /
  undeclared_unreachable=[] / stale_declarations=[]）。新規fileは追加していないため
  宣言の変更なし。
- `node scripts/verify-cli-surface.mjs`: green（67 commands、undocumented/unexercised=[]）。
  CLI surfaceへの変更なし。
- `npm test`・`npm run ci`は実行していない（既知NULバイトによりcheck-syntaxが
  現HEADで赤いため、full run baselineとして意味を持たない。bh1〜bh3のevidenceと同じ判断）。

## plan受入条件2との対応

`plan_bridge-hub.md`「hub 単体: ローカルで hub + 疑似端末2台を立て、合成 `/projects/`・
project別中継・SSE 初回 state・オフライン明示表示が focused test で green」を、
bh2の単体test（7件、疑似2端末登録・合成一覧・project別中継・SSE非buffering・
421/404/503・file永続化）とこのtaskの3件（複数端末混在下の同時状態投影・
SSE再接続の初回state・端末死亡時のproxy劣化）で合わせて閉じたと判断する。

## commit対象

`test/bridge-hub-integration.test.mjs`（新規）・
`evidence/bridge-hub/bh4-integration-test.md`・`.lattice/todo/`のbh4-integration-test done化分。
