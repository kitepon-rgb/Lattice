# AI安全ToDo authoring v0.39.0 release plan

## 目的

初期設計メモ、`NO_PLAN`申告、動的工程表だけを使う表示契約を、公開文書、npm package、global CLI、
常駐bridge、公開dashboardまで一貫して届ける。

## 判断

- v0.39.0とする。pre-1.0の公開authoring schemaと運用表示面が変わるためminor releaseが妥当である。
- npmへ出すcommitは`origin/main`の祖先かつclean worktreeに限定する。
- pushは追加commitだけとし、npm公開版に問題があれば`@quolu/lattice@0.38.1`のglobal installで戻す。
- Cloudflare、Caddy、Tunnelの設定は変更しない。既存経路の先にあるbridge／dashboardだけを載せ替える。

## 工程

- [x] 関連する英日README、公開契約、統合索引、UI仕様、ADR追補、backlog、CHANGELOGを現行実装へ揃える。
- [x] package versionを0.39.0へ上げ、focused test、pack dry-run、完全CIを通す。
- [ ] 対象限定commitをmainへpushし、release commit gateを通す。
- [ ] `@quolu/lattice@0.39.0`をnpmへpublishする。
- [ ] 公開版をversion pinでglobal installし、bridge／dashboard常駐実体を載せ替える。
- [ ] CLI、ローカルbridge、公開Lattice／Bingo工程表をsmokeし、evidenceへ固定する。

## 受入条件

- 新規ToDoは非空の設計メモまたは正確な`NO_PLAN`を持ち、空欄を成功に見せない。
- 個別ToDo右ペインはローカル／公開の動的viewerで初期設計メモを表示し、公開面は追記note本文を含まない。
- 静的HTML生成入口は退役し、CLIと文書が動的dashboardだけを案内する。
- `npm run ci`と`npm pack --dry-run --json`が成功する。
- npm registry、global CLI、dashboard healthが0.39.0で揃う。
- `https://lattice.kitepon.dev/projects/bingo/`を含む公開面がHTTP 200で、未着手ToDoの設計メモを返す。

## 非目標

GitHub Release／source tag、Cloudflare／Caddy／Tunnel設定変更、append-only note本文の公開は行わない。
