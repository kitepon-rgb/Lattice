# 円卓×Lattice実行層統合 campaign（roundtable-exec-20260809）

構想の正本は[plan_roundtable-execution-layer.md](plan_roundtable-execution-layer.md)。本書はその構想を実装campaignへ
進める計画正本であり、目的・裁定・設計・非目標・罠・受入条件を所有する。task状態と依存の正本は
Lattice store（plan_key `roundtable-exec-20260809`）だけが持つ。

## 目的

実装済みの実行層（managed run・隔離worktree・実書き込み観測・hold/seam resolve/resume）を、実在の
外部消費者Peertableの円卓に消費させる。請求項1の並行実行制御部を実在の外部エージェントで体現し、
2026-08-08の円卓実戦で観測された摩擦6件を機械の面で解消する。

## オーナー裁定（2026-08-09・再議論しない）

1. **【撤回・2026-08-09夜】旧・案A（機械dispatch）は越権だった。** 当初の裁定「席をexecutor adapter経由で
   managed runのdispatchに載せ、claimを『dispatch結果の可視化・受諾表明』へ改訂する」は、実装後の実物
   （work orderが席へ降ってくる形）をオーナーが見て**撤回**された。理由: ①Latticeに作業指示の権限は
   元々与えられていない。作業を選ぶのは判断であり、AGENTS.md所有境界「推定・判断をLatticeの中へ
   実装しない」に自ら違反した ②Latticeからの指示は、円卓の本体である**メンバーの合議による作業**を
   消滅させる。指揮官も上下関係も無いことが円卓の魅力であり、機械dispatchはそれを潰す。
   誤りの起点は計画者（bell）が「特許体現に最も忠実なのは案A」と枠組みを提示したことにある。

   **正しいモデル（改・裁定1、2026-08-09深夜に再度精密化）**: **着手は許可制ですらない。**
   作業を選ぶのも始めるのもAI（席がready一覧から自分でclaimして取る——従来の円卓のまま）。
   Latticeへ伺いを立てる「謁見」の面を作らない——**着手前の許可gateも撤回対象に含む**。
   Latticeがやるのは**着手されたToDo同士の競合判定と、競合時のコントロールだけ**:
   ①競合したら片方に留まる指示を出す（hold・直列化） ②リファクタリングにより解消可能なら
   seam resolveさせ、解消後に両方を進める（請求項7/8/10がやっていることそのもの）。
   実行中の実書き込み観測・実行時競合検出は従来どおり。**隔離worktree・leaseは設備の供給
   （席が使うサービス）であって許可証ではない。** 既設の設備（worktree供給・lease・観測・
   hold/seam resolve/resume・landing・spool契約）は競合コントロールの設備として生きる。
   **死ぬのは向き**——run-bridgeの席選定と配車、machine側のtask割当、および着手を装置の承認に
   かける一切の形。組み替え（claim→着手→装置は競合を観測し介入だけする）はt19の中で卓が設計する。
   peertable決定25は改訂前の形（claimが割当の主体）が正しく、t9の改訂は再改訂する。
2. **線資源はフル実装** — 宣言語彙＋計画時交差判定＋実行時のdiff→錨→消費者波及まで
3. **着地チェック入れる** — run終端で未着地成果を「出すだけ・止めない」形で表示する汎用面
4. **円卓で回す** — 席はCodexを主力とし、Claude席がいてもよい
5. **線の統制原則** — 線の見方はLatticeがLatticeの見方（錨→diff→conflict/hold閉包という構造判定）で制御し、
   席はこれに従う。ただしこの制御は床であって天井ではない——AIが追加で行うこと（追加の線宣言、roomでの
   事前警告、自発的な直列化・調整）の柔軟性を装置が奪わない。AIの追加判断を禁止・検閲する面を作らない

## 中核設計: work-order spool方式【向きは撤回済み——改・裁定1を正とする】

