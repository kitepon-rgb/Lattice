# plan_bridge-hub — 公開工程表の多端末化（サーバ常駐ブリッジ装置）

- 状態: 設計裁定済み（オーナー 2026-08-10）・円卓で実装進行中（room `lattice`・bridge-hub 卓 2026-08-10 開始。進捗の正本は store と room ログ）
- レーン: 統括（複数repo/面の書込調整: Lattice repo・192.168.1.2 配備・Mac/Windows 端末配線）
- 工程正本: Lattice store（本repo）plan_key `bridge-hub` v1（2026-08-10 todo migrate 済み。task・依存・状態は store だけが持つ）

## Context — なぜやるか

`lattice.kitepon.dev` の公開工程表は、オーナーの設計構想では「各開発端末がサーバへ登録した時点で、その端末の工程表が表示される」ものである。しかし現実装は
`Cloudflare Tunnel → Caddy → ssh逆トンネル受け口(172.18.0.1:53939) → Macのloopback bridge`
という **1枠占有構造**で、配信元は常に1台（現在Mac）に固定される。Windows端末で作った plan（例: ChromeBlocker）は公開面に出られない。オーナーはこれを「設計指示したのに実装されていない」コアプロダクトの不具合と裁定した（2026-08-10）。

実測根拠（2026-08-10 Windows端末から確認）:
- 192.168.1.2 の `/home/kite/license-server/Caddyfile` は `lattice.kitepon.dev → reverse_proxy 172.18.0.1:53939` の単一上流。
- `172.18.0.1:53939` の listen 保持者は `sshd-session`（= Macが張る逆トンネル）。サーバ上に Lattice 常駐プロセスは無い。
- `bridge-server.mjs` は単一 upstream の逆プロキシで集約機能なし。`todo-dashboard-registry.mjs` の登録簿 entry は `repo_root` がローカル絶対パス必須で、リモート概念が無い。
- registrar（`bridge-registrar.mjs`）は「1つのリテラル上流を自分へ書き換える」機構であり、端末の追加はできない。

## 設計（オーナー裁定済みの方向）

```
Cloudflare Tunnel → Caddy → hub（192.168.1.2 常駐・新規）→ 各開発端末の bridge
```

1. **hub（ブリッジ装置）**: 192.168.1.2 に常駐する Lattice の新コンポーネント。端末登録簿を持ち、`/projects/` は全端末の合成一覧、`/projects/<id>/*`（events SSE 含む）は所有端末の bridge へ中継する。
2. **端末**: 既存の `lattice bridge`（LAN listen は実装済み）を立て、hub へ「自分の到達先 + 担当 project 一覧」を登録し heartbeat で更新する。アドレスは登録接続の送信元から導出（registrar の既存安全思想: 端末は自分しか登録できない）。
3. **Caddy**: 上流を hub の固定 endpoint へ1回差し替えたら以後不変。ssh 逆トンネルと Mac の LaunchAgent は退役。
4. **fail-closed**: 端末オフライン時は該当 project を「配信元オフライン」と明示表示。黙って消さない・staleを新鮮に見せない。
5. **project_id 衝突**: 複数端末が同一 project_id を主張したら、既存 `dashboard adopt` と同型の明示採用で解決。自動勝ち抜きはしない。

## 非目標

- 工程データの中央複製・キャッシュ正本化（正本は各端末の store のまま。hub は登録簿と中継だけ）
- 認証つき公開・編集操作の公開（現行どおり閲覧のみ）
- WAN 越し端末の参加（現行は同一 LAN + ssh 到達を前提。将来課題）
- dashboard renderer / gantt UI の変更

## 既知の罠

