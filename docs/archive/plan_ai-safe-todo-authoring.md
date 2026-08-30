# AIが壊さず使えるToDo authoringと設計メモ表示

- Status: Implemented（標準gateは既知の別件1件を除きgreen）
- Lane: Orchestrated（多段受入・Lattice／bingoの複数repo書込み・公開面smoke）
- Lattice plan: `ai-safe-todo-authoring`
- Decision: [ADR 0150](../adr/0150-todo-design-memo-is-required.md)

## 目的

LatticeでToDoを作るAIに、依存関係と短い題名だけでなく、後続AIがそのToDoだけを読んで実装を
再開できる設計メモを必ず登録させる。設計メモはMarkdownとしてLatticeのToDoへ束縛し、
`todo show`、`todo start`、ローカルGantt、公開dashboardの個別工程右ペインへ自動供給する。

同時に、2026-08-01のbingo実運用で確認した、project registry乗っ取り、authoring診断不足、
Phase追加の発見困難、Gantt出力契約の誤解誘発、動的dashboardと静的HTMLの二重運用を修理する。

## 実被弾と未充足

1. `.lattice`をscratchへコピーして`lattice status --json`を実行しただけで、同じ`project_id`の
   dashboard registry `repo_root`が無音で置換され、公開工程表が15分間コピーを配信した。
2. `bingo-capacity-retest`の10 ToDoは題名と依存だけ登録され、task noteは全件0、
   `narrative_anchor`もnullだった。元Markdownに時計補正、50ms gate、artifact、原因分類等の
   実装方針があるのに、公開右ペインへ一切表示されない。
3. `migrate`は設計メモが空でも成功し、`todo start`も空の`note_context`を成功扱いする。
   LatticeからAIへ「各ToDoへ設計メモを書け」という機械契約が無い。
4. `migrate`入力の違反はfield、期待digest、sort key、clock skew許容窓、該当taskを十分に返さず、
   authoringが総当たりになる。repo外inputも引数エラーへ畳まれる。
5. Phase無しplanへdone/evidenceを保ってPhaseを付ける`acquire_phase`とschema取得は実装済みだが、
   `migrate`結果から正規手順へ到達できない。
6. `registered_unreconciled`はsource reconciliation状態だが、その意味と運用影響を出力が説明せず、
   dashboard非表示原因と誤診させた。
7. Ganttはproject全planを描くHTMLなのに、任意の`.md`出力やplan名を含む出力名を許し、
   内容と名前の不一致を検出しない。
8. 動的dashboardが公開工程表として稼働しているのに、Latticeの`todo gantt`は静的HTMLを生成し、
   bingoの`AGENTS.md`は状態変更のたびにその再生成とstale確認を要求していた。
   `HANDOFF-CLAUDE.md`も`docs/bingo-gantt.html`を工程表として案内し、AIを不要な個別HTML更新へ誘導した。

## 不変Decision

- 新規ToDoはMarkdownの設計メモを必須とする。空やfile参照だけでは満たさない。
- 設計メモには背景、採用方針、棄却案、変更対象、実装上の注意、受入条件、未解決事項を持てる。
- 実際に何も考えていない場合は、空欄やwaiverへ逃がさず、設計メモ本文へ固定値`NO_PLAN`を明示する。
- LatticeはAIへ「あなたがこのToDoに対して、何も考えていないならば、設計メモに `NO_PLAN` と書いてください」と問いかける。
- 初期設計メモはplan versionへ束縛されたToDo内容であり、着手後の追加調査・判断はappend-only noteが持つ。
- 公開工程表は設計メモを表示する。秘密を置かない契約を維持し、公開面だから全文を一律除外しない。
- 運用中の工程表はstoreを都度読む動的dashboardだけを正本とする。projectごとの静的Gantt HTMLを
  生成・更新・stale管理する運用契約は廃止し、AIへ案内しない。
- Latticeは文章を生成しない。AIが生成したMarkdownを受け取り、存在・上限・束縛・移行・表示を検証する。
- registryは`project_id`とcanonical rootの衝突をfail-closedにし、明示adopt以外で配信元を変更しない。
- エラーは測定値、対象、期待、次の一手を返す。

## 実装単位

### F1. ToDo設計メモ契約

- authoring契約へMarkdown設計メモを追加し、空欄を拒否する。本文`NO_PLAN`は明示的な計画不在として受理する。
- 新規planの全pending／in-progress ToDoでcoverageを検証し、欠落task IDを返して拒否する。
- revisionはtask migrationに従って設計メモを引き継ぎ、removed taskの内容を現行指示にしない。
- legacy planはread可能に保つが、新規authoringの抜け道にはしない。

### F2. 右ペインと通常供給

- `todo show`と`todo start`へ設計メモを別操作なしで同梱する。
- ローカル／公開Gantt右ペインへ安全なMarkdown rendererで表示する。
- append-only task noteは運用履歴として通常readへ供給するが、公開dashboardへ本文を露出しない。
- 詳細が無いlegacy ToDoは黙って空欄にせず、欠落状態を明示する。

### F3. Registry所有root

- 同じ`project_id`が別canonical rootへ登録済みなら`PROJECT_ROOT_CONFLICT`で拒否する。
- registry bytesと既存dashboard配信元を不変に保つ。
- 明示adoptだけがrootを移せる。read-only経路として`session-context`を案内する。
- 公開画面へローカル絶対pathを露出しない。

