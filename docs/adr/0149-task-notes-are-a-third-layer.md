# ADR 0149: ToDoの作業記憶は独立note chainへ置き、通常読取で自動供給する

- 状態: 採択（2026-08-01）
- 関連: [ADR 0053](0053-todo-store-and-gantt-surface.md)（lifecycle journalとsnapshotの正本規律）、
  [ADR 0128](0128-todo-start-advisory.md)（着手時advisory）、
  [ADR 0131](0131-single-store-read-for-gantt.md)（Ganttの単一store read）
- 計画: [docs/plan_todo-task-notes.md](../plan_todo-task-notes.md)

## 文脈

従来はToDoやplanを設計したMarkdownへ、作業中の調査結果、採用・棄却した案、実装上の注意、未解決事項を
追記していた。現在のLattice ToDoはtitle、依存、lifecycle state、evidenceを記録できるが、作業中に増えた
task単位の散文を保存する面を持たない。そのため、次のAIがToDoを引き継いでも、前の会話コンテキストにだけ
存在した方針を再調査するか、見落とす。

plan級の思想・判断理由はlinked Markdownが持ち、状態・依存はLattice storeが持つ。この二層へtask単位の
作業記憶を押し込むと、Markdownの常設再解釈か、lifecycle正本の肥大化になる。必要なのは両者を置き換える
正本ではなく、AIの出力をtaskへ束縛して次のAIへ渡す第三の層である。

## 裁定

1. **task-scoped作業記憶を独立note chainへ置く。** `.lattice/todo/notes/<plan_key>/` 配下に
   append-only JSONL chainを置く。planのmutable field、既存lifecycle journal、snapshot、manifestへは
   note本文もnote headも入れない。note追記でlifecycle journal、snapshot、manifestのbytesが変化してはならない。
2. **初版schemaは `lattice.todo_note_event.v1` とする。** exact keysは`schema, project_id, plan_key,
   task_id, plan_version, sequence, previous_digest, actor, recorded_at, body, supersedes, event_digest`。
   `body`は非空Markdown、UTF-8で16 KiB以下、改行以外のC0制御文字を拒否する。`supersedes`は`null`または
   同一taskの既存note event digestであり、訂正は履歴を書き換えず新eventとして残す。
3. **chainはbyte-level fail closedにする。** dense sequence、digest link、canonical JSON+LF、1 MiBごとの
   seal/rotationを要求する。破損は`NOTE_LOG_CORRUPT`としてnote read/writeと`todo verify`を失敗させるが、
   `STORE_CORRUPT`へ丸めずlifecycle read/writeを止めない。Ganttは黙って空にせず明示WARNを出す。
4. **revision移行は既存`task_migration`から決定的に導出する。** note専用のcarry/archive儀式を追加しない。
   旧版noteは現行taskへ解決し、元plan versionと元task IDを来歴として保持する。removed taskのnoteは
   archived束へ残し、現行taskの指示として表示しない。
5. **通常のToDo読取で作業記憶を自動供給する。** 個別ToDo詳細の正規read resultと`todo start`成功resultは、
   最新note群、元plan version、訂正状態、note head digest、overflow件数をbounded contextとして必ず含む。
   AIが`todo note list`を知り、別途実行することを前提にしてはならない。`note list`は全履歴の明示閲覧と
   診断だけを担う。note取得不能を空配列へ丸めない。
6. **通常供給とGantt埋込は有界にする。** taskごとに新しい順で64 KiBまでを供給し、超過分は件数と
   `note list`への導線を返す。Gantt右ペインは「作業記録」節で同じprojectionを表示し、旧版由来には来歴を、
   superseded noteには訂正済み表示を付ける。
7. **Markdownは既存AST rendererのallow-listだけで描画する。** raw HTML、`innerHTML`、外部scheme linkを
   許さず、script埋込は`serializeJsonForScript`を通す。noteのbytesは既存Gantt prose budgetへ計上する。
8. **公開面は初版でnote本文を出さない。** ローカル生成Ganttには表示するが、`todo gantt serve`の公開wrapperは
   note本文を除外する。公開を許す変更は別の明示裁定を要求する。note artifact自体はgit trackedなので、秘密を
   書かない運用規範は維持する。
9. **noteは正典や機械判定を代替しない。** 方針級の発見はADR・docs・caveatへ還流する。noteをindependence、
   dispatch、done evidence、受入判定の入力にしない。

## 公開契約

- 書込: `lattice todo note --plan <key> --task <id> --message <text>` または`--input <repo-relative-path>`。
  訂正は`--supersedes <digest>`を加える。
- 全履歴: `lattice todo note list --plan <key> [--task <id>] --json`。
- 通常読取: 個別ToDo詳細と`todo start`はnote contextを同梱し、別コマンドを要求しない。
- Gantt: ローカル右ペインへnote contextを表示し、live headはnote head digestを含む新versionへ更新する。

## 非目標

- 会話全文の自動収集
- 分類、タグ、全文検索、通知、購読
- noteの編集・削除
- note本文の意味解析や機械判定への利用
- snapshot、status一覧、lifecycle journalへのnote混入
- 複数端末からの同時note書込

## 受入条件

1. noteを登録したToDoの通常詳細読取と`todo start`が、追加の`note list`なしで最新note・来歴・overflowを返す。
2. note追記の前後でlifecycle journal、snapshot、manifestのSHA-256が完全一致する。
3. 多段revisionとremoved taskを通して、現行束とarchived束が決定的に再構成される。
4. 破損note chainはtyped failureまたはGantt WARNになり、空の成功へ丸められずlifecycle操作も止めない。
5. ローカルGantt右ペインへ安全に表示され、XSS fixtureが全拒否され、公開serveへ本文が出ない。
6. focused test、関連test、`npm run ci`がgreenになる。

