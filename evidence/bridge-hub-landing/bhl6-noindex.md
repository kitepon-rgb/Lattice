# bhl6-noindex — noindex全面撤去

- `src/todo-gantt-live.mjs`のrobotsメタ3箇所（工程ページpublicMetadata・legacy dashboardHtml・404）を撤去（commit e065870）。
- hub landing側はbhl3で最初からnoindex無し。repo全体でsrc内noindex出力0件（grep確認）。
- 検証: `node --test test/todo-gantt-live.test.mjs` 13件 fail 0（旧ピン3件は不在アサートへ反転）。
