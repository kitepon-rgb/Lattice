# bh2-hub-server — hub HTTPサーバー本体の実装

## 作ったもの

- `src/bridge-hub-server.mjs`: hub本体。`src/bridge-hub-protocol.mjs`（bh1）の純粋関数
  （`applyBridgeHubRegistration`・`projectBridgeHubRegistry`）に、HTTPルーティング・
  ファイルベースの登録簿永続化・端末への逆プロキシを配線した。
  - `startBridgeHubServer({ registryStore, port, allowedHosts, env, fetchImpl, now, ttlMs })`:
    loopback（127.0.0.1）でHTTPサーバーを起動し `{ host, port, close() }` を返す。
  - `POST /__lattice/hub/register`: 端末の登録/heartbeat。ロック（in-process mutex）内で
    `registryStore.read()` → `applyBridgeHubRegistration` → `registryStore.write()` を行う。
    `BRIDGE_HUB_REGISTRATION_INVALID`→400、`BRIDGE_HUB_PROJECT_CONFLICT`→409
    （`body.detail.conflicts`同梱）、JSON parse失敗→400、`remoteAddress`は
    `incoming.socket.remoteAddress`から取得（bodyのfieldではない）。
  - `GET /projects/`: 合成一覧。`Accept: application/json`ならJSON配列、それ以外はHTML。
    公開する field は `project_id`・`display_name`・`status`・`last_seen_at` のみ
    （`terminal_id`・`address`・`port` は内部の経路情報として非公開——理由は後述）。
  - `* /projects/<project_id>/*`: 所有端末への逆プロキシ。未登録は404
    （`BRIDGE_HUB_PROJECT_NOT_FOUND`）、offline投影は503（`BRIDGE_HUB_PROJECT_OFFLINE`、
    メッセージに「オフライン」を明示）、両方ともtodo-gantt-live.mjsのnotFoundHtml流儀
    （`Accept: text/html`を明示しない限りJSON既定）でcontent-negotiationする。
    中継は`incomingResponse.pipe(response)`でストリームし、chunkをbufferingしない。
  - Host検査: `allowedHosts`（Set、正規化込み）に無いHostは421 `BRIDGE_HOST_NOT_ALLOWED`。
  - `readBridgeHubRegistry({env})` / `writeBridgeHubRegistry({env, entries})`:
    `env.LATTICE_HUB_RUNTIME_DIR`（既定 `~/.lattice/hub/`）配下の`terminals.json`への
    atomic rename・mode 0600・PID生存確認つきlock（todo-dashboard-registry.mjsの
    withLock/atomicJsonパターンを踏襲、ただし private関数なのでimportではなく同モジュール内に
    再実装）。`startBridgeHubServer`の`registryStore`未指定時のdefault実装として使う。
- `test/bridge-hub-server.test.mjs`: focused characterization test 7件。

## 参照した既存実装と、コピーせず書き直した理由

- `src/bridge-server.mjs`の`validatedRequestHost`・`forwardHeaders`・`forwardedHeaders`・
  `upstreamUrl`は非export（private関数）なのでimportできず、依頼どおり同等ロジックを
  `bridge-hub-server.mjs`内に再実装した（`validatedHubHost`・`hubForwardHeaders`・
  `hubForwardedHeaders`・`validatedHubRequestTarget`）。`bridge-config.mjs`の
  `normalizeBridgeAllowedHost`はexportされているが、bh3が同時に`bridge-config.mjs`を
  編集する可能性があるファイルへ依存を作らないため、あえてimportせず同等ロジックを
  ローカル実装した（`normalizeHubAllowedHost`）。
- `src/todo-dashboard-registry.mjs`の`withLock`・`atomicJson`も同じ理由（非export）で
  ローカル再実装。ロックファイルの置き場所は`env.LATTICE_HUB_RUNTIME_DIR`配下とし、
  dashboard側の`LATTICE_DASHBOARD_RUNTIME_DIR`とは独立させた。

## 仕様書になかった実装判断（範囲内での穴埋め）

依頼の仕様は各エンドポイントの主要な挙動を固定していたが、実装のために以下は
自分で埋める必要があった。設計の再検討ではなく、既存コードベースの慣習に
揃えた実装レベルの判断として報告する。

1. **`GET /projects/`のJSON応答から`terminal_id`・`address`・`port`を除外した。**
   依頼文はHTML側の表示fieldを「project_id・display_name・status」と明示していたが、
   JSON側のfield構成は明示していなかった。`bridge-server.mjs`の`/__lattice/bridge-health`が
   未認証の呼び出し元にはpid/addressを返さない（`publicHealth.pid === undefined`という
   既存test）という、このcodebaseの確立した「公開応答から内部経路情報を伏せる」流儀に
   揃え、JSON配列もHTML同様の3+1 field（`last_seen_at`を追加）だけを返す設計にした。
   端末のLAN上IPアドレスを公開HTTP応答へ載せない、という保守的な選択。
