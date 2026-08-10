# ADR 0164 — hub landingは公開の製品面である

- Status: Accepted
- Date: 2026-08-10
- Extends: [plan_bridge-hub-landing.md](../plan_bridge-hub-landing.md)（campaign計画正本）
- Supersedes: room 2474の「hub一覧はtodo-gantt-live.mjsのdashboardHtmlと見た目一致を保つ」制約
  （`plan_bridge-hub.md`非目標の見た目維持解釈を含む）

## Context

lattice.kitepon.devの公開一覧（`/projects/`）は、ルートサイトkitepon.devのチャット窓バナー
「工程表で見る」とAbout「公開中の制作風景を見る」の両導線が着地する、Latticeの動作デモの入り口である。
現状は端末ホスト名を主見出しにした素朴なリンク集で、smoketest等の内部端末も公開され、
矢印グリフ（ルートブランド正典違反）とnoindexを含む。オーナー裁定（2026-08-10、
計画正本の「オーナー裁定」節）により製品アピール1ページへ再構築する。

## Decision

1. **hub landingは公開の製品面であり、loopbackローカルのdashboardHtmlと見た目一致を保つ義務を撤回する。**
   room 2474の一致制約は「多端末化で入り口の見た目が黙って変わる退行」を防ぐものだった。本裁定は
   オーナー自身が公開面の再設計を指示したものであり、退行ではなく意図した挙動修正である。
   以後の公開面の見た目正本はルートブランド正典（RootSitePromotion `docs/color-system.md`・
   `docs/identity-system.md`）とする。
2. **`/`と`/projects/`は同一のlandingを配信する**（`/`→`/projects/`の301は廃止）。EN面は
   `/en/`・`/en/projects/`のパス分離とし、Accept-Languageによる自動振り分けはしない
   （`/`の応答を非決定的にし、受入curlとバイト比較テストを壊すため）。
3. **hidden ≠ private。** `public-visibility.json`による除外は一覧（HTML/JSON）からの非表示だけで、
   `/projects/<id>/`のproxyは生かす。smoke testの自己アクセスと運用者の直URLを守るための意図であり、
   後日「隠しているのに404でないのは漏れ」として殺さないこと。可視性と表示名はhub運用者の裁量
   （hub runtime dirのファイル）であり、端末の自己申告（レジストリ）へ載せない。
4. **レジストリプロトコルには触れない。** `validateBridgeHubRegistrationRequest`／`validRegistryEntry`は
   exactキー比較であり、フィールド追加は新旧両方向のhard breakになる。表示名の整形は
   `public-visibility.json`の`display_names`マップで行う。プロトコル拡張は別戦役（v2）。
5. **noindexはサイト全体として撤去する**（landingと個別工程ページ）。アピール目的の公開サイトに
   検索拒否は矛盾する、というオーナー裁定。個別工程ページの撤去は同一npmパッケージのリリースで
   各端末bridgeへ波及する。
6. **外部リソースゼロを維持する。** CSP `default-src 'none'; style-src 'unsafe-inline'`を広げない。
   図はインラインSVG、フォントはシステムスタック。矢印グリフをリンク装飾に使わない。

## Consequences

- 公開面の受入検証はstatus codeでなく配信内容のマーカー文字列で行う（bh5のbind mount
  inode差替事故の教訓を継承）。
- hubの404/503ページ（`hubProjectStatusHtml`）が唯一の非ブランド公開面として残る（申し送り）。
- ルートサイトのEN導線はhubデプロイ後に`https://lattice.kitepon.dev/en/`へ切替える（順序固定）。
