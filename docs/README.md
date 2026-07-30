# Lattice文書案内

工程状態、task、Phase、依存、完了証拠の正本はLattice storeだけである。Markdownへ工程状態を
二重化せず、最初に`lattice status --json`、続いて`lattice todo status --json`で読む。

## 現行文書

- [00_product-contract.md](00_product-contract.md): 公開製品契約
- [01_integration-package.md](01_integration-package.md): host／工場への組込み面
- [06_design-spec.md](06_design-spec.md): static／live Ganttの表示仕様
- [bridge-setup.md](bridge-setup.md): optional network bridgeと公開時の受入gate
- [operations/lattice-kitepon-deployment.md](operations/lattice-kitepon-deployment.md): `lattice.kitepon.dev`の現行配備構成と運用記録
- [adr/0063-ready-frontier-dispatch-contract.md](adr/0063-ready-frontier-dispatch-contract.md): ready全件を並列既定にする開始契約
- [adr/0068-gantt-routes-run-between-the-columns.md](adr/0068-gantt-routes-run-between-the-columns.md): 依存線の配線規約（ADR 0066 Decision 7を置き換え）
- [../PLAN.md](../PLAN.md): 製品思想と研究方向
- [../CHANGELOG.md](../CHANGELOG.md): 公開版ごとの差分

## 履歴と証拠

- `adr/`: 裁定時点の用語を含むimmutableな意思決定履歴
- `evidence/`: 実行時点の入力・結果・旧名称を含み得る監査証拠
- `archive/`: 役目を終えた計画とauthoring資料
- `handoff_*`、`plan_*`、`todo-extraction-v1.md`、`ui-review-backlog.md`: 互換リンクを守る完了済み履歴

履歴資料の旧名称は出典同一性のため書き換えない。現行runtime、設定、state、MCP名の判断には
履歴資料を使わず、製品契約とLattice storeを使う。
