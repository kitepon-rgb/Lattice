# ADR 0162 — bridge hubの端末登録プロトコル

- Status: Accepted
- Date: 2026-08-10
- Extends: [plan_bridge-hub.md](../plan_bridge-hub.md)（本戦役の設計裁定文書）
- Preserves: `src/bridge-registrar.mjs`（送信元アドレス導出の安全思想）、
  `src/todo-dashboard-registry.mjs`（project_id衝突とadoptの型）

## Context

公開工程表は現在、Cloudflare Tunnel → Caddy → sshの逆トンネル → Macのloopback bridge、という
1枠占有構造で配信元が常に1台に固定される。オーナー裁定（2026-08-10）により、
`Cloudflare Tunnel → Caddy → hub（192.168.1.2常駐）→ 各端末のbridge`という多端末配線へ変える。
hubは端末登録簿を持ち、`/projects/`は全端末の合成一覧、`/projects/<id>/*`は所有端末のbridgeへ中継する。

本ADRは受入条件の第1段「設計固定」——登録・heartbeat・失効・衝突のプロトコル契約——だけを扱う。
hub server実装（bh2）・端末heartbeat実装（bh3）・配備（bh5）は別task。

## Decision

1. **契約schema**は`lattice.bridge_hub_registration_request.v1`（端末→hub）、
   `lattice.bridge_hub_registry_entry.v1`（hub内部の1project分の経路情報）、
   `lattice.bridge_hub_registration_result.v1`（応答）、
   `lattice.bridge_hub_registry_projection_entry.v1`（`/projects/`一覧の投影）の4つ。
   実装は`src/bridge-hub-protocol.mjs`が持つ。
2. **登録簿はproject_idで引く。** hubは`/projects/<id>/*`をproject単位で中継するため、registryの
   1entryは1projectの経路（`terminal_id`・`address`・`port`）を持つ。1端末が複数projectを持てば、
   同じterminal_id/address/portを共有する複数entryとして現れる。
3. **requestはaddressを運ばない。** `address`はrequest schemaのkeyに含めず、呼出側
   （将来のhub HTTPサーバ）が実際の接続元から渡す`remoteAddress`だけをentryのaddressへ採用する。
   `bridge-registrar.mjs`が確立した「端末は自分自身しか登録できない」安全思想をそのまま継承する。
4. **登録は都度、その端末の完全な現在状態を宣言する。** `applyBridgeHubRegistration`は呼び出しごとに、
   その`terminal_id`が以前所有していたentryを全部落としてから`project_ids`で再構築する。前回は
   持っていたが今回のlistに無いprojectは解放される——専用の「登録解除」verbは無い。heartbeatが
   届かなくなったまま停止する場合の扱いは失効（既定4）が持つ。バッチは全部成立するか全部失敗するかで、
   一部だけ書いて残りを拒否することはない。
5. **project_id衝突はadoptで明示的に解決する。** 要求したproject_idのどれかが別のterminal_idに
   既に属していて、かつ`adopt`にその名前が無ければ、リクエスト全体を`BRIDGE_HUB_PROJECT_CONFLICT`で
   拒否する。衝突は1件ずつ止めず全部集めて返す。`adopt`に明示された名前だけ所有者が移り、
   同じ端末の他のprojectには触れない。自動勝ち抜きは無い——`todo-dashboard-registry.mjs`の
   `PROJECT_ROOT_CONFLICT`/`adopt`と同型。
6. **失効は読み出し時にしか存在しない。** `projectBridgeHubRegistry`は`last_seen_at`が
   `BRIDGE_HUB_HEARTBEAT_TTL_MS`（既定90秒。推奨heartbeat間隔`BRIDGE_HUB_HEARTBEAT_INTERVAL_MS`は
   既定30秒）を超えたentryを`status: 'offline'`と投影するだけで、登録簿から一切削除しない。
   plan既定「端末オフライン時は該当projectを配信元オフラインと明示表示。黙って消さない・staleを
   新鮮に見せない」を、削除経路そのものを持たないことで満たす。この2定数はwire契約の外にあり、
   hub側の運用チューニングとしてプロトコルversionを上げずに変更できる。
7. **モジュールは純粋関数である。** `applyBridgeHubRegistration`・`projectBridgeHubRegistry`は
   ソケット・時計・ディスクを一切読み書きしない（`now`・`remoteAddress`は呼出側が渡す）。
   I/O・永続化・ロック・HTTPルーティングはbh2（hub server）が別途構築する。

## 非目標

- hub serverのHTTP実装、永続化フォーマット、`/events` SSE中継——bh2/bh4の範囲。
- 端末側のheartbeat送信ループ・`lattice bridge`への配線——bh3の範囲。
- 192.168.1.2への配備・Caddy差し替え・逆トンネル退役——H操作、bh5の範囲。
- Host検査・DNS rebinding対策——既存の`bridge-server.mjs`の`validatedRequestHost`をhubの
  中継経路にも適用する設計はbh2が引き継ぐ。本ADRは登録プロトコルだけを固定する。

## Consequences

- bh2（hub server実装）とbh3（端末heartbeat実装）は、この契約に対して実装するだけでよく、
  衝突・失効・full-state reconciliationの意味論を再発明しない。
- `test/bridge-hub-protocol.test.mjs`が12件のcharacterizationテストで固定: 妥当なrequestの受理、
  addressフィールド拒否、heartbeatによるregistered_at保持、projectの解放、衝突の一括拒否と
  registry不変性、adoptによる部分的所有権移転、複数衝突の一括報告、壊れたregistry/nowの拒否、
  TTL内外のonline/offline投影とentry非削除、カスタムttlMs。`node --test
  test/bridge-hub-protocol.test.mjs`で12/12 green。
- 実装がHTTPを話し始める段階（bh2）で、`address`をrequest bodyからではなく接続そのものから
  取ることを強制される——バリデータがaddressフィールドを許さないため、実装ミスで
  クライアント詐称を許す経路が構造的に塞がれている。
