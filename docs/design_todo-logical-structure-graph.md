# ToDo構造データとソース結合グラフ検査 — 詳細構想

- Status: Draft（2026-08-11 オーナー構想を詳細化）
- 対象製品: Lattice
- 適用時点: Lattice工程表の定義後、実装着手前から工程終端まで
- 適用方式: plan単位の明示opt-in
- 工程管理: 本機能を作るcampaign自身にはLattice／Peertableを使わず、Markdown ToDoを正本にする
- 関連: [PLAN.md](../PLAN.md)、[製品契約](00_product-contract.md)、
  [ToDo並列作業可能性](plan_todo-independence.md)、[AI-safe ToDo authoring](plan_ai-safe-todo-authoring.md)

## 1. 背景

現在のLatticeは、ToDo DAG、設計メモ、task note、source boundary witness、内蔵sensorによる
symbol／call／import／reference／impact、Git差分を持っている。しかし、各ToDoが次の問いへ機械可読に
答える面はない。

- 何のデータを受け取るのか
- そのデータは既存コード、外部契約、先行ToDoのどこから来るのか
- 何を整理・変換するのか
- 何を生成し、どのコード・後続ToDo・外部面へ渡すのか
- 計画した変換が工程DAGと既存コードの上で成立するか
- 実装後に、計画した構造が実際には何へ変わったか

この欠落により、plan全体を見ない担当者は、具体的な作り方以前に「何をつなぐ工程なのか」を理解できない。
設計メモを長くすれば人間には読めるが、Latticeは工程同士と実コードの未接続を検査できない。

Peertableの未完了16 ToDoを使った試行では、自由文の設計メモから次を
`logical_dataflow.v0`として短時間で作れた。

- outcome
- receives
- organizes
- emits
- failures
- first_live_e2e
- non_goals

AIが構造を考えて書くこと自体は重くない。欠けているのは、AIが書いた構造を受け止め、既存ソース・
commit・ToDo DAGと結合し、矛盾とunknownを機械的に返し、実装後の最終形へ更新させる契約である。

## 2. 目的

1. 工程表の定義後に、対象planのToDoへ計画上の論理構造を入力できる。
2. 現在のソースグラフ、基準commit以後の変更、着手済み／未着手／blocked ToDoを一つの結合グラフへ投影できる。
3. 結合グラフの未接続、矛盾、検証不能を、場所と次の一手つきで指摘できる。
4. 対象ToDoの終了時に、計画構造を実現構造へ更新しなければ完了できない。
5. plan終端時に最終ソースと全実現構造を再結合し、最終形を検証済みartifactとして固定できる。

## 3. 非目標

- 出版、調査、営業、一般事務など、code-dataflow検査を必要としないplanへ自動適用しない。
- planの題名や文章から「ソフトウェア開発らしい」と機械推定しない。
- AIが行う要求理解、命名、意味上の設計、文章生成をLattice内部のAI呼出しとして再実装しない。
- 自由文同士の意味的同等性、型の意味、正しい業務仕様をLatticeが推論しない。
- 並列可否、write conflict、capacity、seam候補を本機能で再判定しない。既存independence面の責務である。
- commit messageをtask帰属や構造の証拠として解析しない。
- dirty worktreeを検証済み構造として固定しない。
- plannedを消去して「最初からrealizedの設計だった」と見せない。

## 4. 基本原則

### 4.1 明示opt-in

plan作成時のschemaへ必須fieldを増やさない。工程表が定義された後、構造入力をcompileしたplanだけを
`code-dataflow`適用対象とする。構造入力が無いplanは既存挙動のままで、完了gateも増えない。

これにより、出版plan等へ不要な入力・検査・完了義務を発生させない。Latticeは適用要否を推定せず、
人または操作AIの明示選択を記録する。

### 4.2 AIは構造を宣言し、Latticeは照合する

操作AIは、設計メモと実コードを読んで構造入力を作る。Latticeは次だけを所有する。

