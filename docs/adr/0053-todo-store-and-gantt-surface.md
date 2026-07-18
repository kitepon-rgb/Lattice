# ADR 0053: 工程store（todo_store.v1族）とガント出力面の契約

- Status: accepted
- Date: 2026-07-18
- 位置づけ: Phase LG（dotagents親裁定 2026-07-18・queue 23）のG1契約裁定。
  [実装計画](../plan_lattice_gantt.md)の論点①〜⑦を閉じ、G2以降の実装契約を確定する
- 前提: [ADR 0044](0044-rc3-runtime-contract.md)（CLI surface規約・exact-key規律・in-place拡張禁止）、
  [ADR 0052](0052-cli-error-v2-and-doctor-retirement.md)（`cli_error.v2`）、
  [00_product-contract.md](../00_product-contract.md)（versioned JSON・fail closed）、
  [Codex監査5レーンevidence](../evidence/2026-07-18-lg-codex-audit.md)（決定文案の一次出典。
  以下「監査#N-M」はレーンN指摘Mを指す）
- 反証: `fable`スポット諮問・`fable`×high refuter・クロスprovider Codex opinion（sol×xhigh）各1回。
  指摘と反映は末尾「反証記録」節

## Context

オーナー裁定（2026-07-18）: AIの規律ではToDoの順序・チェック消化を維持できないため、工程を
機械管理する。散文はMarkdown正本のまま、工程は構造化storeを正本とし、書込はCLI経由に限定、
閲覧はブラウザのガントを主とする。Codex監査5レーンが、既存契約との整合・store設計・wave計画・
schema破損経路・レンダラ実現性を検証済み（P0裁定9系統）。本ADRはその決定文案を裁定として確定する。

前提事実の訂正（監査#1-8・#2）: 現行producerはhard dependencyを生成しない（`plan_input.v1`に
依存fieldがなく、conflict edge＋`joins: []`固定）。`plan_graph.v2`・`runtime_plan.v1`もAccepted
公開契約。よって「既存graphを読むだけでガント化できる」は成立せず、工程依存はstoreが所有する。

### 既存plan familyとの互換表（G1論点①の確定）

| 既存schema | 役割 | 依存表現 | todo storeとの関係 |
|---|---|---|---|
| `plan_input.v1` | ToDo候補＋手動evidenceの入口 | なし（依存field自体が無い） | G4一回きりadapterの参照入力。常設読替なし |
| `plan_graph.v1` | boundary compileの成果graph | conflict edgeのみ・`joins: []`固定 | 読替対象外（工程依存を持たない） |
| `plan_graph.v2` | RC2以降のcompile成果 | 同上系統 | 読替対象外 |
| `runtime_plan.v1` | dispatch用実行plan（1〜8 node・exact minimum） | precedence（現行producerは`[]`） | source変更taskの`compile_binding`照合先 |

Ganttが読むcanonical directed graphは**todo storeのhard dependency＋join**のみ（下記Decision 1）。

## Decision

### 1. 新契約族`todo_store`の採用（既存系列の拡張は却下）

- 既存`plan_input/plan_graph/runtime_plan`系列へのstatus・依存のin-place追加は**却下**。
  既存graph系は不変のdispatch用compile結果であり、status churnがdigest identityを壊し、
  exact-key規律（ADR 0044 Decision 2）とも矛盾する（監査#2）。
- 新schema族（すべてexact key・bounded・canonical serialization・fail closed）:
  - `lattice.todo_manifest.v1` — project単位のstore一覧（Decision 4）
  - `lattice.todo_plan.v1` — 1計画のtopology（task・hard dependency・join・lane・散文ref）
  - `lattice.todo_event.v1` — 遷移journalの1行（Decision 2）
  - `lattice.todo_snapshot.v1` — materialized projection（Decision 2）
  - `lattice.todo_chain.v1` — 最長依存鎖projection（Decision 7）
  - `lattice.todo_gantt_result.v1`ほかCLI result族（Decision 6）
- **joinの意味論**: todo_plan.v1のjoinは既存planJoinと同形の`{id, after[], before}`・
  **all-of barrier**（`after`の全taskがdoneで充足）とする。start可否・最長依存鎖・閉包検査は
  この意味論で判定する。