2. **hubのlisten addressは`127.0.0.1`固定にした。** 依頼で渡された`startBridgeHubServer`の
   signatureにlisten addressの引数が無く、todo-gantt-live.mjsの`startTodoGanttDashboardServer`
   （同じく「ローカルの前段プロキシに立たれる」性質のサーバー）が`LOOPBACK`定数で
   loopback固定にしている前例に倣った。192.168.1.2実配備時のbind先はbh5（配備task）の
   範囲であり、本taskはlistenアドレスを設計しない。
3. **`now`・`ttlMs`をoptionalな追加引数として`startBridgeHubServer`へ足した。**
   依頼の完了条件に「TTL超過を`now`の注入かttlMsを小さくして再現するテスト」が
   明示されていたため、テスト容易性のために必要だった。依頼のsignatureに明記された
   5引数（`registryStore, port, allowedHosts, env, fetchImpl`）はそのまま維持し、
   後方互換なoptional引数として追加しただけで、削除・変更した引数は無い。
4. **`fetchImpl = fetch`はsignatureどおり受理するが、現状どこからも呼んでいない。**
   SSE安全の要件（chunkをbufferingしない）を満たすには`node:http`の
   `request`/`.pipe()`によるストリーミング中継が必要で、これは`bridge-server.mjs`が
   参照実装として明示された経路と同じ手段である。`fetchImpl`をどこで使うべきかは
   依頼文からは読み取れず、未使用のまま機能を作ることは設計の再検討にあたると
   判断したため、何もしない状態で残した（`void fetchImpl;`でlintの未使用警告だけ避けている）。
   将来、健全性probe等の用途で使うなら、それは設計判断として別途裁定を仰ぐべき点。
5. **登録requestのbody sizeへ64KiB上限を設けた。** `readDashboardDescriptor`など
   既存codeが持つ65,536byte上限と揃えた、無制限メモリ確保を避けるための防御。
   専用のtestは書いていない（依頼の必須testリストに無いため）が、実装には含めた。
6. **`/__lattice/hub/register`・`GET /projects/`にmethod制限（POST/GET以外は405）を
   追加した。** todo-gantt-live.mjsの`METHOD_NOT_ALLOWED`慣習に揃えた防御的実装。
   `/projects/<id>/*`は依頼文が明示的に「GET/その他」としているため、method制限を
   設けていない（全methodをそのまま中継する）。

## 検証

- `node --test test/bridge-hub-server.test.mjs`: **7/7 green**。カバー範囲は依頼の
  必須項目（疑似端末2台の登録と合成一覧、project別中継、SSE的streaming、
  許可外Hostの421、未登録project_idの404、TTL超過の503、file永続化round-trip）を
  全て満たす。
- `node scripts/check-syntax.mjs`: **red（1/153失敗）だが、失敗は自分の変更に無関係**。
  失敗しているのは`src/todo-store.mjs`の1066行目に埋め込まれた生のNULバイト
  （`` `${absoluteRepo}\0${oid}` `` 形のcache key構築、`readEvidenceBlob`関数内）。
  実際に確認した内容:
  - `git diff HEAD -- src/todo-store.mjs`は差分ゼロ——このNULバイトは**私が着手する前から
    HEADに既にcommit済み**（直近commit `f3b3b5c`「git子起動をwindowsHide付き共通入口へ
    集約しcat-file --batchでまとめ読みする」）。
  - `git status --short`は自分が作った2ファイル（`src/bridge-hub-server.mjs`・
    `test/bridge-hub-server.test.mjs`）のみを`??`として示し、他fileへの変更は無い。
  - 自分が作った2fileだけを対象に、check-syntax.mjsと同じ禁止byte検査（制御文字
    U+0000〜U+0008、U+000B、U+000C、U+000E〜U+001F）を個別実行し、両方とも
    clean（該当byte無し）であることを確認した。
  - `node --check src/bridge-hub-server.mjs`・`node --check test/bridge-hub-server.test.mjs`は
    どちらも構文エラー無し。
  この結果を「check-syntax green」と偽らず、redのまま報告する。原因は`src/todo-store.mjs`
  という編集禁止対象file（他task/dogfoodingの並行編集下）であり、bh1のevidence文書が
  警告していた「canonical treeが同時編集で赤くなりうる」状況が今回はcheck-syntax gate側で
  実際に起きた形。この修理はbh2の範囲外——次にfull gateを回す誰か、または
  `src/todo-store.mjs`の担当taskが対応すべき。
- `npm test`・`npm run ci`は依頼どおり実行していない（依頼が明示的にfocused testと
  check-syntaxだけに限定しているため）。

## commit対象（呼び出し元がcommitする想定）

`src/bridge-hub-server.mjs`・`test/bridge-hub-server.test.mjs`・
`evidence/bridge-hub/bh2-hub-server.md`の3fileのみ。既存fileへの変更は無い
（`git status --short`で確認済み）。