**以下の記述のうち「Latticeがdispatchし、bridgeが席を選んで配車する」という向きは撤回された**
（改・裁定1）。誤りの型も記録する: 計画者が「並列実行＝中央がdispatchする」という**既存の
オーケストレーション・ハーネスの常識**を無意識に持ち込んだ。円卓は指揮官も上下関係も無いことが
本体であり、Latticeの正典自身が「判断を装置へ実装しない」と定めていた。**次にこの計画を読む者への
警告: 実行層の設計が「装置が割り当てる」へ向かい始めたら、それは設計ではなく慣性である。**
spool・隔離worktree・lease・観測・hold/seam resolve・landingの各設備は関所の設備として有効。
pull型（席がclaimした作業を持ち込む→Latticeが競合判定→worktree付与または hold/seam）への
組み替えはt19で卓が設計する。

- **Lattice新規** `src/runtime-work-order-controller.mjs`＋bin — 汎用「外部長寿命worker pool」向けadapter
  controller。雛形は`src/runtime-scripted-adapter-controller.mjs`。dispatchはconfig指定のspool dirへ
  `lattice.run_work_order.v1` を書き、observeはspoolの `lattice.run_work_report.v1`（外部workerが書く）を
  読んで、doneならLattice自身が`captureWorktreeDiff`でterminal receiptを構成する。**diffの正本はLattice観測**、
  workerの自己申告はstate遷移の合図のみ（請求項9の規律）
- **spool契約（wave 1の合意点・実装前に固定）**:
  - `lattice.run_work_order.v1`: `todo_id` / `worktree_path`（絶対path） / `base_sha` / `scope_writes` /
    `verifier_refs` / `forbidden_operations` / `packet_digest` / `order_digest`
  - `lattice.run_work_report.v1`: `packet_digest` / `state: working|done` / `worker_pid`
  - 置き場はこの2 schemaを持つ新module（`runtime-contracts.mjs`へは足さない——Phase 3のL5と書込交差させない）
- **peertable新規** `skill/scripts/run-bridge.mjs` — 非AI常駐（seat-status-bridge/wakeup-bridgeの作法・部品を
  流用、ADR 0157準拠）。spool監視→roomへ`[配車]`投稿→席へ作業指示注入→完了検出→reportをspoolへ
- **席は動かさない** — 席は自分のprojectに座ったままworktreeへ絶対pathで出入り。env・room接続・MCP解決が
  壊れない（構想文書の罠3の正面回避）。adapter寿命=run、席寿命=卓、spoolで疎結合
- **claim_mode整合** — `exact_minimum`は「runに載せるtodo集合」の様式でありLattice側変更ゼロ。割当は3層分割:
  task選択=Lattice / 席選択=bridge / 辞退権=席。roomプロトコル: bridge `[配車] tN→席` → 席 `[受諾] tN`
  （旧claimの改訂形）/ `[辞退] tN 理由`で再配車 → receipt結果をbridgeがroomへ

## 工程（taskの正本はLattice store。以下は散文と受入条件）

### Wave 1 — 一気通貫の部品（旧Phase 1）

#### t1 work-order adapter controller（Lattice）
`src/runtime-work-order-controller.mjs`＋起動bin＋spool契約module新規。scripted-adapter-controllerの
socket受理・lease検証・checkpoint観測を流用。**runtime-contracts.mjsへ書込まない**。

#### t2 observe長寿命化（Lattice）
`SCRIPTED_OBSERVE_TIMEOUT_MS=120_000`（runtime-cli.mjs:158）は実席の作業時間に耐えない。deadline到達で
runを殺さず`run resume`で観測継続できる形へ。**着手時に最初にdeadline到達後のrun store状態とrun resume
実挙動を実測する**（campaign最大の未知）。t1と同席推奨。

#### t3 run request synthesize CLI（Lattice）
`lattice run request synthesize` 新規公開面。`synthesizeWitnessRunRequest`（todo-independence-contracts.mjs:130、
既在）をCLIへ露出するだけ。runtime-cli.mjsを触るのでt2の後。

#### t4 run-bridge.mjs（peertable・越境）
spool監視・`[配車]`投稿・席への注入（worktree絶対path＋env prefixはbridge側の知識）・完了検出・report書き出し。
seat-status-bridge.mjs/wakeup-bridge.mjsの部品流用。teardownで確実停止。