- **source変更taskのoptional `compile_binding`**: boundary_manifest digest・compiled plan digest・
  topology digest・base SHAを持ち、dispatch時に照合する。工程storeは並列安全性を主張せず、
  boundary evidence契約を代替しない（監査#2の契約境界どおり）。`done`はbindingを無効化せず、
  依存変更は必ず無効化する。
- 既存plan familyからの取込はversioned adapter（G4移行tool）経由の一回きり変換とし、
  常設の読替えを作らない。

### 2. store正本規律（journal唯一正本・closed状態機械）

- **journalが唯一の正本**。snapshotは破棄可能なmaterialized projection。**journal破損と
  snapshot不整合は別扱いにする**（Codex opinion#1）:
  - journal（現segment＋sealed segments）の検証失敗＝正本破損＝`STORE_CORRUPT`で全拒否。
  - journalが健全でsnapshotが欠落・stale・不一致＝**readerは検証済みjournalからのread-only
    投影で読み続けられる**（結果に`snapshot_stale: true`を明示）。暗黙のsnapshot書換えはせず、
    修復は明示的・決定的な`lattice todo snapshot --rebuild`（journal replayのみを根拠）だけが行う。
    writerはsnapshot再整合まで新規mutationを拒否する。
  - snapshotは`projection_version`・`through_sequence`・`journal_head_digest`・`snapshot_digest`を
    必須とし、健全時のreaderはreplay結果とのcanonical exact一致を要求する（監査#4-1）。
  - **commit point**: mutationの耐久化はjournal segmentのfsync＋atomic rename完了時点と定義する。
    snapshot・manifestの更新はその後段で、クラッシュしても正本は失われない（crash matrixを
    G2 fixtureで固定する）。
- **遷移kindはclosed集合6種**: `plan_genesis | start | block | unblock | done | reopen`。
  各eventは`sequence`・`previous_digest`・`actor`・timestamp・optional `provenance`を持つ。
  - `plan_genesis`: **journalの第0 event**。plan_version・（successorの場合）旧version digest＋
    task移行map・対応するtodo_plan.v1のdigestを持ち、successorでは`previous_digest`を旧journal
    head digestへbindする。
  - `start`: pendingのみ受理。依存（hard dependency・join）未充足なら拒否。強行は
    `override_reason`必須field付きでのみ許す。
  - `block`: in-progressのみ受理（未start・done後・blocked中の重複blockは拒否）。`reason`必須。
  - `unblock`: blockedのみ受理。**復帰先はin-progress**（blockはstart済みが前提のため）。
  - `done`: in-progressのみ受理（blocked中は拒否＝unblock先行必須）。**依存充足をdone時にも
    再検査**し、evidence descriptor必須（Decision 5）。重複doneは拒否。
  - `reopen`: doneのみ受理。`reason`必須・**`target_done_digest`必須**（取り消すdone eventへの
    束縛）。元doneのevidenceはjournalに残り、statusはin-progressへ戻る。**当該doneを依存根拠に
    start済みの後続taskが存在する場合は拒否**し、強行は`override_reason`型でのみ許す
    （fable諮問判断3・Codex opinion#2。AIの誤doneは高頻度に起きる前提で、訂正を軽い前方遷移として
    提供しないと誤doneが正史に残る）。
  - **status投影は関数**: pending（start無し）／in-progress（start済み・未done・非blocked）／
    blocked（start済み・block未解除）／done。blocked未start・done∧blockedは遷移表上構成不能。
- `started_at`/`done_at`は表示・監査用のlocal-untrusted値で、順序・有効性の根拠にしない。
  todo族のtimestampはstrict round-trip parser（`YYYY-MM-DDTHH:mm:ss.sssZ`・実在暦日）で検証し、
  clock reversal・過大future skewはtyped anomalyとして拒否する（監査#4-11）。**適用はtodo族限定**。
  既存契約の`2026-02-30`受理欠陥はG2で影響範囲を確認し、既存schemaの受理集合を変える場合は
  ADR改訂を経る。
- **actorの値空間**: `{host, session, agent}`のexact-key構造体（それぞれbounded string）。
  Stop hook WARN・override監査はこのactorへ相関する。