### A1. Authoring診断

- `migrate --dry-run`で書込み直前まで検証し、boundedな複数診断を返す。
- JSON pointer、expected／actual、expected digest、sort key、clock skew許容窓と現在時刻を返す。
- unknown subcommand、invalid arguments、repo外inputをtypedに分離する。
- write pathの`evidence_unverified`へplan／task IDを付ける。

### A2. Phase・reconciliation・Gantt案内

- `migrate`結果へPhase構造と`acquire_phase`を使う次の一手を返す。
- reconciliationがsource照合状態であり、lifecycle利用／dashboard表示を塞がないことを自己記述する。
- Ganttのproject scopeを結果へ明示する。

### A3. 静的Gantt廃止と動的dashboard一本化

- `todo gantt`／`todo gantt status`と静的artifact sidecarを、動的dashboardを使う通常運用から除去する。
- CLI help、README、ADR、test、project規約から「状態変更ごとにHTMLを再生成する」という誘導をなくす。
- dashboardはstoreから要求時に描画し、手動再生成なしで最新状態と設計メモを表示する。
- bingoの`docs/bingo-gantt.html`とsidecarは、参照元を動的URLへ切り替えた後に廃止する。

### H1. bingo移送と公開smoke

- `docs/architecture/capacity-retest-plan.md`等に残る設計メモを、対応する未着手ToDoへ移送する。
- `retest-03-wave1-generator-clock`右ペインに、20回以上のmidpoint採取、50ms gate、単調時計利用が表示される。
- 残る未着手ToDoも、題名の言い換えではない実装方針を持つ。
- `https://lattice.kitepon.dev/projects/bingo/`で公開後smokeし、画面から3秒で詳細を読める。

## 受入条件

- 設計メモ無しの新規ToDo authoringがtyped errorで拒否され、store bytesを変えない。
- 空文字、空白だけ、file参照だけの設計メモを拒否する。本文`NO_PLAN`は受理し、右ペインにもそのまま表示する。
- `todo show`／`todo start`／ローカルGantt／公開dashboardが同じ設計メモを表示する。
- task noteが0件でも初期設計メモは表示され、noteがあれば追記情報として区別される。
- scratch copyからの`status`でregistryと公開配信元が変わらない。
- malformed extractionの独立した違反を一回のdry-runで確認できる。
- ToDoの状態変更後に個別HTMLを再生成しなくても、動的dashboardへ最新状態が反映される。
- CLI・project規約・handoffが`docs/*gantt.html`の生成をAIへ要求しない。
- bingoの既存未着手工程へメモを移送し、公開URLで実表示を確認する。
- focused test、関連test、`npm run check`を通す。Phase gateの`npm run ci`は、変更範囲と無関係な
  既知の`runtime-seam-transform.integration.mjs`失敗を分離して記録する。

## 実装結果（2026-08-01）

- plan create v4／todo extraction v3／plan v6・v7へ`design_memo`を導入し、空欄・空白・参照だけを拒否した。
  `NO_PLAN`だけは明示的な無計画として受理し、authoring promptを固定した。
- `todo show`、`todo start`、動的dashboard右ペインへ同じ設計メモを供給した。公開面では設計メモを表示し、
  append-only note本文とローカル絶対pathは表示しない。
- `migrate --dry-run --json`へboundedな複数違反、JSON pointer、expected／actual、digest、task ID、
  clock skew許容窓を実装した。unknown subcommand、invalid arguments、repo外inputもtyped errorに分離した。
- registry root衝突を`PROJECT_ROOT_CONFLICT`でfail-closedにし、明示的な`todo dashboard adopt --json`だけが
  配信元rootを移せるようにした。
- `todo verify`と`gantt serve`の結果を自己記述化し、reconciliationの意味、project scope、収載planを返した。
- `todo gantt`／`todo gantt status`／`--out`を`STATIC_GANTT_RETIRED`で拒否し、通常運用を
  `gantt serve`の動的dashboardだけへ一本化した。
- bingoの全10 ToDoへ元設計資料の内容を移送し、`docs/bingo-gantt.html`とsidecarを削除した。
  公開URLの右ペインで未着手工程の設計メモを実表示確認した。
- focused testは122件green、`npm run check`は134 files green。`npm test`／`npm run ci`は変更範囲外の
  既知1件だけが失敗する（`runtime-seam-transform.integration.mjs`: expected `seam_transform`,
  actual `intentional_serial`）。本改修に関係する失敗は残っていない。

## 非目標

- AIに設計文章を生成させる機能をLattice本体へ実装しない。
- 会話全文、秘密、credential、巨大logをToDoへ自動収集しない。
- 既存legacy planを読めなくする一括破壊を行わない。
- public dashboardへローカル絶対pathを表示しない。

## Rollback

- schema追加は旧readerの受理集合を変えず、新schemaの発行停止でrollbackできるようにする。
- registry衝突時は既存entry不変なので、旧挙動へ戻しても配信元の修復を不要にする。
- bingoへのメモ移送はappend-only note／versioned task contentとして履歴を保ち、削除で隠さない。
- 静的HTMLを除去する前に全参照を動的URLへ切り替える。rollback時は最後の静的artifactをgit履歴から
  復元できるが、二重運用へ自動で戻さない。