#### t5 席プロトコル文書（peertable・越境）
member.md/SKILL.mdへ: work order受領→`[受諾]`→worktree絶対pathで作業→commit可（detached HEADの子孫）・
禁止操作（FORBIDDEN_OPERATIONS）→完了宣言。

#### t6 setup拡張（peertable・越境）
`run adapter register`（host_binary=Lattice側bin＋config_refのspool設定JSON）とspool dir用意をsetup.shへ。

#### t7 Wave 1受入: 1席1task一気通貫（両repo・親立会い）
受入条件: ①adapter registry非空 ②1席の卓で run start→activate→`[受諾]`→worktree実変更→receipt_accepted→
run close が公開CLI JSONだけで追える ③observed diffが席の実書き込みと一致・canonical treeはclean
④席のroom接続・MCPが無傷。

### Wave 2 — 全席拡大＋claim役割改訂（旧Phase 2）

#### t8 bridge複数席配車（peertable・越境）
idle選定（seat-status-bridgeのbusy判定流用）・辞退→再配車・`run observe` polling→room可視化。

#### t9 決定25改訂の正典追記（peertable・越境）
docs/plan.mdへ新決定、憲章/member.mdのclaim節を受諾表明プロトコルへ。

#### t10 run observe出力の進行中要約（Lattice・要否確認）
現出力で足りる可能性が高い。足りれば「不要と確認した」evidenceで閉じる。

#### t11 Wave 2受入（両repo・親立会い）
受入条件: ①2席以上3task以上でconflict対が同時dispatchされない（event chainのdispatch_decided）
②`invalid_start_transition`レースゼロ ③同一file書込2taskで片方が待つ実測。

### Wave 3 — 線資源フル実装（Wave 1/2と別席群で同時進行可）

#### t12 contracts: lines語彙（Lattice）
witness set **v5** / run_request **v5** / boundary manifest **v3** へ新field `lines`:
`[{ line_id, role: writes|reads, anchors: [{kind: path|symbol, ...}] }]`。版管理はCREATES_SCHEMASパターン
（todo-independence-contracts.mjs:18-38）とruntime-contracts.mjsのallowCreates分岐(:312)を踏襲。
v4以前は無変更でvalid。

#### t13 計画時の線交差判定（Lattice）
`compileRuntimePlanV1`（runtime-front-end.mjs:435）のread/write交差(:626-643)直後にlineGroups: 同一line_idに
writes×readsが別todoならconflict kind `line` を実体化。severabilityは`line→'serial'`。`boundaryPathsOf`
（todo-independence.mjs:122）へ錨pathを合流。

#### t14 実行時の線変更観測（Lattice）
`detectCheckpointFindings`（runtime-diff-observer.mjs:263）と`classifyObservedDiff`
（runtime-decision-verifier.mjs:126）へ**独立二重実装**で新finding `observed_line_change`。既存の
conflict_found→intake_frozen→hold閉包へ乗せ、線のreader（消費者run）がhold閉包に入る。symbol錨はpath近似で開始。

#### t15 線の宣言運用（peertable・越境）
SKILL.md/witness生成手順へ書式（SSE event種別等をline_id＋錨で宣言する実例）、実planで1本宣言。

#### t16 線資源integration test（Lattice）
摩擦5形のfixture（path非交差2task・片方が線の錨に触れる）で「宣言あり→計画時conflict」
「宣言なし→実行時finding→消費者hold」両経路。雛形はtest/integration/hold-transform-resume.integration.mjs。
受入条件: 両経路green＋既存全witness set（v4以前）が無変更でcompile通過。

### Wave 4 — 着地チェック（Wave 1完了後いつでも）

#### t17 run landing（Lattice）
`lattice run landing --run <ref>` read-only投影（runSeamProfile:1296と同パターン）。accepted receiptの
head_shaごとに`git merge-base --is-ancestor`、repoレベルで`rev-list --count @{push}..HEAD`（upstream無しは
`no_upstream`状態値）。出力`lattice.run_landing_report.v1`、exit code常に0。`run close`出力へ同blockを同梱
（CLI層に置く。engineにgitを触らせない）。

#### t18 監査手順・teardownへのlanding読み出し（peertable・越境）
受入条件: 未pushのままcloseしたrunでlanded:false・未push本数が出て、exit 0のまま。