- exact schema、上限、canonical bytes、self digest
- plan／task／source commitへの束縛
- code anchorのexact解決
- task outputからtask inputへの接続
- data contractの機械比較
- ToDo DAGとの順序照合
- commitと変更構造の来歴照合
- planned／realizedの版と鮮度
- finding、unknown、次の正規操作
- 完了と終端の機械gate

Latticeが自由文から構造を生成したり、曖昧なsymbolを近い別symbolへ補ったりしない。

### 4.3 plannedとrealizedを分離する

- `planned`: 工程着手前に作る予定だった構造
- `realized`: 実装後に実際に存在する構造
- `effective`: 現時点で後続が参照すべき構造。realizedがあればrealized、無ければplanned

画面と通常読取ではeffectiveを主表示にする。ただしplannedは消さず、planned→realizedの差分を残す。
これは監査用の重装備ではなく、計画がどこで変わったかを次の設計へ返す製品データである。

### 4.4 事実・矛盾・unknownを分ける

判定は点数やconfidence閾値へ潰さず、次の三値とする。

- `consistent`: 必須接続が全て解決し、機械契約上の矛盾とunknownがない
- `inconsistent`: 入力欠落、型不整合、工程順序矛盾等の反証がある
- `unknown`: sensor不足、外部契約、曖昧anchor等により結論を出せない

unknownをconsistentへ丸めない。inconsistentとunknownを同じ「失敗」に潰さない。

### 4.5 既存グラフを正本にし、overlayだけを新設する

本機能は新しいsource graph engineではない。既存Latticeが既に持つgraphとcompile primitiveを正本として
使い、ToDoの論理構造をその上へ投影する薄いoverlayである。実装前に次の再利用対応を実コードで確認し、
同じ責務を別moduleへ複製しない。

| 必要な能力 | 既存の正本 | 今回足すもの |
|---|---|---|
| file／symbol／call／import／reference／impact | 内蔵sensor、`sensor-adapter.mjs`の`collectSensorEvidence`／`portableSensorOutcome` | structure anchorを既存queryへ変換するadapter |
| base/currentのnode・edge差分 | `sensor-diff.mjs`の`compareSensorIndexes` | structure findingへ写すprojection |
| boundaryのresource／unknown正規化 | `compileRuntimePlanV1`→`compileBoundaryObservationV2`→`compileSchedulabilityGraphV2`、independence compile | dataflowが参照する既存resource identityとunknownの受渡し |
| ToDo状態とready集合 | `readTodoStore`、`computeReadyFrontier`、`projectTodoStatus` | structure対象taskの選択 |
| DAG、cycle、依存鎖 | `projectTodoChainV1`、`analyzeDagChains`、storeのmerged-cycle検証 | task port edgeを既存DAGへ重ねるadapterとfinding化 |
| Git process、object読取 | `git-process.mjs`の`gitSync`／`gitCatFileBatch`等 | baseline..HEADをprovenanceへ正規化する薄い関数 |
| exact record、canonical bytes、digest | `todo-contracts.mjs` | structure固有schema validator |
| plan並置artifactと鮮度 | independence artifactのread／write／projection | structure固有refと鮮度field |
| append-only chain | task note／plan noteのchainと破損契約 | realization固有event shapeとprojection |
| CLI error・guidance・help | `todo-cli.mjs`、`todo-independence-guidance.mjs`、`cli-help.mjs` | structure固有codeと次操作 |
| dashboardのstore読取・安全描画 | todo Gantt live／presentation／SVG群 | 別タブのstructure projection |

`compileSchedulabilityGraphV2`へdataflow固有の意味を無理に押し込まない。再利用するのは既に同じ意味を持つ
resource、precedence、unknown、DAG primitiveである。data contractのshape／identity／lifecycle検査は新しいが、
source graphの抽出、差分、到達性、cycle、鮮度を作り直す理由にはならない。

新規moduleは既存正本を呼ぶadapter、structure固有contract、finding rule、realization gateだけに限定する。
既存primitiveで表現できないと判明した時は、その場で新実装へ進まず、欠けている入力／出力を特定して
本設計を改訂する。「既存機構の使い方が分からない」を再実装の理由にしない。

