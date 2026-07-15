# GAO Schedule Assessment Guide — 取得記録

- 出典: https://www.gao.gov/products/gao-16-89g
- PDF: https://www.gao.gov/assets/gao-16-89g.pdf
- 取得日: 2026-07-15
- 取得方法: Web検索／Web openで公式ページを確認。MarkItDownとcurlはGAOのHTTP 403で失敗したため、
  本文のverbatim保存は行わず、この取得記録へ切り替えた。
- 確度: 高（U.S. GAO政府公式guide）

公式ページは、信頼できるscheduleの十のbest practiceとして、全activityの捕捉、順序付け、resource、
duration、critical path、float、schedule risk analysis、実進捗による更新等を扱う240ページのguideを
公開している。本研究では、WBSから実行networkへ変換する際のhard precedence、critical path、
resource制約、継続更新の根拠として参照する。

注意: dotagentsではAIの時間見積を計画判断へ使わない既存裁定があるため、GAOのduration-based CPMを
そのまま移植しない。構造上のdependency depth／join dominatorと、実測後の観測値を分離する。