- **provenance**: optional `{source_commit, source_event_digest}`。reconcile再発行（Decision 4）が
  元履歴への参照をここへ載せる。
- **topologyはimmutable**: 1つの`plan_version`に属するtask・依存・join・laneは不変。topology変更
  （task追加・削除・依存変更）の唯一の入口は**`lattice todo revise`**で、1回の呼び出しが変更batchを
  受けてsuccessor plan versionを1回発行する（軽いCRUDに見せない。Codex opinion#7）。削除taskは
  移行mapで明示的に`removed`と宣言し、残存taskの依存が削除taskを指す場合はfail closed。
  **書込順序契約**: successor発行は①新todo_plan.v1書込→②新journal（plan_genesis）書込→
  ③manifest更新（activation）の順。readerはmanifestが指すgenesis/plan欠落を全拒否＝途中クラッシュは
  「新version未発行」へ倒れる。**activation gateで全inbound cross-plan refを検査**し、破れがあれば
  activationを拒否する（Codex opinion#3）。
- **journal file layoutと書込protocol**: journalはUTF-8・LF終端JSONL。一行一event、各行は
  `canonicalizeArtifact(event) + LF`とbyte-exact一致。**headの正本はactive segmentの最終行**で、
  専用head fileは持たない。書込はstore scoped lock下で①active segment全読・検証②CAS照合
  （`expected_head_sequence`/`expected_head_digest`は**lock内で内部取得**しCLI引数に持たない。
  不一致は`STORE_WRITE_CONFLICT`で無変更終了・自動retryなし）③temp fileへ全文書込→fsync→
  atomic renameでsegment全置換。event digestはschema・store identity・plan bindingを含む
  typed preimage、segment digestはexact file bytes（監査#4-4, 9）。
- **snapshot serialization契約**: 単一canonical JSON value＋LF・self-digest規則・collectionの
  並び順はfieldごとにschemaで規定する（監査#4-4後半）。
- **todo族のper-schema上限**（既存`canonicalizeArtifact`系の256 item/1 MiB既定を無変更再利用せず
  自前裁定。監査#1-7）: 1planあたりtask 512・edge 2,048・join 128。journal segmentは1 MiB到達で
  rotation。snapshotは8 MiB。散文1節は256 KiB。超過はfail closed。
- **compactionはseal/rotationのみ**: 過去segmentは開始/終了sequence・前segment head digest・
  segment digestを持つimmutable fileとして残す。prefix破棄・真正な履歴削除はv1で禁止
  （別schema・別ADR。監査#4-5）。
- **byte-level fail closed**: raw bytesのfatal UTF-8 decode・BOM/CR/duplicate key/trailing bytes/
  merge marker/truncated write/schema version混在/genesis欠落/上限超過を全拒否。path検査は
  lstat/realpathでsymlink・repo外・非regular fileを拒否（監査#4-14）。

### 3. 配置・git・coverage分離

- store正本は**`.lattice/todo/`配下・git tracked**（gitignore不可。「GitHubが真実」の親運用に乗せる）。
  生成物（ガントHTML等）は**`.lattice/generated/`配下・gitignored**。両rootを混在させない。
- storeはCodegraph coverage・source snapshotから除外し、store digestはgantt result identityへ
  別途束縛する（監査#1-5）。coverage分離のintegration testをG2で先行させる。

### 4. 複数plan統合・並行書込・真実性

- **task identityは`{project_id, plan_key, task_id}`のstructured tuple**（表示・logical identity）。
  **cross-plan依存のbindingはこれに加えて`expected_topology_digest`を必須とする**——参照先planが
  successor versionへ進んだとき、bindingが旧topologyを指したままなら統合readerは当該edgeを
  `binding_stale`としてfail closedし、`todo revise`での再bindを要求する。activation gate
  （Decision 2）が全inbound refを検査する（Codex opinion#3。merged graphの意味の暗黙変更を禁止）。