### Wave 5 — 実戦投入・正典更新・出荷

#### t19 実戦投入（両repo・親立会い）
実campaign 1本をmanaged run経由の円卓で完走→evidence両repoへ。摩擦1〜6が機械の面で再発しないことを
roomログとevent chainで突き合わせる。

#### t20 Lattice正典更新・出荷
00_product-contract.mdの消費面記録を実態へ更新（面の追加ではない）・CHANGELOG・npm publish・global install確認。

#### t21 peertable正典更新・出荷（peertable・越境）
決定追記・npm publish・実機確認。

## 是正Wave — roundtable-redirect-20260809（改・裁定1の向き直し）

旧裁定1の撤回（改・裁定1）に伴う組み替え。t19へ含めない——gate taskを膨らませない
（本campaign自身の実測: t7の5回膨張・[plan_todo-scope-expansion.md](plan_todo-scope-expansion.md)）。
task状態の正本はLattice store（plan_key `roundtable-redirect-20260809`）。

#### r1 pull型への組み替え: Lattice側（Lattice）
装置起点の配車を廃し、席が自分で選んだ着手を持ち込む口へ組み替える。装置がやるのは着手済みToDo間の
競合判定と介入（hold・直列化・seam resolve→resume）だけ。隔離worktree・leaseは設備の供給であって
許可証ではない。着手前の許可gateを作らない。口の具体設計は実装者が持つ（改・裁定1が制約の正本）。

#### r2 pull型への組み替え: run-bridge・member.md（peertable・越境）
run-bridgeから席選定と配車を撤去し、席の着手をLattice側の口へ写す中継へ。member.mdの
「配車で来た仕事」節を向きごと書き換える（作業は自分で選ぶ・装置は競合時にだけ介入してくる）。

#### r3 決定25の再改訂（peertable・越境）
t9の改訂を巻き戻す: claimは割当の主体のまま（従来の円卓）。決定63（相互独立）と整合させ、
撤回の経緯を決定として残す。

#### r4 是正Wave受入: pull型で1 task一気通貫（両repo・親立会い）
受入条件（実測）: ①席が自分でclaimして着手し、装置への伺いなしにworktree（設備）を得て作業できる
②着手済み2 ToDoの競合を装置が検出し、片方に留まる指示または seam resolve→両方再開が動く
③「装置が作業を割り当てる」面がどこにも残っていない（bridge・member.md・room発言の形式まで）。

## 申し送りWave — roundtable-carryover-20260809（本campaignの残債）

本campaignの各監査が「修正を求めない申し送り」として残したものをToDoへ落とした。

**t19の実戦題材ではない。** 当初はそう位置づけていた（オーナー裁定・bell [708] の(b)）が、
その裁定は`scope-split-20260809`へ差し替えられた（[plan_todo-scope-expansion.md](plan_todo-scope-expansion.md)の
「工程」節）。したがって本Waveは**題材から外れた残債**であり、t19やredirectをblockしない。
実行時期は未定で、pull型が整った後に他のcampaignと同じ扱いで消化する。
**小さく独立revert可能な単位**で切ってあるのは変わらない。

**repoごとに別planへ分ける。** 1 run・1 worktreeは1 repoなので、混在planは新pull実戦の境界を偽る。
Lattice側の状態正本はLattice storeの`roundtable-carryover-20260809`、peertable側は
peertable storeの同名planが持つ（別project_idなので衝突しない）。

#### k1 前景駆動器が何を待っているかを外から見えるようにする（Lattice）
`run activate`はrun全体の前景駆動器で、ready frontierが空になるまで戻らず、その間 進捗を一切出さない。
外形（lifecycle lock保持・control ledger `in_progress`・CPUゼロ）はhangと区別が付かず、実際に
t19-live-1で誤診が起きた（pid停止とlock削除を実行手順へ載せる寸前まで進んだ）。`run observe`／`run status`へ
`driver_state`と`waiting_on`をtypedで出し、helpにも「activateは全wave完了まで戻らない前景駆動器」を書く。
文言追加だけでは足りない——**別processから待ち状態が読めること**が受入条件である。

