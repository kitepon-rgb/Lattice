# plan_bridge-hub-landing — hub公開面の製品アピールページ化

- 状態: campaign計画正本（統括レーン・2026-08-10着手）
- 実行TODOの正本: Lattice store（plan_key `bridge-hub-landing`、本docはtyped discovery後にmigrateで移転済みの導線を持つ）
- 関連: `docs/plan_bridge-hub.md`（bh5-deployはオーナー実施待ちで継続中。本planはbh5と書込範囲・手順を交差させない）

## 目的

https://lattice.kitepon.dev/ の公開面（現 `/projects/` 一覧）を、工程一覧のリンク集機能を保ったまま製品アピール1ページへ再構築する。ここはルートサイト（kitepon.dev）のチャット窓バナー「工程表で見る」と About「公開中の制作風景を見る」の両導線が着地する、Latticeの動作デモの入り口である。

## オーナー裁定（2026-08-10確定）

1. `/` と `/projects/` の両方で同一ページを配信（`/`→`/projects/` 301廃止）。
2. 一覧カードはプロジェクト名を主・ホスト名を従へ入替。内部端末/プロジェクトの公開面除外機構を追加。
3. JA/EN両対応（`/en/` パス方式。ルートサイトと同じパス分離の流儀）。
4. デザインはルートブランド正典準拠（RootSitePromotion `docs/color-system.md`・`docs/identity-system.md`。Discovery Orange #EF8D32 / Motion Cobalt #2149AA / Paper #F8F5EF系、矢印グリフ禁止、#EF8D32上の白小文字禁止）。
5. noindexはサイト全体として撤去（一覧＋個別工程ページ。アピール目的のサイトに検索拒否は矛盾）。
6. 状態色は正典色へ置換（オンライン=Soft Orange地+Action Orange文字、オフライン=ニュートラル地+Ink薄文字。文字ラベル維持）。
7. プロジェクト表示名はhub側JSON（public-visibility.json）の`display_names`マップで整形。レジストリプロトコルには触れない（厳密キー比較のhard break回避。プロトコルv2は別戦役）。

## 思想・判断理由

- **hidden ≠ private**: 除外は一覧（HTML/JSON）からの非表示だけで、`/projects/<id>/` のproxyは殺さない。smoke testの自己アクセスと運用者の直URLを守る。後日「404へ直したく」なる箇所なのでADRへ明記する。
- **可視性・表示名はhub運用者の裁量**であり端末の自己申告ではない → レジストリでなくhub runtime dirのファイル。リクエスト毎hot-read（レジストリと同じ流儀）で再起動不要。壊れたファイルはtyped 500（黙って内部端末を再公開しない）。
- **言語は`/en/`パス**: Accept-Language自動判定は `/` を非決定的にし、受入curlとバイト比較テストを壊すため採らない。
- **外部フォント・raster画像なし**: CSP `default-src 'none'` を広げない。図はインラインSVG。
- room 2474の「hub一覧はdashboardHtmlと見た目一致」制約は本裁定で撤回（ADRで記録）。

## 非目標

- レジストリプロトコル（register/heartbeat）の変更・フィールド追加。
- hubの404/503ページ（`hubProjectStatusHtml`）のブランド化（申し送りのみ）。
- 個別工程ページ（ガント本体）のブランド化・EN化。
- dashboard registryの表示名をhubへ運ぶ経路（プロトコルv2戦役）。

## 受入条件

- focused test green（`node --test test/bridge-hub-landing.test.mjs test/bridge-hub-server.test.mjs`）＋ `npm run ci` green。
- 本番5 URL（`/`, `/projects/`, `/en/`, `/en/projects/`, `/projects/lattice/`）を新ビルド固有のマーカー文字列で確認（status code判定禁止 — bh5でのbind mount inode差替事故の教訓）。
- カード主見出し=プロジェクト表示名・従=ホスト名。隠しIDがHTML/JSON両方に不在、かつ `/projects/<hidden>/` は生存。
- 矢印グリフ0件・旧hex（#e85f2a/#315cbe/#f7f3ea）0件・noindex 0件（landingと個別工程ページ）。
- ルートサイト導線4箇所（JA×2→`https://lattice.kitepon.dev/`、EN×2→`https://lattice.kitepon.dev/en/`）が新ページに着地。

## 工程（Lattice storeへ移転する実行TODO）

- [ ] bhl1-adr: ADR起草 — hub landingを公開の製品面と定義（room 2474制約撤回・/en/方式・hidden≠private・noindex全面撤去）
- [ ] bhl2-extract: hubIndexHtmlを`src/bridge-hub-landing.mjs`へ逐語抽出（見た目不変・既存テストgreen維持）
- [ ] bhl3-landing: レンダラー再構築 — JA/EN copyテーブル・ヒーロー・仕組み3カード+SVG図・ライブ一覧・CTA・正典CSS変数・`test/bridge-hub-landing.test.mjs`新設
- [ ] bhl4-routing: `/`・`/projects/`・`/en/`・`/en/projects/`の4面配信、301群整理、hub serverテスト更新
- [ ] bhl5-visibility: `public-visibility.json`（hidden_project_ids/hidden_terminal_ids/display_names）hot-read、HTML/JSON両フィルタ、typed 500
- [ ] bhl6-noindex: `todo-gantt-live.mjs`等の個別工程ページからnoindex撤去
- [ ] bhl7-verify: ローカルhub起動+偽端末登録で8構成目視（JA/EN×340/394/612/760）、visibility hot-reload実証、`npm run ci`
- [ ] bhl8-release-deploy: CHANGELOG・minor bump・`npm publish`・192.168.1.2反映・visibility実データ作成・本番マーカー実測（H）
- [ ] bhl9-rootsite: RootSitePromotion href 4箇所更新+deploy+公開smoke（別repo調整・bhl8後）

## 既知の罠

- bind mount fileへの`sed -i`はinode差替でcontainerへ届かない（bh5実被弾）。Caddyfileは触らない予定だが、触るならdocker restart。
- 公開反映の検証はstatus codeでなく配信内容（マーカー文字列）。
- `validateBridgeHubRegistrationRequest`/`validRegistryEntry`はexactキー比較 — フィールド追加は全端末即死。
- `prepublishOnly`はHEADがorigin/main祖先+clean treeを要求。
- Landing判定は`PROJECT_ROUTE`より前、`/en/projects/`は`/en/projects/<id>`リダイレクトより前。
