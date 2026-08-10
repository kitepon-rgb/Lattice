# bhl9-rootsite — ルートサイト導線の切替

- repo: RootSitePromotion、commit `ce037011e8d503052122a269fbb53b28ef9bf866`（push済み）。
- 変更: `app/page.tsx`のライブ窓バナーCTAとAbout導線を`https://lattice.kitepon.dev/`へ統一
  （従来は`/projects/`とbare originの混在）。`app/en/page.tsx`の同2箇所を
  `https://lattice.kitepon.dev/en/`へ接続。
- 事前検証: `npm run lint` pass、`npm test` 39/39 pass、`dist/static`のhrefを実測。
- 本番: image tag = commit SHA、user `nginx`、health `healthy`。LAN preview `/`・`/en` 200。
- 公開smoke: `https://kitepon.dev/`のlattice導線2本が`/`、`https://kitepon.dev/en`の2本が`/en/`、
  不明pathが404。`/health`の410はCaddyの`@connectc2x_retired`（旧endpoint廃止）で本件と無関係。
