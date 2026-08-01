# 静的Gantt HTML生成を廃止し、動的dashboardへ一本化する

## 背景

公開工程表は `https://lattice.kitepon.dev/projects/<project_id>/` の動的dashboardで稼働している。
一方、Latticeは `todo gantt` でHTMLとstatus sidecarを生成し、bingoのproject規約は状態変更のたびに
`docs/bingo-gantt.html`を再生成するようAIへ要求していた。この二重運用により、AIが公開面ではなく
不要な個別HTMLを更新し、正本を取り違える。

## 採用方針

- 運用中の工程表はLattice storeを都度読む動的dashboardだけを正本とする。
- 通常のAI authoring／lifecycle操作から静的HTML生成とstale確認を除去する。
- `todo gantt`、`todo gantt status`、`--out`、静的artifact sidecarの公開契約と実装を廃止する。
- dashboardのローカルserve／公開serveは、ファイル生成を介さず同じrendererをmemory上で使う。
- README、CLI help、ADR、test、bingoの`AGENTS.md`とhandoffを動的URLへ揃える。
- 既存の`docs/bingo-gantt.html`とsidecarは全参照を切り替えてから削除し、削除前に消費者ゼロを
  `rg`とLattice sensorの双方で確認する。

## 棄却案

- 静的HTMLを残し、AIの注意力だけで動的dashboardと使い分ける案は棄却する。今回の誤誘導を再発させる。
- 静的HTMLを生成し続け、dashboardがそれを配信する案は棄却する。store更新と表示更新の間に不要な
  再生成gateを作り、stale artifactを正本へ戻してしまう。

## 変更対象

- Lattice: CLI routing/help、Gantt artifact writer/status、README、関連ADR・tests、dashboard契約。
- bingo: `AGENTS.md`、`docs/HANDOFF-CLAUDE.md`、静的Gantt artifactと参照文書。

## 受入条件

- lifecycle変更後、静的ファイル生成なしで動的dashboardに最新状態が表示される。
- AI向けhelp／project規約に`docs/*gantt.html`の再生成指示が残らない。
- `https://lattice.kitepon.dev/projects/bingo/`が設計メモを含む唯一の運用工程表として案内される。
- 廃止した静的artifactを参照するlive文書・コードがゼロである。
