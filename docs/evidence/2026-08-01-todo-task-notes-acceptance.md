# ToDo task notes 最終受入証拠

## 受入契約

`todo note list`を知っていることをAIへ要求しない。通常の個別ToDo詳細読取と、成功する`todo start`の結果へ、
対象ToDoの最新bounded note contextを必ず同梱する。contextはnote本文だけでなく、元plan version／元task、
訂正状態、note chain head、overflow有無、全履歴コマンドを含む。note chainを読めない時は空配列へ丸めず、
`todo start`はlifecycle event追記前に失敗する。

ローカルGanttの個別ToDo右ペインは同じcontextを「作業記録」として表示する。公開serveと常設dashboardは
note本文を含めない。

## 実装された面

- `todo show --plan <key> --task <id> --json`: `note_context`を自動同梱する。
- `todo start --plan <key> --task <id>`: 成功結果schema v3へ`note_context`を自動同梱する。
- `todo note append/list`: 独立append-only chainへの追記と全履歴診断を提供する。
- revision projection: `task_migration`だけを根拠に旧版noteを現行ToDoへ投影し、removed taskはarchived束へ分離する。
- Gantt: ローカル右ペインだけに安全なMarkdownとして表示し、破損時は「記録なし」と誤表示しない。
- 公開面: 手動serveと常設dashboardを共通public rendererへ束ね、`includeNotes: false`を強制する。

## 実store受入

- `todo-task-notes` planの`ttn-004`、`ttn-006`、`ttn-007`へ実noteを追記した。
- `ttn-007`の`todo start`成功結果がschema v3で同じToDoのnote本文、origin、head digest、overflow、
  full-history commandを自動返却した。別途`note list`は実行していない。
- note追記前後でlifecycle journal、snapshot、manifestを分離したまま維持した。

## 検証結果

- note契約・store・projection・CLI・自動contextのfocused test: 17件中17件成功。
- Gantt／dashboardを含むfocused test: 48件中48件成功。
- 最終`npm run ci`: product test、sensor test、静的検査、到達性検査、`todo verify`を含め成功。
- independence compile: task 7件、conflict 40件、unknown 0件として再計算済み。

## Fable反証

初回反証で、公開dashboardの別入口、raw task IDによる誤ったsupersede許容、`removed` sentinelのnull変換漏れ、
破損したGantt contextを「記録なし」と表示する問題を検出した。すべて修正し、関連testと最終CIを通した。

再監査では、改訂後ADR 0149と指定した5検証点に対する契約違反は0件だった。監査時点で古くなっていた
witness digestの再計算要求も、その後のindependence compile成功（unknown 0）で充足した。

## 非目標

会話全文の自動保存、分類・タグ・全文検索、noteの編集削除、公開面への本文露出、stale write lockの自動回復は
このcampaignへ含めない。