## 5. ライフサイクル

```text
Lattice工程表を定義
        ↓
対象planだけ構造入力を作成
        ↓
planned compile
  ├─ current source graph
  ├─ baseline..HEAD commit changes
  ├─ in-progress ToDo transforms
  ├─ pending ToDo transforms
  └─ blocked ToDo transforms
        ↓
結合グラフ検査
  ├─ consistent → 実装へ
  ├─ inconsistent → 構造入力・工程依存・設計を修正
  └─ unknown → 必要なanchor・sensor・外部契約を補う
        ↓
各ToDoを実装
        ↓
realized構造を提出してからToDo done
        ↓
全対象ToDo完了
        ↓
final compile（最終HEADのsource graphと全realizedを再結合）
        ↓
terminal受理可能
```

## 6. 入力契約

初版の入力契約を`lattice.todo_structure_set.v1`とする。入力はrepo内のcanonical JSON+LFで、
plan versionとtopology digestへ束縛する。概念形は次のとおり。

```json
{
  "schema": "lattice.todo_structure_set.v1",
  "project_id": "peertable",
  "plan_key": "example-plan",
  "plan_version": "v1",
  "topology_digest": "<digest>",
  "profile": "code-dataflow",
  "baseline_sha": "<40 hex>",
  "external_contracts": [],
  "tasks": [
    {
      "task_id": "t1",
      "applicability": "graph",
      "planned": {
        "outcome": "現在在席する名前を実sessionへ解決する",
        "inputs": [],
        "operations": [],
        "outputs": [],
        "code_anchors": [],
        "failures": [],
        "first_live_e2e": "追加席へのDMが一度だけ起床・既読になる",
        "non_goals": []
      }
    }
  ],
  "structure_set_digest": "<self digest>"
}
```

### 6.1 coverage

compile時点のpending／in-progress／blocked ToDoを全件列挙する。各taskは次のどちらかを明示する。

- `applicability: "graph"`: planned構造を持ち、realized提出義務の対象になる
- `applicability: "excluded"`: code-dataflow対象外である理由を持つ

列挙漏れは「対象外」ではなく`coverage_missing`である。excludedの正しさを機械採点はしないが、誰が何を
対象外としたかを見える形にする。完了済みtaskは、未完了taskの入力元として必要な場合だけrealizedを読む。

### 6.2 data port

ToDoは変換nodeであり、入力と出力はportとして持つ。

- input: `port_id`、source ref、access、要求するdata contract
- operation: `operation_id`、入力port、出力port、変換規則の短い説明
- output: `port_id`、`data_id`、data contract、sink

inputのsource refは次に限定する。

- `code`: 既存ソースのpath／symbol／schema／config等
- `task_output`: 先行taskのoutput port
- `external`: plan内で宣言した外部契約
- `constant`: plan内で完結するboundedな固定入力

outputのsinkは後続inputから逆算できるが、最終出力の孤立と区別するため次を明示できる。

- `task`: 後続taskが受け取る
- `code`: code anchorへ定着する
- `external`: API、公開artifact、外部サービスへ渡る
- `final_product`: planの最終成果そのもの

### 6.3 data contract

自由文の意味を機械推論しないため、data contractは比較可能な識別子を持つ。

- `shape_id`: plan内または既存schemaを指す安定ID
- `schema_ref`: repo相対path＋任意のexact symbol／JSON pointer
- `identity_fields`: 同一性を決めるfield名の整列済み集合
- `lifecycle`: `snapshot | event | stream | mutable_state | immutable_artifact`
- `cardinality`: `one | optional | many`

consumerは受理するshape_id等を明示する。完全一致または入力で宣言したcompatibilityだけを受理し、
名前が似ていることを互換の根拠にしない。正式schemaが無い場合もshape_idは必須で、意味の正しさはAIが
宣言し、Latticeは接続の一貫性だけを見る。

### 6.4 code anchor

code anchorは次を持つ。

