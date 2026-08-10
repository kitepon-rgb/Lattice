# bhl3-landing — レンダラー再構築

- `src/bridge-hub-landing.mjs`をrenderBridgeHubLanding({projects,lang,displayNames})へ再構築（commit df4feec）。
- LANDING_COPY {ja,en} 1テーブル・正典CSS変数・ヒーロー/仕組み3カード/SVG図/ライブ一覧/CTA/フッター。
- 検証: `test/bridge-hub-landing.test.mjs` 12件green（正典コピー・主従入替・旧hex不在・矢印不在・
  noindex不在・canonical/hreflang相互・エスケープ・空一覧・display_names・外部リソース不在）。
