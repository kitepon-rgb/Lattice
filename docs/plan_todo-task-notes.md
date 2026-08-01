# ToDoへ作業記憶を累積し、次のAIへ自動供給する — 統括plan

## 目的

AIがToDoを進める過程で得た方針、調査結果、採用・棄却理由、注意、未解決事項をtaskへ追記し、次のAIが
通常の個別ToDo読取または`todo start`を行っただけで、その作業記憶を取得できるようにする。

会話全文の保存ではない。会話から作業継続に必要な情報をAIが選び、task-scoped noteとしてLatticeへ渡す。
plan級Decisionとlifecycle stateの間にあったコンテキスト依存の空白を埋める。

## 裁定

不変Decisionは[ADR 0149](adr/0149-task-notes-are-a-third-layer.md)が持つ。noteは既存lifecycle journalや
snapshotへ混ぜず、`.lattice/todo/notes/<plan_key>/`の独立append-only chainへ置く。revisionは既存の
`task_migration`から解決し、note専用migrateを要求しない。

`note list`は全履歴の診断面であり、通常経路ではない。個別ToDo詳細と`todo start`が最新note群、来歴、
note head digest、overflowを自動同梱しなければ、本planの目的は未達とする。

## 作業レーン

- F: note chain schema、lifecycle正本との分離、revision解決、通常読取/startへの自動供給、公開serve除外
- A: store、CLI、verify、Gantt、focused testの実装
- H: なし。push、publish、deployは本planの範囲外

同一repo・同一契約面へ連続して触れるためwriterは直列にする。契約クリティカルなFだけを実装後に独立反証する。

## Lattice工程正本

- plan key: `todo-task-notes`
- task、依存、状態、完了証拠はLattice storeだけが持つ。本書へcheckboxを複製しない。

## 受入

- 通常の個別ToDo詳細と`todo start`が、別途`note list`を要求せずbounded note contextを返す
- note追記でlifecycle journal、snapshot、manifestのbytesが変わらない
- revisionを跨いだnoteの来歴とremoved taskのarchived束が再生できる
- note chain破損がnote面でfail closedになり、lifecycle操作を巻き込まない
- ローカルGantt右ペインへ安全に表示され、公開serveへ本文が出ない
- `npm run ci`がgreen

## 非目標

会話全文の自動保存、分類・タグ・全文検索、編集削除、通知、機械判定への利用、snapshot/status一覧への混入、
公開serveへのnote本文露出は初版へ入れない。

## 検証

baselineは2026-08-01に`npm test`全1182件green（92.7秒）。実装中は契約、store、CLI、Ganttのfocused testを
順に通し、Phase gateで関連test、`npm run check`、`npm run ci`を一度実行する。実storeへnoteを追記し、
通常read/start/Ganttの三面へ同じbounded contextが出ることと、lifecycle三artifactのSHA-256不変を確認する。
