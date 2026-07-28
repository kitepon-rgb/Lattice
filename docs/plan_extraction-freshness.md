# 抽出鮮度の自動heal——「観測者が変わった」を機械が拾う

工程状態の正本はLattice storeの`extraction-freshness` plan。本書は目的・裁定・非目標・
受入条件だけを所有する（2026-07-29 起票、オーナー裁定「自動じゃないとみんなやらない」）。

## 目的

sensorの変更検出は`content_hash`（fileが変わったか）だけで、**観測者（抽出コード）が
変わったか**を見ていない。既存の`EXTRACTION_VERSION`はglobal stamp＋statusの
`reindexRecommended`という**推奨止まり**で、手動full再indexしか治療手段が無い。
2026-07-28に実被弾: 旧daemonがwatcher更新を続け、schema v11なのに束縛・装飾行が
全DB 0行——タイムスタンプは新鮮、意味論は古い。古い抽出のrowは「束縛なし」という
**偽の観測**として読まれ、「unknownを『無い』へ丸めない」思想への正面違反になる。

## 裁定

- **手動推奨では治らない。自動でheal する**（オーナー裁定）。per-fileの
  `extraction_version`を記録し、syncの「変更なし」条件を
  `content_hash一致 かつ 抽出版数一致`にする。抽出器が進化したら、次のsync／watcherの
  通常経路で古い抽出のfileだけが順次再抽出される。
- **global stampは全fileが現行版になった時だけ自動前進**。「syncは部分集合しか触らない
  からstampを進めてはならない」という既存の注記は、per-file版数の導入で「全部healしたら
  進めてよい」へ精密化される。推奨表示は自然に消える。
- 既存rowはmigrationのDEFAULT 0で一律staleになり、導入それ自体が2026-07-28級の
  被弾を初回syncで全快させる。
- 今回のcampaignの抽出変更（valueRef write・名前filter緩和・import束縛・装飾行・
  Rust attribute）は`EXTRACTION_VERSION`のbumpを遡及して載せる。

## 非目標

- 抽出fingerprintの自動導出（dist hash等）。release毎の全再抽出になる過剰無効化であり、
  手動bump＋docstring規律（schema versionと同じ作法）で足りる。
- 過程の監視・再indexの強制。healは通常のsync経路に乗るだけで、新しい門は作らない。

## 受入条件

- 内容不変・抽出版数だけ古いfileが、syncで再抽出される（fixture test）。
- 全fileが現行版へ達したsyncの後、global stampが前進し`reindexRecommended`が消える。
- 実repo（本repo）でmigration→syncによりstale全件がhealし、束縛・装飾行が
  手動DB再構築なしで読めることを実測報告する。
- 回帰: sensor全suite・`npm run ci`。届け先: release・global install・常駐daemon
  載せ替え・実機確認まで（完了の定義）。

## 工程

- [x] per-file抽出版数と自動heal（migration v12・sync判定・global stamp自動前進・test）
- [x] EXTRACTION_VERSIONのbump遡及と実repoでのheal実測（678 file全快が約9秒・stamp自動前進・推奨消灯）
- [ ] 届ける（release・install・daemon載せ替え・実機確認）
