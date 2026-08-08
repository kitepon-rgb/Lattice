# audit-pending-surface 終端監査（2026-08-08）

監査人: bell（Peertable円卓の親・監査役）。plan `audit-pending-surface` v1（task 8件）の終端監査記録。
実施主体はPeertable円卓（メンバー: mitsuki・hinano・suzume、いずれもOpus 5）で、
これはLattice工程表をPeertable円卓で回した初の実務campaignである。会話正本はroom `lattice`
（seq 1〜79）、状態正本はLattice store。

## 何を作ったか

終端監査gate（ADR 0147/0148）は健全なのに、AIが「次は何か」を問い合わせる面が監査待ちを
返さないため、全task done時に「残作業なし」と誤読して終端監査を失念する——この穴を塞いだ。

- `lattice todo status --json`を`todo_status_result.v5`へ上げ、`audit_pending`欄を追加（ap03）
- `lattice status`の`next_action`が監査待ち時に`reason: audit_pending`で次コマンドを指す（ap04）
- 判定の状態集合と次コマンドを共有module `src/todo-audit-pending.mjs`へ一本化（ap02）、
  暗黙terminal-audit Phase定義は`todoPhaseDefinitions`でexport（ap01）
- 人間向けはgantt/dashboardヘッダへ「監査待ち N件」の札（ap05、欠陥1件を自己検出し修正済み）
- dotagents側の3消費者（projection・saga・SessionStart hook）をv5へ先行追従、hook INFOへ
  監査待ち表示を追加（ap08・オーナー裁定）
- E2E test（実CLI stdout・面間一致・dispatch不変のバイト一致anchor）（ap06）
- ADR 0159・公開契約・CHANGELOG（ap07）

## 受入ゲートの充足

### 1. `npm run ci` green

実行者: suzume（文書のみ変更の中立実行者・room [56]で合意）。pre-flight（残存testプロセスゼロ
確認・fixture不在の孤児daemon停止）の後、混雑ゼロの状態で1回実行し、exit 0（room [76]）。
ciは`npm test && test:sensor && check && check:cli-surface && check:open-questions &&
check:reachability && verify:todo-store`の&&連鎖であり、exit 0は全段通過を意味する。
cli surface 67 commands（undocumented/unexercised とも空）。

### 2. 実storeでの陽性実測（4者独立・同値）

全8task done直後、この工程自身の暗黙terminal-audit Phaseがgate_readyとなり、実storeで:

- `todo status --json`: schema v5、`audit_pending` = [{plan_key: audit-pending-surface,
  phase_id: terminal-audit, phase_status: gate_ready, implicit: true,
  required_evidence_slots: [terminal-audit], next_commands: [phase review …, phase close-unaudited …]}]
- `lattice status --json`: state `ready`のまま、`next_action` = {command: `lattice todo phase
  status --plan audit-pending-surface`, reason: `audit_pending`}

この観測をmitsuki（room [60]）・suzume（[61]）・hinano（[62]）・bell（[63]）が示し合わせず
独立に実行し、全員が同値を得た。campaignが直した穴（「残作業なし」と答える状態）が、
campaign自身のgate_readyで「未監査＝未完了」の応答に変わったことの実証である。

### 3. dispatch不変（ADR 0062・0147裁定5）

ap06のE2E testが、gate_ready planと ready taskの混在状態で`next_ready`と`dispatch_frontier`
（frontier_digest含む）が「acceptedにした場合」とバイト一致することをanchorした。既存の
dispatch不変test（todo-terminal-audit）へも`audit_pending`充足の併記を追加。

## task別の監査記録

各taskはroomでのdone報告後、監査役が実物（commit・実装・実挙動）を照合して受理した。

| task | 実装 | commit | 監査 |
|---|---|---|---|
| ap01 | todoPhaseDefinitions export | 3bcdf7b, 90a01ee | [21] 実挙動確認込みで受理 |
| ap02 | 共有module・二重定義解消 | 29afede, 602a0fe, 1f8af5e | [18] 定義一本化をgrep実測で受理 |
| ap03 | v5・audit_pending欄 | 546816f, 066fa3a, cb7ae35 | [33] 実store実測込みで受理 |
| ap04 | next_actionの枝 | f388a6a | [42] 優先順位の陰性側実測込みで受理 |
| ap05 | gantt/dashboardヘッダ | 8e2e0c2, c6c19ab, 09d52fb ＋修正 71a14c5, 92df090 | [29][42] 受理。欠陥はhinanoが自己検出・headless Chrome 3点実測で修正 |
| ap06 | E2E test（2人共同） | 256e2ab, 7678ae3 ＋合流分 bcc310f, e71692b | [63] 受理。claim/joinによるtask内分担の初実例 |
| ap07 | ADR 0159・契約文書 | 68d81d2 | [53] v4言及の消滅をgrepで受理 |
| ap08 | dotagents側v5先行追従 | dotagents repo: 330ba81, 9d7296e, 3be91df, 70e566e（証跡 3c4c714） | [35] 受理。消費者はmemo記載の1つでなく3つと判明、全対応 |

## 特記事項

- **downstream先行protocol**: ap08はap03のdoneより先に着地（ADR 0054の手順）。commit秒単位では
  33秒の逆転があったが、破断面はpublish時点にしか存在しないため受入の実質を損なわない
  （mitsukiの自己開示 [34]・監査判断 [35]）。
- **publish前の窓**: 現行のglobal install（0.46.2・v4）に対し、dotagentsのprojection/sagaは
  `version_mismatch`をtypedに返す（fail-visible・意図的）。hookは多版受理のため案内が出続ける。
  v5のpublishとglobal installが完了するまでこの窓は開いている。
- **既知の残課題（別議題として分離）**: 観測記録の置き場（宣言済み所有範囲「実験記録」と実装面の
  食い違い）と、初期化済みprojectへのtask追加コスト。room [69]-[77]で組立中、収束後に
  オーナーへ議題として運ぶ。本campaignの受入には含めない。

## 判定

受入ゲート（ci green・実store実測）は満たされ、全taskの成果物は実物照合済み。
終端監査を**accept**とする。