- `effect`: `read | modify | create | delete`
- `path`: repo相対path
- `symbol`: qualified nameまたはnull
- `expected_at`: `baseline | current | after_task`

read／modify／deleteのexisting symbolは内蔵sensorでexact解決する。create対象はbaselineで存在しないことと、
同じsymbolを複数taskが生成しないことを確認する。pathだけの宣言は許すが、symbol単位の問題を検査できない
範囲をunknownとして残す。

## 7. 四層の結合グラフ

### 7.1 既存ソース層

current HEADを内蔵sensorで索引し、構造入力から到達するbounded subgraphを使う。新しいparser、index、
node ID、edge extractorは作らない。全codebaseを公開artifactへ複製しない。nodeはfile、symbol、
schema/config等、edgeはcall、import、reference、containment等である。

索引未初期化、pending changes、extraction version不一致、exact anchor不成立はunknownにする。

### 7.2 commit来歴層

current source graphには既にHEADまでのcommit内容が含まれる。commitを別のcode nodeとして重ねると
同じ実装を二重計上するため、commitはchangeset／provenance nodeとして扱う。

- `baseline_sha..HEAD`の各commit
- add／modify／deleteされたpath
- 可能ならsensor diffで得たsymbol／edgeのadded／changed／removed
- task realizationが明示したcommit OIDとの対応

commit messageは根拠にしない。baselineがHEADの祖先でない、objectが読めない、差分を確定できない場合は
unknownで止める。authoritative compileはclean worktreeだけを受理する。

### 7.3 着手済みToDo層

in-progress taskはplanned transformを載せる。taskへ明示的に関連づいたcommitがあればchangeset edgeを足す。
commit未関連づけは作業中として許すが、`implementation_unbound`をunknownとして返す。

### 7.4 未着手・blocked ToDo層

pending／blocked taskはplanned transformを載せる。blocked reasonはdataflowの代用品にせず、入力元は
existing code、external contract、または先行task outputへ
必ず解決する。まだ存在しないcode nodeは、それをcreateする先行task outputへ束縛されている場合だけ
planned nodeとして解決する。

### 7.5 final層

plan終端では全applicable taskのrealized transformと最終HEADのsource graphを使う。planned nodeを実在nodeへ
置換し、未実現のplanned node、由来不明の実在node、最終成果へ届かないoutputをfindingにする。

## 8. 検査規則

初版で機械判定するのは次である。

### 8.1 接続

- input sourceが存在するか
- task_output参照のtask／portが存在するか
- output port／data_idが重複していないか
- outputにconsumerまたは明示sinkがあるか
- external refが宣言済みか

### 8.2 data contract

- producerとconsumerのshape_id／schema_refが互換か
- identity_fields、lifecycle、cardinalityが接続上矛盾しないか
- eventをmutable snapshotとして扱う等、明示契約上の変換抜けがないか

### 8.3 ToDo DAG

- BがAのoutputを消費するなら、AがBの先行taskとして到達可能か
- producerが未完了のままconsumerだけin-progressになっていないか
- ToDo依存とdataflowを合わせたmerged graphにcycleがないか
- dataflow上必要な依存がDAGに無ければ、追加すべきtask edgeを名指しする

### 8.4 code anchor

- read／modify／delete対象がbaselineまたはcurrent sourceにexact存在するか
- create対象が既に存在しないか
- planned symbolの生成taskと利用taskがつながっているか
- 削除予定symbolを後続taskまたは既存source edgeが参照していないか

### 8.5 commitと実現

- realizationのcommit OIDがbaseline..HEADに含まれるか
- realizationが宣言したcode anchorとcommit差分が交差するか
- planned create／modify／deleteがrealizedと最終sourceに現れるか
- realizedで追加した変更がどのoutput／failure／非目標変更に対応するか
- task done時のHEADとrealizationが束縛したHEADが一致するか

機械が意味を判断できない差分はinconsistentでなくunknownにする。

## 9. finding契約

findingは少なくとも次を持つ。

