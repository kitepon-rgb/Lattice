# OpenAI Symphony — 取得記録

- 出典: https://openai.com/index/open-source-codex-orchestration-symphony/
- 取得日: 2026-07-15
- 取得方法: Web検索／Web openでOpenAI公式記事を確認。MarkItDownはHTTP 403で失敗したため、
  本文のverbatim保存は行わず、この取得記録へ切り替えた。
- 確度: 中〜高（OpenAI公式の社内運用事例。一般化可能な査読実験ではない）

公式記事では、issue trackerをcontrol planeにし、各open taskを専用workspaceへ対応付ける。
計画から依存付きtask treeを作り、blockedでないtaskだけを実行する。issueとsession／PRは一対一ではなく、
一つのissueが複数PRや複数repoを持ち得る。曖昧で強い判断を要する問題は対話的な人間主導作業へ残す。

本研究では、外層TODO DAG、専用workspace、ready frontierを支持する実務例として使う。一方、社内の
landed PR増加率は特定teamの観測であり、TODO DAGの一般的因果効果としては採用しない。