- `project_id`と`plan_key`は`todo_manifest.v1`で一意に宣言。**manifestはself-digest付きで、
  sorted member一覧・active plan version・各store head digest・plan topology digestを列挙する**
  （監査#4-7決定文案を全量採用。遷移ごとのmanifest更新は単一小file・同一lock内で許容）。
  統合readerは全memberをexactにロードし、欠落・余剰・重複active version・dangling/self edge・
  join欠落・merge後cycleを検査、一件でもあれば部分graphを返さない。glob discoveryは行わない。
- **laneの正本はtodo_plan.v1**（topologyの一部・immutable）。manifestはlaneを宣言せず、表示順の
  並べ替えのみ生成時オプションで許す。laneはpresentation-only projectionで、edge・最長依存鎖・
  capacityを生成しない。global capacity schedulingはv1非対象（監査#4-8）。
- **Git分岐はfast-forward onlyで受理**: merge commit・複数head・sequence renumber・digest手動
  resealをCIとreaderが拒否。競合は専用`lattice todo reconcile`で再発行し、元commit・元event
  digestをevent `provenance`に残す。fork解消前はrender・status・追加writeを全停止し、
  **reconcileだけがfork状態で許される唯一のmutation**。
- **並行可用性の限界を明文化**（Codex opinion#4）: 本規律が提供するのは「競合安全な直列化」であり
  複数端末の並行可用性ではない。**v1は事実上の単一writer運用を前提とする**。canonical branchは
  repoのdefault branch・upstreamは`origin`とし、writerは書込時に観測upstream commitをevent
  provenanceへ記録できる。offline時の書込はlocal直列化のみ保証され、push拒否＝fork検出時は
  reconcileまで追加writeを停止する。rebase/squash/mergeによるstore履歴の書換えは受理しない。
  reconcileはidempotent（同一resolution再適用で重複eventを作らない）を契約とする。
- **真実性3段階**: `unattested`（未commit、または未検証checkout）→ commit → CI `todo verify`
  通過=accepted。生成HTML・CLIはlocalで`todo verify`を再実行した結果として`local-verified`までを
  主張でき、`accepted`はCIだけが宣言する（HTMLはsource commit idと検証状態を表示する）。
  digestはcorruption検出でありactor真正性を証明しない。accepted truthはcanonical branch上で
  CI verifierを通過したcommitと定義する（監査#4-13）。enforcementの実体はCI/`todo verify`であり、
  「CLI経由のみ」はファイル権限では強制されない（監査#2落とし穴5）。

### 5. evidence descriptor

- completion evidenceはbare path/stringを禁止し、`{evidence_id, repo_id, path, git_blob_oid,
  content_digest, media_type, anchor_digest|null}`のtyped descriptorとする。**`git_blob_oid`
  （pinned object）が歴史的検証の正本**で、pathは表示・現在地案内用（Codex opinion#9）。
- `repo_id`→実repoの対応は`todo_manifest.v1`が宣言する。**done成立時（write時）はhard検証**
  （blob存在＋content digest一致。検証不能ならdoneを成立させない）。**read時**にpinned oidが
  解決不能（repo checkout不在・shallow等）な場合はstore全体を拒否せず、当該doneへ
  `evidence_unverified`注釈を付けて表示する（journal構造破損とevidence一時取得不能を同じ
  失敗へ潰さない）。説明用Markdown linkとdone evidenceは別field（監査#4-12）。

### 6. CLI面 — 新namespace `lattice todo`

- 新公開面は**`lattice todo <subcommand>`**へ統一。計画の仮称`lattice plan gantt`は
  **`lattice todo gantt`へ確定**——既存`plan compile/verify`はdispatch系であり同居させない。
  `todo verify`と`plan verify`の誤打鍵はusage診断で相互に案内せず黙って他面へ流さない（G2 fixture）。
- **subcommand契約表**（exact argv。共通規則: store rootはcwdのgit toplevel配下`.lattice/todo/`
  固定で探索しない。stdout=result schema 1行・stderr診断・exit 0/1/2・`cli_error.v2`・
  **exit 1/2時のstore bytes不変**）:

| subcommand | argv | result schema | wave |
|---|---|---|---|
| `todo start` | `--plan <key> --task <id> [--override-reason <text>]` | `todo_mutation_result.v1` | G5 |
| `todo block` | `--plan <key> --task <id> --reason <text>` | 同上 | G5 |
| `todo unblock` | `--plan <key> --task <id>` | 同上 | G5 |
| `todo done` | `--plan <key> --task <id> --evidence <descriptor.json path>` | 同上 | G5 |
| `todo reopen` | `--plan <key> --task <id> --reason <text> [--override-reason <text>]` | 同上（`target_done_digest`は内部で最新doneへ解決しeventへ記録） | G5 |
| `todo revise` | `--plan <key> --input <revision.json path>` | `todo_revise_result.v1`（successor version発行の唯一入口） | G5 |
| `todo verify` | `[--plan <key>]`（既定=全member） | `todo_verify_result.v1`（bytes・chain・遷移・evidence hard検証のlocal検証まで所有。CI attestationはCIの領分） | G2 |
| `todo snapshot` | `--rebuild --plan <key>` | `todo_snapshot_result.v1` | G2 |
| `todo gantt` | `[--out <repo相対ref>]`（既定`.lattice/generated/gantt.html`） | `todo_gantt_result.v1` | G3 |
| `todo reconcile` | `--input <resolution.json path>` | `todo_reconcile_result.v1`（手順詳細はG5着手時の追補で固定） | G5 |

- CAS期待値は引数に持たない（lock内内部取得。Decision 2）。mutation系はdry-runを持たない
  （fail closedが既定で、成功以外はstoreへ触れないため）。
- `todo gantt`のstdoutは**repo相対`output_ref`**＋input束縛digest群。絶対file://パスをportable
  resultへ入れない（解決はstderr診断またはdotagents hook側。監査#1-2）。result digestは単数でなく、
  sorted member manifest・各store head・active topology・evidence／埋込散文content digest・
  projection／renderer versionを含むversioned preimageへ束縛する（監査#4補記）。
- 既存面matrix（CLI 6面・runtime-errors・`--version`・`factory-diagnostics`・MCP）へ`todo`面を
  追加し、routing非回帰testを置く。`src/runtime-cli.mjs`のstale docstring（v1表記）もG2で追従修正
  （監査#1-9）。

### 7. 最長依存鎖projection（「critical path」の語を廃す）

- 監査#5-5のとおり、無duration DAGのhard_need最長鎖はcritical pathではない。v1は監査二択の
  どちらでもない**第三案**を採る: 全taskをunit-durationとみなし、**hard dependency＋join制約のみ**を
  辺集合とするlongest path構造を導出する。conflict系edgeは無向で経路に載らず（監査#1-3）、
  capacityはv1非目標のため辺集合に含めない。
- 名称は日本語**「最長依存鎖」**・英語**`longest dependency chain`**とする。「critical path」も
  「critical chain」も使わない（後者はGoldratt CCPMの資源制約込み術語で誤読を輸入する。
  fable諮問判断2・Codex opinion#6）。UI・受入文言も「最長依存鎖」を使い、表示には
  「unit-weightの構造深さであり実時間・資源律速ではない」旨を常時明記する。
- `todo_chain.v1`は**非列挙projection**とする（Codex opinion#5。最長鎖の全列挙は2,000 task内でも
  `2^1000`級に爆発する）: 内容は①最大依存深さ②いずれかの最長鎖に属するnode/edgeの和集合
  ③最長鎖本数（上限付きcount＋overflow flag）④deterministicな代表鎖を最大8本。
  `assumptions`固定literal field（`unit_duration: true`・`capacity_ignored: true`・
  `conflict_ignored: true`）を必須で持つ。
- 統合graphはmerge後に独立DAG validatorを通してから投影する。「現在地」は単一点でなく
  **active set**（in-progress集合）＋next-ready（依存充足済みpending）＋blocked reasonを
  別視覚要素として描く。

### 8. スケール契約と表示縮退

- merged display graphの上限: **task 2,000・edge 8,000・埋込散文 8 MiB（raw bytes・1節256 KiB）・
  出力HTML 24 MiB**。超過は`TODO_SCALE_EXCEEDED`（cli_error.v2 detail=超過内訳）でfail closedし、
  部分描画しない（集約・分割はエラーメッセージで指示）。