- `code`: 安定したtyped code
- `severity`: `error | unknown | notice`
- `task_ids`
- `data_refs`
- `code_refs`
- `commit_oids`
- `evidence`: 実際に観測した値と期待値
- `next_action`: 構造入力、工程依存、sensor、realizationのどれを直すか

代表code:

- `STRUCTURE_COVERAGE_MISSING`
- `STRUCTURE_INPUT_UNRESOLVED`
- `STRUCTURE_OUTPUT_ORPHANED`
- `STRUCTURE_CONTRACT_MISMATCH`
- `STRUCTURE_DEPENDENCY_MISSING`
- `STRUCTURE_GRAPH_CYCLE`
- `STRUCTURE_CODE_ANCHOR_ABSENT`
- `STRUCTURE_CODE_ANCHOR_AMBIGUOUS`
- `STRUCTURE_CREATE_ALREADY_EXISTS`
- `STRUCTURE_COMMIT_UNBOUND`
- `STRUCTURE_REALIZATION_MISSING`
- `STRUCTURE_REALIZATION_STALE`
- `STRUCTURE_FINAL_DRIFT`
- `STRUCTURE_SENSOR_UNREADY`

同じ原因をtaskごとに重複列挙せず、一つのfindingへ関係taskを束ねる。ただしbounded collection上限で
切った場合はomitted件数を必ず示す。

## 10. 保存・版・鮮度

### 10.1 planned source

`lattice.todo_structure_set.v1`はwitness setと同じく、AIが作る再生成不能な入力としてGit追跡する。
想定refは`.lattice/todo/structure/<plan_key>.json`。plan version、topology digest、baseline SHAへ束縛する。

### 10.2 compile artifact

結合グラフとfindingは再生成可能artifactとしてplan versionへ並置する。全文source graphではなく、
参照したnode／edge、解決結果、commit provenance、finding、各入力digestを保存する。

鮮度キー:

```text
(plan_version, topology_digest, baseline_sha, current_head_sha,
 structure_set_digest, sensor_projection_digest, realization_head_digest)
```

### 10.3 realization chain

realizedはtask-scoped append-only chainへ記録する。訂正は旧recordを消さず、`supersedes`で新recordを現行にする。
plan revision時はtask migrationだけでIDを写せるが、意味が同じとは主張しない。topologyまたは構造入力が変われば
再compileを要求する。

### 10.4 planned→realizedの表示

通常読取はeffective構造と差分要約を返す。診断面ではplanned、全realization履歴、最終projectionへ到達できる。
plannedをrealizedで物理上書きしない。

## 11. CLI面

初版の公開入口を次とする。

```text
lattice todo structure --schema --json
lattice todo structure compile --plan <key> --input <ref>
lattice todo structure [--plan <key>] --json
lattice todo structure realize --plan <key> --task <id> --input <ref>
lattice todo structure finalize --plan <key> --json
```

- `--schema`はstoreを読まず、最新版入力契約を決定的に返す。
- `compile`は入力、plan、Git、sensorを照合し、planned sourceとderived artifactを記録する。
- 読取面はsensorを再実行せず、保存済みartifactと現在のHEAD／plan identityから鮮度を投影する。
- `realize`はtask、commit、HEAD、planned refへ束縛した実現構造をappendする。
- `finalize`は全対象task done、realization完備、clean HEAD、fresh sensorを確認して最終compileする。

CLI名は実装時にhelp namespaceとの整合を確認して最終決定する。同じ意味の別名を複数残さない。

## 12. 完了gate

### 12.1 task done

構造機能が有効なplanで`applicability: graph`のtaskは、freshなrealizationが無い限り`todo done`を拒否する。
realizationは少なくともtask ID、planned digest、HEAD、commit OID、実現したinput／operation／output、code anchorを
持つ。拒否はjournal bytesを変えず、先に実行する`todo structure realize`を案内する。

excluded taskと構造機能を有効化していないplanは既存done挙動を変えない。

### 12.2 plan終端

