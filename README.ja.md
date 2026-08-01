<p align="center">
  <img src=".github/og.png" alt="Lattice — 見かけだけの競合で作業を直列化しない" width="100%">
</p>

# Lattice

[kitepon.dev](https://kitepon.dev/)を運営する[クオ（@QLyun35332）](https://x.com/QLyun35332)が開発・メンテナンスしています。

[![npm](https://img.shields.io/npm/v/@quolu/lattice?color=cb3837&logo=npm)](https://www.npmjs.com/package/@quolu/lattice)
[![CI](https://github.com/kitepon-rgb/Lattice/actions/workflows/ci.yml/badge.svg)](https://github.com/kitepon-rgb/Lattice/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![node](https://img.shields.io/node/v/@quolu/lattice?color=339933&logo=node.js&logoColor=white)](https://nodejs.org/)
[![patent](https://img.shields.io/badge/patent-pending%20JP%202026--178950-6366f1)](#特許)

[English](README.md) · **日本語**

> **見かけだけの競合で、作業を直列化しない。**
> Latticeはmulti-agent開発のためのschedulability compilerです。codebaseの実際の境界を観測して
> どのtaskが並列に走れるかを裏付け、本当に衝突している場合は**その境界をrefactorして
> planを再コンパイルし、並列に走れる形へ変えます**。

## なぜ要るのか

3つのagentに3つのtaskを渡すと、たいてい次のどちらかで失敗します。

- **直列にしすぎる。** 「どちらも`renderer.ts`を触るから順番に」——実際には*別々のsymbol*を
  触っていて、同時に走れたかもしれない。
- **直列にしなさすぎる。** 依存を誰も宣言しなかったので並列で走らせ、両方が書いた後で衝突に気づく。

どちらも原因は同じで、**誰も境界を実測していない**ことです。task listの依存線は意図の主張であって、
codeについての証拠ではありません。

Latticeはここを違う手で塞ぎます。競合を**検出する**だけでなく**取り除く**。2つのtaskが1つのfileを
奪い合っているなら、切り方を導出し、隔離worktreeで適用し、五条件で検証し、変換後のsourceに対して
planを再コンパイルします。共有面が共有でなくなるので、競合辺そのものが消えます。

### 実例（このrepo自身）

2つの工程がどちらも`src/seam-commit.mjs`を変更する必要がありました。Latticeは宣言をcompileして
`conflict_count: 1`・`severability: code_seam`と判定し、切り方を提案し、隔離worktreeで適用。
五条件をすべて満たしたので、fileは工程ごとの所有面＋共有面＋残余面へ分割されました。
再コンパイルは`conflict_count: 0`を返し、両工程は同じparallel groupに入りました。

人が手で切ったのではありません。**工程を並列化するために製品が切りました。**

### 作業記憶はToDoと一緒に渡る

AIは、次の担当が作業を続けるために必要な方針、棄却案、調査結果、注意、未解決事項をToDoへ追記できます。
通常の`lattice todo show`と、成功するすべての`lattice todo start`は、元version／元task、訂正状態、
note chain head、overflow、全履歴コマンドを含む最新のbounded `note_context`を自動で返します。
次のAIが別のnote読取コマンドを知っている必要はありません。

```bash
lattice todo note --plan <key> --task <id> --message "既存parserを使い、fallbackは追加しない"
lattice todo show --plan <key> --task <id> --json
```

ローカルGanttでは、選択したToDoの右ペインへ同じ作業記録を表示します。公開Gantt／dashboardは契約として
note本文を含めません。

### 変換の受入五条件

**5つすべて**を満たしたときだけ採用します。1つでも欠ければ棄却です。

| 条件 | 意味 |
|---|---|
| `behavior_equivalent` | 原pathの公開export面が保たれ、移した先が残余面のsymbolへ束縛なしで言及していない（切断参照の網） |
| `focused_tests_passed` | 影響testが変換後のsourceで実際に通る |
| `sensor_fresh` | 構造索引を取り直し、新しい面を収載している |
| `overlap_reduced` | 対象の競合が消え、**かつ**plan全体の競合対が増えていない |
| `parallelism_improved` | 実行段階数が減っている |

### 実行段階の二段構え

計画時に完全な分断は原理的に得られません（動的dispatch・実行時に決まるpath・外部状態）。
そのため実行中は宣言でなく**実際に変更された資源**を観測し、宣言scope外への書き込みや
進行中の他工程のscopeとの重なりを実行時競合として挙げます。処置は「一方をholdして他方を
確定→再開」か「双方停止→seam変換→双方再開」の二択で、どちらも実storeに対する
integration testで一気通貫に検証済みです。切断の重さは`lattice run seam profile`
（計画時は`todo seam-profile`）が数えられる事実だけで投影し、機械変換の可否は「確実の門」が
typed理由つきで分類します——宣言を直せば通るのか、操作AIへ渡すべきなのかまで返します。

## 所有境界

本repoはplan／ToDo／run store、Lattice sensor、schema、migration、release、diagnosticsを
所有します。[dotagents](https://github.com/kitepon-rgb/dotagents)はkitepon.devを支える内部
toolchainであり、製品横断の工程利用・導入・host統合を所有します。
廃止済みの前身sensorは独立製品として配線せず、Lattice sensorだけを現役面とします。
MarkItDownは別区分の第三者CLIです。

現在の工程状態と完了証拠の正本は、このrepoのLattice storeです。文書の役割と現行導線は
[docs/README.md](docs/README.md)、製品思想は[PLAN.md](PLAN.md)、公開contractは
[docs/00_product-contract.md](docs/00_product-contract.md)を参照してください。

CLIの全体像は`lattice --help`、各公開namespaceの正規構文は
`lattice <plan|run|event|todo|sensor|factory-diagnostics|runtime-errors|bridge> --help`で確認できます。
個別操作は`lattice <namespace> <subcommand> --help`または`lattice help <namespace> <subcommand>`で
正規optionをstore非依存に確認できます。

## 開発

```bash
npm test
npm run check
npm run ci
node scripts/reap-orphan-test-daemons.mjs
lattice sensor sync . --json
spotter doctor
codex-sidecar diagnostics --project . --preset auditor --json
```

`reap-orphan-test-daemons.mjs`は、実daemonを起動するtestが取り残したprocessを一覧します。既定は表示
だけで何も停めません。停めるのは`--reap`を付けた時に限り、対象はargvが指すfixtureのdirectoryが既に
存在しないものだけです。実行中のtestを巻き込まないための条件なので、fixtureが残ったまま死んだ実行を
含めたい場合だけ`--older-than-hours=<n>`で起動時刻による許可を明示します。

未初期化projectで`sensor sync`した場合は`LATTICE_SENSOR_NOT_INITIALIZED`と正規`next_action`を返します。
その他のsensor失敗もexit code、signal、bounded stderrをtyped detailへ残し、原因を隠しません。

Node.js 22.13以上を使用します。境界観測は配布物に同梱したLattice sensorだけを使い、PATH上の
廃止済みruntimeや旧cache/dataへfallbackしません。Spotterはproject単位で生成stateの所有境界を守ります。

どのrepoでも、Latticeの導入状態はdirectoryの有無を推測せず、最初に次のtyped discoveryで判定します。

```bash
lattice status --json
```

`state`は`uninitialized | ready | active_run | invalid`のいずれかです。`uninitialized`は
正常な未初期化状態で、`next_action`が正規の初期authoring入口を返します。初回planは
新規planはPhase監査とToDo schedulingを分離し、全ToDoに設計メモを持つ`lattice.plan_create_input.v4`のcanonical
JSON+LFを用意し、次で作成します。既存v2/v4は互換契約として維持されます。

```bash
lattice plan create --schema-version 4 --json
```

```bash
lattice plan create --input .lattice/plan-create.json
```

`invalid`をMarkdown fallbackへ丸めず、`next_action`に従ってstoreを診断してください。
discoveryと初期transactionの不変条件は
[ADR 0058](docs/adr/0058-project-discovery-and-initial-authoring.md)が正です。

## 実行runを端から端まで動かす

compileしたrunを実際にdispatchするには、executor adapterを登録してからactivateします。
参照実装の`lattice-scripted-adapter`を配布しているため、公開CLIと配布binだけで
実write・receipt受理・closeまで到達できます。

```bash
lattice run adapter register --schema --json     # 登録入力のJSON Schema
lattice run adapter register --input adapter.json
lattice run adapter list --json
lattice run activate --run .lattice/runs/<id>
lattice run status --run .lattice/runs/<id>      # accepted に子が入る
lattice event verify --run .lattice/runs/<id>
lattice run close --run .lattice/runs/<id>
```

digestは手で計算しません。binary・config・capabilities・自己digestは登録時にCLIが導出します。

`plan compile`が`BOUNDARY_UNKNOWN`を返す場合は、まず`git status --short`が空かを確認してください。
未追跡ファイルがあるとsensor statusが`stale`になり、witnessが未解決unknownへ落ちます。
作業ツリーをcleanにすると同じrequestがそのまま通ります。

TODO工程storeの読取は`lattice todo status`、`compile_binding`付きTaskの投影は
`lattice todo bindings`、検証は`lattice todo verify`、表示は動的dashboardを使います。
個別HTMLの生成や再生成は不要です。topology/source reconciliationは
`lattice todo revise --plan <key> --input <canonical-revision.json>`、Phase付きplanは
`lattice todo revise-phase --plan <key> --input <canonical-phase-revision.json>`でsuccessor発行します。
cross-plan topologyを同時に切り替える場合は
`lattice todo revise-set --input <canonical-revision-set.json>`を使い、Phase revisionを含む集合は
`lattice.todo_revision_set.v3`で通常revisionと混在できます。
Phase付きv5 planでは、通常ToDoの開始順はToDo DAGだけで決まり、Phase前後関係は重監査の順序だけを
制御します。特定ToDoがPhase受理を本当に必要とする場合だけ`phase_accept_dependencies`で明示します。
`lattice todo status --json`の`dispatch_frontier`はready全件を同時dispatchする既定を示します。
readyが複数なら最初のstartに`--parallel-frontier`を付けます。subsetだけを直列着手する場合は
`--override-reason <reason>`で理由を残しますが、**その申告は一度突き返されます**。

```bash
lattice todo start --plan <key> --task <id> --parallel-frontier
lattice todo start --plan <key> --task <id> --override-reason <reason> --serial-confirmed
```

直列の申告に対して`PARALLEL_DISPATCH_RECONSIDER`を返し、並列の再検討を促してから、
同じ理由に`--serial-confirmed`を付けた再実行だけを通します。規則を文書へ書くだけでは
読み飛ばされるため、再考をコマンドの往復で強制する設計です。**足止めは一度だけで、
再実行すれば直列で進みます。**

ただし理由が**実際の干渉を述べていない**場合——「単一セッションだから」「逐次実行するので」
のようにworker数・セッション構成・作業者の都合を述べただけの場合——は
`PARALLEL_DISPATCH_INVALID`で拒否し、`--serial-confirmed`を付けても通しません。
実行主体が1つしか無いことは並列にできない理由ではない（必要ならworkerを増やす）ためです。
「両taskが同一fileへ書き込む」のような干渉を書けば、再確認を経て通ります。

**同じ検査を計画時点にも掛けます。** 着手時だけを締めても、planそのものが直列に組まれていれば
並列は生まれません。`lattice plan create`と`lattice todo migrate`は依存グラフから
`dispatch_shape`（`task_count`／`critical_path_length`／`max_frontier_width`／
`serialization_ratio`）を計算して結果へ載せ、直列度が閾値を超えるplanを一度突き返します。
再考した上でなお直列でよいなら`--serialization-reviewed`を付けて再実行します
（6 task未満のplanは対象外）。判定はstore書込みの前に行うので、拒否された時にstoreへは
何も書かれません。

```bash
lattice todo migrate --input <extraction.json> --serialization-reviewed
```

`--parallel-frontier`はhostへ並列dispatch方針を宣言する開始gateです。Lattice自身がAI hostのagentを
起動するものではなく、実際のdispatchはhostが行います。宣言後もready全件が着手されたかは
`active_set`と`next_ready`で観測できます。
ToDo完了は軽量確認までで、所属ToDoが全てdoneになったPhaseは`gate_ready`となり、`todo phase review`後に
required evidenceを束縛した`todo phase accept`で重監査の判断を記録します。監査回数やPhase数を自動追加する
機能ではありません。

**監査の既定は「有り」です。** phaseを持たないplanも終端に重監査が要ります（予約Phase
`terminal-audit`を暗黙に1つ持ちます）。全taskがdoneになった状態は「完走」ではなく`gate_ready`＝
**監査待ち**であり、工程図のlive scopeはそのplanのToDoを畳みません——完走扱いで図から消えることが
「閉じた」の可視表現なので、監査の記録なしにそこへ行かせません。作成時に拒否はせず、
`todo migrate`／`plan create`の結果と最後のdoneのadvisoryで`terminal_audit_required`を通知します。
**終端監査はToDoのdispatch可否へ影響しません**（Phaseは重監査の順序だけを制御し、開始順はToDo DAGが決めます）。
規約は[ADR 0147](docs/adr/0147-audit-is-on-by-default.md)が正です。

```bash
lattice todo phase status --plan <key>   # phase無しplanでも暗黙Phaseを返す（implicit: true）
lattice todo phase review --plan <key> --phase terminal-audit --reason <text>
lattice todo phase accept --plan <key> --phase terminal-audit --input <file>
```

**過去の工程は監査できません。** 監査対象のコードが既に変化しているためです。そこで
「監査なしで閉じた」という状態を別に持ちます——`accepted`（監査を通った）へは絶対に化けず、
記録は永久に区別できます。工程図では畳まれるので監査待ちの札は外れます。

```bash
lattice todo phase close-unaudited --plan <key> --phase terminal-audit --reason <text>
lattice todo phase baseline --reason <text> --except <監査したいplan_key>   # 一括
```

一括の入口は、現在監査待ちで一度も監査に触れていないPhaseだけを対象にします。**自動では
実行しません**——どれを監査し、どれを歴史として畳むかは人が決め、Latticeは宣言を受け取って
記録するだけです。`--except`は「最近の作業でコードも生きているので本当に監査したい」planを
残すための口です。規約は[ADR 0148](docs/adr/0148-history-closes-unaudited-not-audited.md)が正です。

誤ってphase無しで作ったplanへ後からPhaseを被せる場合は、`revise-phase`の
`state_policy: acquire_phase`でdone状態を保ったまま獲得できます（未割当→割当の向きだけを許し、
既にphaseを持つtaskの付け替えは拒否します）。

契約のJSON Schemaは各入口から取れます。入力が合わないときは、違反フィールドのpathが
error detailの`violation_path`へ載ります（配列のソート違反は`/tasks/1`のようにindexまで名指しします）。

```bash
lattice plan create --schema --json            # 既定は最新v4
lattice todo revise-phase --schema --json
lattice plan show <plan_key> --json            # planのtask・依存・phase・状態を1コマンドで読む
```Phase状態は
`lattice todo phase status --plan <key>`、閲覧中に進捗が更新される工程表は
`lattice todo gantt serve --port 0`で確認できます。live viewerはloopback-only、read-onlyで、
`/projects/<project_id>/`というproject固有URLを返します。別projectからそれぞれ起動すれば、独立port・独立SSE経路で同時表示できます。
session開始時のtyped discoveryで使う`lattice status --json`と、actor環境変数を持つ通常のTODO操作は
active projectを自動登録し、一つのloopback dashboard daemonを再利用します。
`/projects/`の一覧からproject固有の工程図を開け、各projectのSSE更新は互いに分離されます。
dashboardはmanifestのfile identityが変わらない間のstable store readを再利用します。
巨大工程図のrender中にhealth応答が遅れても、生存中dashboardを新daemonで置き換えず
`DASHBOARD_DAEMON_UNRESPONSIVE`としてtyped拒否します。
最近のsession activityが期限切れでも、Lattice storeの`active_set`が非空なprojectは一覧へ残ります。
長時間の外部処理中にCLI呼出しが途切れても進行中projectを休眠扱いしません。
LANや外部reverse proxyから閲覧するoptional bridgeは既定で無効です。明示したIPにだけbindする初回設定、
再設定、停止方法は[bridge setup](docs/bridge-setup.md)を参照してください。reverse proxy hostへsshで
到達できる場合は、LANへbindせずloopbackだけを逆トンネルで公開する構成も選べます。
工程図の既定表示は、後続に作業中・未着手が残っていない完了工程を図から除きます。まとめnodeも置かないため、
完走したplanは図の場所を取りません。除いた工程は凡例の件数、右ペインの「全工程」一覧、各工程の詳細から
辿れ、詳細の前提・後続は除外前の依存関係を示します。総数・進捗・最長依存鎖は除外前の全工程で数えます。
凡例の件数バッジを押すと全工程を描いた図へ切り替わります。表示規約は
[ADR 0066](docs/adr/0066-gantt-live-scope-drops-finished-work.md)が正です。

右ペインは概要・選択工程・全工程の3面で、いずれもToDo storeを表示します（元plan Markdown本文は
再表示しません。元文書へは各工程の詳細が持つ行対応から辿ります）。全工程一覧は動いているplanを
最終活動の新しい順で上に、全工程が図から外れた完走planを古い順で下にまとめ、plan内は登録順です。
決着済みPhaseと図から外した工程は既定で畳み、開けば読めます。規約は
[ADR 0067](docs/adr/0067-right-pane-shows-the-store-and-orders-by-activity.md)が正です。

`lattice todo gantt`と`lattice todo gantt status`による静的工程表は廃止済みで、呼ぶと
`STATIC_GANTT_RETIRED`が動的dashboardを案内します。
dashboard daemonは起動時に読み込んだ版数をhealthで名乗り、installされた版と食い違えば`lattice status`の
たびに新版daemonへ置き換わります。publishしただけで配信面が古いまま残ることはありません。
入れ替えは新daemonが登録済み全projectのstoreを読み終えるまで待つため、`lattice status`の応答が
その間伸びます（実測: 8 project登録で約50秒台）。待ち時間は固定秒数ではなく、spawnした子が生きている
間だけ待ち、子が死ねば即座に`DASHBOARD_DAEMON_UNAVAILABLE`を返します。既定120秒の上限は、応答を
返さない子に対するbackstopであって正常な起動時間の見積りではありません。
状態を書き込む`start / block / unblock / done / evidence promote / reopen / revise / revise-phase / revise-set`
では、監査actorとして次の3環境変数をすべて設定してください。

```bash
export LATTICE_TODO_ACTOR_HOST=<host-id>
export LATTICE_TODO_ACTOR_SESSION=<session-id>
export LATTICE_TODO_ACTOR_AGENT=<agent-id>
```

不足またはidentifierとして不正な値がある場合、mutationはstoreを変更せず`ACTOR_UNRESOLVED`を返します。
error detailの`missing_environment`／`invalid_environment`と
`next_action: set_required_actor_environment_and_retry`を確認し、正規値を設定して同じ操作を再試行してください。

正確なargv、evidence descriptor、result wireは
[ADR 0056](docs/adr/0056-todo-authoring-transitions.md)を参照してください。

## 特許

本repositoryの設計は日本国特許出願の対象です。

| | |
|---|---|
| 出願番号 | 特願2026-178950 |
| 出願日 | 2026-07-27 |
| 発明の名称 | 情報処理装置、ソフトウェア開発制御方法及びプログラム |
| 請求項 | 12項 |

非商用利用は下記Licenseの範囲で許諾します。
**商用利用には別途の商用ライセンスが必要です。**

## License

**[PolyForm Noncommercial License 1.0.0](LICENSE)** — 非商用利用は無償です。

- **無償:** 個人のproject、学習・研究、趣味やアマチュアの制作、慈善団体、教育機関、
  公的研究機関、政府機関
- **許諾が必要:** 商用利用。Lattice自体を再配布するかどうかに関わらず、企業の業務や製品の
  中で使う場合を含みます

**商用利用には**、別途の商用ライセンスが必要です。
問い合わせは[kitepon@gmail.com](mailto:kitepon@gmail.com)へのメールで受け付けます。
許諾するかどうか、どのような条件にするかは個別に判断します。

同梱の構造sensor（[`sensor/`](sensor/)）は本repositoryへ吸収した第三者成果物で、
**MIT License**のままです。upstreamの出自と帰属表示は[`sensor/NOTICE`](sensor/NOTICE)、
license本文は[`sensor/LICENSE`](sensor/LICENSE)が持ちます。上記の条件はこれを変更しません。

© 2026 quolu (kitepon-rgb)