- **上限の意味**: これはparser/renderer安全上限であり**可読性の保証ではない**（Codex opinion#8）。
  可読性は折畳み・段階開示（G3）が担う。
- **根拠と存在証明**: 値は現行dotagents実workload実測の約10倍marginの仮置きで、**上限値ちょうど
  （task 2,000/edge 8,000）のレンダラ性能fixtureがG3 gateでgreenであることを存在証明とする**。
  fixture形状は境界値N-1/N/N+1・長鎖・幅広層・完全二部層・高fan-out・Unicode escape膨張を含める。
  実測不能なら上限を検証済み規模へ引き下げるADR改訂を行う（fable諮問判断4）。
- 既定表示はplan/lane折畳み＋最長依存鎖とactive setを常時展開。表示密度の縮退規則はG3実装細部。

### 9. 散文埋込の安全規律

- MarkdownはHTML文字列として通さず、**AST→allow-list renderer**で埋め込む（raw HTML・画像・
  任意URL無効化。テキスト／属性／SVG／script JSONを別々にescape、`innerHTML`不使用）。
- 出力HTMLは`<head>`先頭のmeta CSP（`default-src 'none'`基調）＋network参照の**allow-list検査**
  （全URL-bearing属性・CSS・protocol-relative含む）。リンクは埋込節へのfragmentのみ許可
  （監査#5-3, 6）。

### 10. 非目標（再固定）

常駐化・外部PM SaaS・Markdown正本との二重管理・duration推定・カレンダー時間軸・
global capacity scheduling・v1での真正な履歴削除・複数端末の並行書込可用性（v1は単一writer運用）・
plan_graph既存schemaのin-place変更（必要ならv2化＋wire級別裁定）。

## Consequences

- G2はDecision 1〜5・6の`verify`/`snapshot`面・7を実装、G3が`todo gantt`（8・9含む）、G4が
  一回きり移行＋オーナー受入、G5がauthoring/reopen/revise/reconcile CLI・hook・cutoverを実装する
  （wave正本は実装計画）。
- dotagents側は受入・配線・憲法規範化のみを所有する（Phase LG対応表どおり）。
- 「critical path」の語は本ADRで廃したため、実装計画・親計画の受入文言は「最長依存鎖」へ追従させる。
- open item（G5着手時に追補ADRで固定）: reconcileのresolution.json契約・手順詳細・部分再発行の
  可否。revise input（revision.json）のfield契約。
- 既存timestamp validatorの`2026-02-30`受理はtodo族外の既存欠陥として残る。G2で影響を確認し、
  変更するならADR改訂（本ADRは適用をtodo族に限定）。

## 反証記録（G1作法の3枚ガードレール）

1. **`fable`スポット諮問**: 判断1（todo namespace）支持／判断2（名称）条件付き支持／判断3
   （reopen不在）**反対→採用を覆しreopenを第6 kindとして導入**／判断4（スケール上限）条件付き
   支持→根拠の置き方とfixture整合を反映。見落とし3点（reconcile契約・actor・manifest原子性）反映。
2. **`fable`×high refuter**: P0×3（genesis未定義・書込protocol自己矛盾・状態機械の非関数性）・
   P1×4（join意味論・per-schema上限とsnapshot契約・互換表・反証記録）・P2×9——**全16件を本文へ
   反映**（「Accepted不可」判定の根拠は全て解消）。
3. **クロスprovider Codex opinion（sol×xhigh・aitermレーン。正規入口codex-sidecarが
   `AUTH_LEASE_BUSY`のため一時切替・別欠陥として記録）**: 総合判定「設計方向GO・現版Accepted
   不可・P0解消までG2 HOLD」。P0×5→①snapshot分離とcrash matrix②遷移表の完全化（reopen＋
   `target_done_digest`）③cross-plan refの`expected_topology_digest`束縛④単一writer前提の明文化と
   受理matrix⑤最長依存鎖の非列挙projection——**全て本文へ反映**。P1×3（CLI契約表・名称・evidence
   `git_blob_oid`）も反映。スケール上限の意味論（安全上限≠可読性）を反映。

3枚とも「骨格は支持・細部P0解消が条件」で一致し、全指摘を反映済み。以上をもってAcceptedとする。