- **SSE 中継**: `/events` は `Content-Type: text/event-stream`・接続直後の `event: state`・再接続時の初回 state 再送が受入契約（bridge-setup.md の外部gate）。hub の中継は flush を殺さないこと（Caddy 側は `flush_interval -1` 済み）。
- **Host 検査**: bridge は許可 Host 以外に 421 を返す（DNS rebinding 対策）。hub→端末の中継 request が正しい Host を運ぶ設計にする。
- **DHCP**: 端末アドレスは lease で動く。heartbeat 由来の登録簿更新で追従し、リテラルを設定ファイルへ焼かない。
- **Windows 端末の常駐**: LaunchAgent は無い。タスクスケジューラ or サービス登録の配線を端末配線 ToDo に含める。
- **daemon の版持ち**: 常駐 process は起動時 module を保持し続ける（AGENTS.md 実被弾）。hub/bridge の更新手順に再起動を含める。
- **プロセス生死の記録**: ADR 0157（1枚 file で生死を持たない・全 process が通る一点で掃除）に従う。
- **Control Record CLI は Windows で PLATFORM_UNVERIFIED fail-closed**（control-record.md v1）。本戦役の Control 儀式は Mac 端末で行うか、docs plan + git 履歴 + gate evidence を証跡とする（degraded を明記して進める。無言のスキップ禁止）。

## F/A/H と配置（統括ゲート宣言）

- **F（統括直裁）**: hub の登録プロトコル設計（公開契約）、Caddy 上流差し替え（本番操作）、逆トンネル退役（本番操作）、project_id 衝突規約。
- **A（委譲可の物量）**: hub server 実装・端末 heartbeat 実装・テスト（仕様固定後、implementer/sonnet 級へ委譲可。model/effort は毎回明示）。
- **H（オーナー承認必須）**: 192.168.1.2 への配備・Caddy 変更・Mac 側 LaunchAgent 退役・Lattice repo の push。
- 並列検討の結論: 実装 Phase の hub 実装と端末配線は非交差（src 新規 vs 配備スクリプト）だが、本repo単一書込のため直列で足りる。fan-out は監査 Phase の Find のみ。

## 受入条件（Phase gate）

1. **設計固定**: 登録プロトコル（登録・heartbeat・失効・衝突）の契約文書と characterization テストが green。
2. **hub 単体**: ローカルで hub + 疑似端末2台を立て、合成 `/projects/`・project別中継・SSE 初回 state・オフライン明示表示が focused test で green。
3. **配備**: 192.168.1.2 で hub 常駐（H承認後）。Caddy 差し替え後、bridge-setup.md の3独立gate（LAN・Caddy・Cloudflare public HTTPS）+ `/events` 継続・再接続 gate を通す。
4. **多端末実証**: Mac と Windows の両端末が同時に登録され、`https://lattice.kitepon.dev/` に kikoeru（Mac）と ChromeBlocker（Windows）が**同時に**表示される。片方を落とすとオフライン明示になる。
5. 還流: 配備記録を docs/operations/ へ、罠を caveat へ、本 plan を archive へ。

## 暫定チェックリスト（todo migrate までの仮置き。store 導入後はこの節を削除し store が正本）

- bh1-protocol: hub 登録プロトコル契約の設計文書（F）（完了・工程正本はLattice store）
- bh2-hub-server: hub server 実装（登録簿・合成一覧・中継・SSE）+ focused tests（完了・工程正本はLattice store）
- bh3-terminal-heartbeat: 端末 bridge の hub 登録・heartbeat 実装 + focused tests（完了・工程正本はLattice store）
- bh4-integration-test: 疑似2端末の統合テスト（受入2）（完了・工程正本はLattice store）
- bh5-deploy: オーナー裁定2026-08-10で打ち切り。工程から除外し再開しない
- bh6-multi-terminal-proof: オーナー裁定2026-08-10で打ち切り。工程から除外し再開しない
- bh7-knowledge-return: オーナー裁定2026-08-10で打ち切り。工程から除外し再開しない
（工程・ToDo は Lattice store `bridge-hub` v1 が唯一の正本。本書は目的・思想・判断理由・非目標・受入条件だけを所有する）
