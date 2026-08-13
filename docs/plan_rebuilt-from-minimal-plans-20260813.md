# 改訂済み最小PLANから再構築したLattice工程

- 作成日: 2026-08-13
- plan key: `minimal-plan-repairs-20260813`
- plan version: `v1`
- authoring schema: `lattice.plan_create_input.v4`
- scope-review schema: `lattice.plan_scope_review.v1`
- task数: 8
- phase数: 1
- hard dependency数: 0
- authoring artifact: `.lattice/candidates/plan-minimal-revision-20260813/plan-create.json`
- scope review: `.lattice/candidates/plan-minimal-revision-20260813/scope-review.json`
- 生成store候補: `.lattice/candidates/plan-minimal-revision-20260813/store/`
- fresh scratch: `/tmp/lattice-plan-minimal-revision-20260813.J72QbW`

## 入力と作り方

意味上の入力は次の改訂済みPLAN三本だけとした。

1. `docs/plan_peertable-dogfood-repairs-20260811.md`
2. `docs/plan_companion-repair-prerequisite-edge-20260812.md`
3. `docs/plan_structure-artifact-canonical-repair-20260812.md`

既存の`.lattice/todo`、実装コード、test、実装履歴、旧工程表は工程の意味入力にしていない。
typed discoveryではworktree rootの`lattice status --json`が既存storeについて
`state=invalid`、`can_create_plan=false`、`reason=project_root_conflict`を返したため、root storeを変更せず、
freshなgit scratchへPLAN三本とauthoring artifactをコピーして`lattice plan create`を実行した。

## Task一覧

全taskを単一の`delivery` phaseへ置く。試験・自己監査・最終試験結果の記録・利用面までの配布は、
それぞれの機能taskの完遂条件へ含め、独立taskにはしない。

| task_id | 利用者機能 | source PLAN |
| --- | --- | --- |
| `companion-atomic-repair-edge` | companion plan登録と`repair → target`前提edgeを一つのtyped transactionで原子登録し、既存taskへの後付け接続も同じ入口で扱う | `plan_companion-repair-prerequisite-edge-20260812.md` |
| `ldr-02-conversation-pull-guidance` | conversation調整時にpull実行の不足物、independence artifact準備操作または別実行方法をtyped next actionで案内する | `plan_peertable-dogfood-repairs-20260811.md` ldr-02 |
| `ldr-03-worker-control-separation` | hold対象workerとAIの会話・制御processを分離し、worker停止中もAIが回復操作を続けられるようにする | 同 ldr-03 |
| `ldr-04-isolated-clean-binding` | 共有mainの無関係WIPをcommitせず、隔離clean基準からindependence bindingを作る | 同 ldr-04 |
| `ldr-05-satisfied-cross-plan-prerequisite` | 完了済みsourceを既に満たされたcross-plan前提として記録し、targetを不必要にblockしない | 同 ldr-05 |
| `ldr-06-companion-input-scaffold` | 公開CLIからcompanion planの必要入力を取得し、既存planのpartial変更ではなく新planを起票する | 同 ldr-06 |
| `ldr-10-migrate-json-consistency` | `todo migrate`の通常実行、dry-run、schemaで`--json`を一貫して受理する | 同 ldr-10 |
| `structure-artifact-canonical-repair` | 壊れたstructure artifactをstatus/verifyでtyped診断し、明示input refから既存writerで対象artifactだけをcanonical復旧する | `plan_structure-artifact-canonical-repair-20260812.md` |

## PLAN要件のcoverage

scope-reviewはPLAN由来の利用者機能を8 work specとして全件収載し、各work specを同名の1 taskへ一対一で束縛した。
分割によって独立した製品目的を増やさず、複数の利用者機能を一つの巨大taskへまとめてもいない。

| work spec | acceptance coverage |
| --- | --- |
| `companion-atomic-repair-edge` | 起票直後のtarget block、repair完了後のready復帰、同じ入口による後付け接続、失敗時の全rollback、repair/target/frontier/next actionのtyped結果 |
| `ldr-02-conversation-pull-guidance` | conversationだけでpull可能と誤案内せず、不足物と次の操作を公開CLIから辿れる |
| `ldr-03-worker-control-separation` | worker hold中もAI processがrecoveryを読み、報告と回復操作を継続し、Latticeは席・会話・task選択を所有しない |
| `ldr-04-isolated-clean-binding` | 無関係WIP commitなしでisolated clean基準からbindingを作り、landing監視を追加しない |
| `ldr-05-satisfied-cross-plan-prerequisite` | 既存の完了記録で満たされた前提を表し、targetを不要にblockせず、専用台帳を作らない |
| `ldr-06-companion-input-scaffold` | 必要入力を公開CLIから取得して新planを起票し、目的・工程分割・依存をLatticeが推測しない |
| `ldr-10-migrate-json-consistency` | 通常、dry-run、schemaの`--json`受理を揃え、versioned JSON出力を維持する |
| `structure-artifact-canonical-repair` | pretty JSON、trailing bytes、truncated JSON、schema invalidをplan/path/reason/next command付きで診断し、明示ref適用時は指定artifactだけを1-line+LFへ復旧する |

## 依存とdispatch形状

source PLANは8機能の相互先決関係を定めていない。このため`hard_dependencies`、`joins`、
`phase_accept_dependencies`はいずれも空とした。実装境界の競合、配備順、監査順を推測してhard dependencyへ
変換していない。

fresh storeの投影はtask数8、critical path 1、最大frontier幅8、serialization ratio 0.1250を返した。
`todo status`は8 taskすべてをreadyとして投影した。independence coverageは未作成なので`missing`のままであり、
「競合なし」という意味には扱わない。PLAN外のwitness作成やindependence compileを本工程のtaskには追加していない。

## 意図的に追加しなかったもの

- 基線確認、配備Wave、peer audit、closeout、試験専用task、release専用task。
- 本機能専用の台帳、承認gate、監視機構、復旧系統、証拠台帳、完了状態の不変化機構。
- landing監視、genericな全store検査、自動heal、provenance探索、repair専用writer、直接JSON編集。
- dry-runの必須化、AIによるrepair関係・logical input・目的・工程分割・依存関係の推測。
- active planへの汎用partial CRUD、Latticeによるtask選択・会話・席管理、Peertable側の変更。
- 実装境界の競合を推測して置くhard dependency。

## 検証結果

使用CLIはLattice `0.59.1`。

- `lattice plan scope-review`: accepted、`scope_preserved`、work spec 8/8、task 8/8、out-of-scope 0、uncovered 0。
- `lattice plan create`: 成功。plan digestは`091c4efed19816bc3f75861a82143950445874deb2ce93319251f9115973ea96`。
- `lattice plan show minimal-plan-repairs-20260813 --json`: 8 task、依存0、全task pendingを投影。
- `lattice todo status --json`: 8 taskすべてをready frontierへ投影。
- `lattice todo verify --plan minimal-plan-repairs-20260813 --json`: 成功。snapshot staleなし、topology digestは`8fe458d94bdc0f21ae1fbd79ddd0490e1c6af19ff4c2a1de9c25b808eb7e3b8f`。
- authoring digest: `eb8c45c4940b50833f6f3e8d0ba6330a95c1e029e4ea6c36b86c9a2b6b5b91cd`。
- scope-review digest: `872e3b1d12d1c2ac02a46db9dfd3de2c188bcb04489dacc7d5103212d6e00d20`。

生成したfresh storeだけをcandidateの`store/`へコピーした。repo rootの既存`.lattice/todo`は変更していない。