#### k2 schema世代差をtyped `unsupported version`として診断する（Lattice）
旧installがwork-order入りrun storeを読むと`INVALID_RUN_STORE`としか言わず、原因に辿り着けない
（t7申し送り⑤）。**既に配布済みのbinaryを新版から直すことはできない**ので、対象は今後の世代差だけとする:
期待versionと更新手順を含むtyped診断を出す。t20 publishより前のdependency。
旧installの検知とupgrade案内もLattice製品の診断・更新契約であり、本planのk2に含める。
dotagentsへ製品内の更新経路や診断を正本化しない。

**別planへ分けたもの**: accepted predecessorのheadを後続worktreeのbaseへ継承する設計課題。
`ensureScriptedWorktree`は現packetのbase_shaから木を作るため、依存順を守っても後続は先行成果を見ない
（t19bで実測）。intakeの形を変えても直らない**worktree供給のbase設計そのもの**であり、複数head統合・
競合・successor base再束縛の裁定が要る。`receipt-lineage-successor-base-20260809`として分ける。

**条件付きで保留したもの**: `run request synthesize`のadapter固定（t7申し送り④）はr1完了後に再測定し、
pull startで実害が残る時だけ起票する。spoolのorder/reportがrunを跨いで残る件（t7申し送り③・close後も
6件残存を実測）はr2完了後に再測定する——今起票すると撤去対象を直すことになる。

**起票しないと決めたもの**: requestにもwork orderにも自然言語の欄が無い件は、課題ではなく所有境界の
帰結である（推定・判断・文章生成をLatticeへ実装しない）。pull型では席が自分でtaskを選ぶので、
「配られた仕事の中身を知らない」状況そのものが起きない。Decisionとしてのみ記録する。

## 実装時に確認（unknownとして残す）

1. t2のobserve再開経路（deadline到達後のrun store状態とrun resume実挙動）— Wave 1冒頭で実測
2. work-order controllerのworker_process identity（dispatch応答の`direct_os_observation_binding`とCLI席のpid名指し）
3. run実行中の`todo start/done`二重帳簿（Wave 1-2は席が従来通り打ち、doneの--evidenceへreceipt digest。統合要否は実測後）
4. hold閉包が`observed_line_change`のtodo_idsを閉包種に受けるか（runtime-hold-recompile.mjsの入力shape）
5. seam resolveがline kindを受けた時の裁定（Wave 3はserialへ倒す想定）
6. worktree置き場（.lattice/runs/配下）と消費者契約の文言整理（「storeファイル直読み書き禁止であって
   worktree内作業は契約内」を一行明記）

## 非目標

- 会話・claim・判断をLattice内へ実装しない
- Latticeのコードにpeertableを指す語を入れない（面はすべて汎用の実行層の面として設計する）
- claim_modeのschema変更をしない
- standalone modeは対象外。ただし**相互独立は恒久要件**（オーナー裁定 2026-08-09・peertable決定63）——
  Latticeは単独で動き、Peertableも単独で動く。統合は第3の縮退段（opt-in）であり、t9/t21の正典改訂で
  単独モードのclaim協定を削らない。配車（spool・run-bridge）を必須経路にしない

## 罠

- plan_backlog.mdは経過記述と現況表が同居している。現況表が正
- 実行層の面は`.lattice/runs/<id>`を持ちstoreとは別資産。消費者の観測は公開CLIとversioned JSON経由に限る
- 円卓の席は`PEERTABLE_*`/`.mcp.json`構成で、working directory移動で壊れる——だから席を動かさない設計
- Wave 1（cli/controller系）とWave 3（contracts/front-end/observer系）は触るファイルが交差しない設計だが、
  t1のspool契約moduleをruntime-contracts.mjsへ足すと交差が生まれる。新module分離を守る
- ADR 0157: 常駐（run-bridge）の生死を1枚のfileで持たない

## 検証

- focused testは変更ごと、`npm test`/`npm run check`は受入時、`npm run ci`はWave gate
- Wave受入（t7/t11/t16/t18/t19）はすべて実daemon・実席・実worktreeでの実測。unit greenを実測の代わりにしない
