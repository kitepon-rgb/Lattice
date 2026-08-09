# 円卓×Lattice実行層統合 campaign（roundtable-exec-20260809）

構想の正本は[plan_roundtable-execution-layer.md](plan_roundtable-execution-layer.md)。本書はその構想を実装campaignへ
進める計画正本であり、目的・裁定・設計・非目標・罠・受入条件を所有する。task状態と依存の正本は
Lattice store（plan_key `roundtable-exec-20260809`）だけが持つ。

## 目的

実装済みの実行層（managed run・隔離worktree・実書き込み観測・hold/seam resolve/resume）を、実在の
外部消費者Peertableの円卓に消費させる。請求項1の並行実行制御部を実在の外部エージェントで体現し、
2026-08-08の円卓実戦で観測された摩擦6件を機械の面で解消する。

## オーナー裁定（2026-08-09・再議論しない）

1. **案A確定** — 席をexecutor adapter経由でmanaged runのdispatchに載せる。peertable決定25（会話claim＝割当）は
   「dispatch結果の可視化・受諾表明」へ改訂する。段階は「1席で1task一気通貫→全席拡大」
2. **線資源はフル実装** — 宣言語彙＋計画時交差判定＋実行時のdiff→錨→消費者波及まで
3. **着地チェック入れる** — run終端で未着地成果を「出すだけ・止めない」形で表示する汎用面
4. **円卓で回す** — 席はCodexを主力とし、Claude席がいてもよい
5. **線の統制原則** — 線の見方はLatticeがLatticeの見方（錨→diff→conflict/hold閉包という構造判定）で制御し、
   席はこれに従う。ただしこの制御は床であって天井ではない——AIが追加で行うこと（追加の線宣言、roomでの
   事前警告、自発的な直列化・調整）の柔軟性を装置が奪わない。AIの追加判断を禁止・検閲する面を作らない

## 中核設計: work-order spool方式

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