全task doneだけでは構造検査対象planの終端にならない。freshなfinalization artifactが無い、または
verdictがconsistentでない場合、terminal Phase accept／完走projectionを保留し、`audit_pending`とstatusへ
理由を出す。finalize後にHEAD、topology、realizationが変われば再びstaleに戻す。

これは人へ「更新してください」と書くだけの義務にしない。完了の一点で機械が保持する。

## 13. dashboard

既存Ganttの依存edgeへdataflow edgeを混ぜない。工程依存とデータ接続が同じ線に見えるためである。

dashboardには別の「構造検査」面を追加する。

- task transform node
- code／external／data node
- planned／realized／effectiveの切替
- finding一覧から問題node／edgeへの移動
- unresolvedを消さずに表示
- task詳細でplanned→realized差分、commit、code anchor、次の一手を表示

並列可否欄は既存independence面をそのまま使い、本面へ統合しない。

## 14. 互換性と失敗契約

- 構造入力の無い既存planはread／start／done／phase acceptのbytesと意味を変えない。
- 新fieldを既存status schemaへ無断追加しない。schema bumpまたは加算の別面を使う。
- source／artifact破損を「未設定」へ丸めない。
- baseline非祖先、unreachable commit、dirty worktree、sensor staleを同じエラーへ潰さない。
- code anchorはfuzzy resolutionを使わない。候補が複数なら全候補をboundedに返してunknownにする。
- 初版は既存sensor node／edgeだけを使う。実測で不足が証明され、sensor契約自体を増やす場合だけ、
  wasm／native二実装を同じ工程でparityまで揃える。
- Windowsを含むGit起動は`src/git-process.mjs`だけを使う。

## 15. 最初の実動fixture

Peertableで作成済みの未完了16 ToDoの`logical_dataflow.v0`を、秘密・room credential・絶対pathを含めず、
Lattice test fixtureへ移す。次を含む実例として使う。

- existing code input
- 先行task output input
- create予定symbol
- external session adapter
- event、mutable state、immutable artifact
- pending／in-progress／blocked
- output orphan、依存欠落、shape不一致、unknown anchorの負例
- planned→realizedで構造が変わる例

fixtureはPeertable storeを直読せず、Lattice repo内の固定入力として所有する。本campaignの工程管理へ
PeertableまたはLatticeを使うこととは別である。

## 16. 受入条件

1. plan定義後にだけ構造機能を明示有効化でき、未適用planの挙動が変わらない。
2. planned入力が既存source、commit来歴、in-progress／pending／blocked ToDoと結合される。
3. 一つ以上の反証を持つinconsistentと、証拠不足のunknownを区別する。
4. findingが問題node／edge、観測値、期待値、次の正規操作を返す。
5. dataflowとToDo DAGの不一致を検出し、必要な依存edgeを名指しする。
6. applicable taskはfresh realization無しにdoneできず、失敗時にstore bytesが変わらない。
7. plan終端はfreshなconsistent finalization無しに完走扱いにならない。
8. plannedは履歴に残り、通常面はeffectiveとplanned→realized差分を表示する。
9. dashboardで工程依存と混同しない別グラフとして問題箇所を読める。
10. Peertable由来fixtureの正例・負例、実Git repo、実sensor、実commit rangeでE2Eが通る。
11. focused test、関連test、`npm run check`、`npm run ci`がgreenになる。

## 17. 既知の罠

- current sourceとcommit内容を別コードとして重ねる二重計上
- dataflow edgeと工程依存edgeを一種類へ潰す誤読
- 自由文の似た名前を同じdata／symbolと推測する誤接続
- plannedを上書きして設計変更の履歴を消すこと
- task done後に「あとでrealizedを書く」運用へ逃がして永久に残すこと
- 全source graphをartifactへ複製して規模上限を失うこと
- dirty worktreeを検証済みcommit構造として保存すること
- external contractのunknownをconsistentへ丸めること
- independence compilerへ意味の違う判定を混ぜ、並列性の契約を壊すこと
- commit messageをtask帰属の正本にすること
- 既存sensor／boundary／DAG／artifact primitiveを調べず、名前を変えた同等実装を足すこと
