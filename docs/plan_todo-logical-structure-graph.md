# plan: ToDo構造データとソース結合グラフ検査

- Status: In Progress
- Lane: 統括（受入が多段に連鎖するため）。ただしオーナー裁定により、本campaignはLattice store、
  Peertable、Control、子エージェントを使わず、本文のMarkdown checkboxだけを工程正本とする
- Detailed design: [design_todo-logical-structure-graph.md](design_todo-logical-structure-graph.md)
- Owner: このCodex親が単独writerとして直列実装する
- Started: 2026-08-11

## 1. 成果

Lattice工程表の定義後、対象planだけがcode-dataflow構造を入力し、既存source、commit来歴、着手済み／
未着手／blocked ToDoを結合したグラフで問題を検査できる。対象ToDoのdone時にはrealized構造を必須にし、plan終端では
最終sourceと全realizedのconsistentなfinalizationを必須にする。

## 2. 今回の工程管理裁定

- `lattice status`、`todo migrate`、`todo start`、`todo note`、`todo done`等を本campaignの工程管理へ使わない。
- Peertable room、席、DM、task event、相互監査を本campaignへ使わない。
- task状態は本文の`[ ]`／`[x]`だけが持つ。進捗・判断・実測値も対応taskへ直接追記する。
- writerは一人。並行writerを置かず、同一repoでの競合判定を自前で代用しない。
- Latticeの内蔵sensorとGitは、実装対象機能の入力・検証として使用してよい。工程管理への利用とは区別する。
- publish、global install、本番dashboard deployはH操作として別途オーナー承認を得る。

## 3. 着手前の現在地

2026-08-11の観測:

- repo: `/Users/kite/Developer/Lattice`
- branch: `main`
- HEAD: `48881cee9f13ac6e6c4a1c5cd086d85eeba1f753`
- `origin/main`に対してbehind 0／ahead 28
- 既存の未コミット差分あり: `.lattice/project.json`、Peertable dogfood repairのstore、
  `.team/scripts/done.sh`、未追跡room archive

今回の新規文書以外の差分をstage、commit、stash、reset、revertしない。実装着手前に既存WIPの所有と
着地状態を再確認し、同じ共有木で安全に続けられなければ、オーナーへ説明した上で専用worktreeへ分離する。

## 4. 非目標

- 非code planへの自動適用
- 並列可否／conflict／capacity／seam判定の再実装
- Lattice内部からのAI呼出し、自由文の意味推論、fuzzy symbol接続
- dirty worktreeの検証済み固定
- plannedの破壊的上書き
- commit messageによるtask帰属推定
- 既存sensor／boundary／DAG／Git差分／artifact機構の再実装
- 本campaignを新機能自身で途中から管理すること

## 5. 作業ToDo

依存は各項の`Depends`が持つ。checkboxは実装・focused test・該当記録の三つが揃ってから`[x]`にする。

### Phase A — ベースラインと不変Decision

- [x] **sg01 — 既存面のcharacterizationとfixtureを固定する**
  - Depends: なし
  - Write: `test/`の新規fixture／test、`docs/evidence/`の新規記録。baselineを止めた既存store競合だけ
    `src/todo-store.mjs`を最小修理する
  - 内容:
    - 詳細構想§4.5の再利用対応表を実コード・既存testと照合し、各能力の正本module／関数／入出力を記録する。
    - 新規実装が必要な欄を「structure固有contract／adapter／finding／gate」に限定し、parser、index、
      source graph、sensor diff、DAG、cycle、Git process、artifact鮮度を再実装しない境界を固定する。
    - 構造機能の無いplanについて、create／migrate／status／show／start／done／phase acceptの現行出力を固定する。
    - independenceのwitness、artifact、鮮度、sensor exact解決、Git path差分の再利用可能面を実測する。
    - Peertable 16 ToDoの`logical_dataflow.v0`を、外部秘密と絶対pathを除いた固定fixtureへ移す。
    - consistent、dependency missing、shape mismatch、orphan output、unknown anchor、planned→realized driftの
      最小正負例を作る。
    - `readTodoStoreStable`が一時的なmanifest書込み窓を恒久破損と誤判定する既存競合を、attempt上限まで
      typed errorを保持する形へ直す。恒久破損は最後の具体的reasonを返す。
  - 受入:
    - 再利用対応表の各行に、呼び出せる既存関数または不足を示す再現結果がある。
    - 既存関数の使い方が分からないことを理由にした代替実装が0件である。
    - 新機能実装前の現行挙動でbaseline testがgreen。
    - fixtureがLattice／Peertableのlive storeを読まず、単独で再現する。

- [x] **sg02 — ADRで所有境界とgateを固定する**
  - Depends: sg01
  - Write: `docs/adr/`の新規ADR、`docs/00_product-contract.md`はDecision確定後だけ
  - 内容:
    - plan定義後の明示opt-in、planned／realized／effective、三値verdictをDecision化する。
    - source＋commit provenance＋active/pending ToDoの四層、並列性解析との分離を固定する。
    - 既存graphを正本とし、今回の新設範囲をstructure overlayへ限定するDecisionを固定する。
    - task doneのrealization gate、plan終端のfinalization gate、未適用plan不変を固定する。
    - authoritative compileはclean worktreeのみ、読取は保存artifactから投影する境界を固定する。
  - 受入:
    - ADRが設計文書の主要判断を網羅し、未決事項を実装者へ押し付けない。
    - product contractへ複製せず、公開保証だけを短く還流できる。

### Phase B — 構造入力契約

- [x] **sg03 — structure setとrealizationのexact contractを実装する**
  - Depends: sg02
  - Write: 新規`src/todo-structure-contracts.mjs`、`docs/schemas/`、focused tests、`package.json`のfiles
  - 内容:
    - `lattice.todo_structure_set.v1`、task planned構造、data port、data contract、code anchor、external contractを定義する。
    - `lattice.todo_structure_realization.v1`とsupersedesを含むappend-only recordを定義する。
    - planned compile成功を不可逆に記録する`lattice.todo_structure_binding.v1`を定義する。
    - exact key、bounded collection、canonical order、repo相対path、self digestを検証する。
    - graph／excludedの全task coverageとexcluded reasonを検証する。
  - 受入:
    - malformed、過大、非canonical、digest不一致、未知field、task重複がpointer付きtyped errorになる。
    - 既存plan schemaとindependence schemaを変更しない。

- [x] **sg04 — schema取得・dry-run・入力保存を実装する**
  - Depends: sg03
  - Write: `src/todo-cli.mjs`、必要な小module、CLI tests、help／schema tests
  - 内容:
    - `todo structure --schema --json`をstore非依存で返す。
    - compile前dry-runでplan identity、topology、baseline ancestor、task coverageまで検査する。
    - AIが作ったplanned sourceを`.lattice/todo/structure/<plan_key>.json`へ唯一のwriterで保存する。
    - 構造入力の無いplanを有効化済みに見せない。
  - 受入:
    - dry-run失敗時にstore、structure source、dashboard registryのbytesが変わらない。
    - repo外inputや不正pathが既存authoringと同じ規律で拒否される。

### Phase C — ソース・commit・ToDo結合コンパイラ

- [x] **sg05 — 既存source graphへのstructure anchor adapterを作る**
  - Depends: sg03, sg01
  - Write: 新規の薄い`src/todo-structure-source-adapter.mjs`、既存sensor adapterの必要最小加算、focused／integration tests
  - 内容:
    - structure anchorを既存sensor queryへ変換し、`collectSensorEvidence`／`portableSensorOutcome`から
      file／symbol／edgeのbounded projectionを作る。
    - read／modify／deleteのexact存在、createの不在、複数候補、path-only coverageを区別する。
    - sensor未初期化、stale、版不一致、欠損をunknownとして返す。
    - 新しいparser、index、node ID、edge extractorを作らない。既存node／edgeで不足する場合は実装を止め、
      不足evidenceをsg02の設計へ差し戻す。
  - 受入:
    - fuzzy一致が一件も検証済みanchorへ入らない。
    - 全codebaseをartifactへ複製せず、excluded／omitted件数を保持する。
    - 同じqueryに対するstructure adapterとindependence側のsensor outcomeが同じportable evidenceを指す。
  - 実施記録（2026-08-11）:
    - structure setを既存`status`／`affected`／`query`／`callers`／`callees`へ決定的に変換し、
      anchor到達範囲だけを自然キー・128 edge/方向・portable evidence digestへ投影した。
    - read／modify／deleteのexact存在、createの不在、path-only、複数候補、時点保留、sensor非readyを
      `consistent | inconsistent | unknown`とtyped reasonで区別した。excluded task数、既知omitted edge数、
      sensor側200件上限到達もartifactへ残す。
    - 既存traversal CLIがexact候補とsuffix候補のedgeを混載し得る不足を実コード照合で発見したため、
      通常挙動を変えない`--exact-path`を追加した。既存indexのnode IDは内部走査だけに使い、projectionへ出さない。
    - plan全体で最大512 anchor、4096 port、2048 operation、4096 sinkへboundedにし、最大query数が
      task別上限の積で無制限に膨らまないようcontractで止めた。
    - 実測: rootの関連27 test、sensor型検査、strict選択3 test、実build済みCLI E2E 2 testがgreen。
      `npm pack --dry-run --ignore-scripts`でsource adapter、sensor CLI、strict helperの同梱を確認した。

- [x] **sg06 — 既存sensor diffをcommit provenanceへ投影する**
  - Depends: sg03, sg05
  - Write: 新規の薄い`src/todo-structure-git-adapter.mjs`、`src/git-process.mjs`は必要な共通入口だけ、tests
  - 内容:
    - baseline ancestor、`baseline..HEAD`のcommit列、path add／modify／deleteを決定的に読む。
    - base/currentの`compareSensorIndexes`結果からsymbol／edge変化を再計算せず受け取る。
    - realizationのcommit OIDをchangesetへ結び、commit messageを読まない。
    - unreachable、shallow、rename、submodule、binary、巨大差分をtypedに分類する。
  - 受入:
    - current sourceとcommit内容を二重node化せず、commitはprovenance edgeになる。
    - Windowsを含むGit processは`src/git-process.mjs`だけを通る。
    - node自然キー、edge差分、comparability、excluded／truncationの意味を`compareSensorIndexes`と二重定義しない。
  - 実施記録（2026-08-11）:
    - clean worktree、HEAD、baseline object、祖先関係を別々のtyped errorで検査し、`rev-list --parents`と
      range単位のraw／numstatから最大512 commit・4096 path change・500万変更行のchangesetを作った。
      merge commitの差分はGitの`--diff-merges=first-parent`へ委ね、messageは取得していない。
    - add／modify／delete／rename／copy／type change、regular／symlink／submodule／special、binaryを
      Gitのstatus・mode・numstatから分類した。shallow、非祖先、非UTF-8 path、過大履歴／差分を別codeで止める。
    - `compareSensorIndexes`のbounded resultからhost固有root／databaseだけを除き、自然キー明細、
      comparability、summary、excluded、integrity、truncationを改変せずdigestへ束縛した。
    - realizationは明示されたcommit OIDだけをchangeset digestへ結び、range外OIDを拒否するpure入口を追加した。
    - 実測: sg06固有7 test（実Git rename／binary／symlink／Gitlinkを含む）と既存sensor diff 15 test、
      sg03／sg05関連15 testの合計37件がgreen。

- [x] **sg07 — task transform overlayとstructure固有findingを実装する**
  - Depends: sg03, sg05, sg06
  - Write: 新規`src/todo-structure-overlay.mjs`とstructure固有rule module、contract／compiler tests
  - 内容:
    - planned／realized taskをtransform node、portをdata edgeへ正規化する。
    - existing source、commit provenance、active／pending／blocked task、external contractを既存graphへoverlayする。
    - ToDo到達性・cycle・依存鎖は`projectTodoChainV1`／`analyzeDagChains`／storeの既存検証を再利用し、
      接続、data contract、code anchor、commit実現だけをstructure固有ruleとして足す。
    - `consistent | inconsistent | unknown`とtyped findingを作る。
    - findingを原因単位でdedupeし、観測値・期待値・関係node・次の一手を持たせる。
  - 受入:
    - dependency missingが追加すべきsource/target taskを返す。
    - shape／identity／lifecycle不一致と、証拠不足unknownが別codeになる。
    - independenceのconflict／wave／severabilityへ影響しない。
    - source node／edge、ToDo DAG、cycle algorithmの新しい正本を作らない。
  - 実施記録（2026-08-11）:
    - planned／latest realized transform、data port、bounded source node／edge、changeset、external contractを
      digestで束縛したoverlayを作り、realization commit→taskも明示edgeにした。current sourceやcommit内容を
      別のcode nodeとして二重計上していない。
    - ToDo topologyは`projectTodoChainV1`と同じnormalize結果をlossless投影する共通入口を追加し、
      pair到達性も`dag-chain.mjs`のnormalize／cycle判定上で行う狭い共通APIへ置いた。overlay固有の
      topology parser・cycle algorithmは作っていない。
    - coverage、input、orphan output、contract、dependency、cycle、anchor、sensor、commit、realizationの
      typed findingを実装し、同じcode／severity／evidence／next actionの原因はtask・data・code・commit参照を
      一件へ束ねた。最大1024件を返し、全件severity集計とomitted件数を残す。
    - exact symbol複数候補をsource projectionから失わずbounded自然キーでfinding evidenceへ渡すよう、
      sg05 adapterの投影不足も同時に修正した。
    - 実測: DAG共通API、sg03〜sg07 adapter、実Git分類、finding正負例の関連60 testがgreen。
      pack dry-runでoverlay／source／Git adapterの同梱を確認した。

- [x] **sg08 — derived artifact、鮮度、revision migrationを実装する**
  - Depends: sg07
  - Write: 新規`src/todo-structure-store.mjs`、必要な`todo-store.mjs`加算、store tests
  - 内容:
    - compile artifactをplan versionへ並置し、入力digestと鮮度キーへ束縛する。
    - 読取時にsensorを引かず、HEAD／topology／structure／realizationの差からfresh／stale／superseded／missingを返す。
    - structure sourceとrealization chainの破損を未設定へ丸めない。
    - plan revisionのtask migrationでIDを写す補助を用意し、意味の妥当性は主張しない。
  - 受入:
    - readは保存artifactと安いGit identity照合だけで閉じる。
    - staleなartifactがconsistentとして表示されない。
  - 実施記録（2026-08-11）:
    - source projection、Git provenance、overlay、realization head集合を相互digestで束縛する
      `lattice.todo_structure_compile_artifact.v1`を追加し、plan version並置のcanonical storeへ保存した。
      activation前のderived artifactは再生成でき、immutable binding発行後は上書きを拒否する。
    - 読取はsensor／Git diffを実行せず、保存artifactと`rev-parse HEAD`、active topology、planned source digest、
      task別realization chain headだけで`fresh | stale | superseded | missing`を返す。stale時は過去の
      compiled verdictを履歴として残すが、effective verdictへ`consistent`を出さない。
    - realization chain readerはcanonical JSONL、sequence、previous digest、supersedes、planned identityを検証し、
      chain未作成の`[]`と破損のtyped failureを分離した。append writerはsg10へ残した。
    - revision helperは既存`task_migration`によるtask／task-output／sink IDの一対一写像だけを行い、
      `semantic_validation: required`を明示して意味の継続を主張しない。
    - 実測: structure sg03〜sg08と既存independence storeの関連54 test、syntax checkがgreen。
      pack dry-runで新規store moduleの同梱を確認した。

### Phase D — CLI・realization・機械gate

- [x] **sg09 — compile／read CLIと自己記述guidanceを完成させる**
  - Depends: sg04, sg08
  - Write: `src/todo-cli.mjs`、`src/cli-help.mjs`、必要なguidance module、CLI tests
  - 内容:
    - `todo structure compile --plan --input`と`todo structure [--plan] --json`を実装する。
    - plan曖昧、未適用、missing、stale、inconsistent、unknownを別結果にする。
    - findingごとに正規の次操作を案内する。
  - 受入:
    - helpだけで入力→compile→read→realize→finalizeの順へ到達できる。
    - readがcompileを暗黙実行せず、missingを空consistentへ丸めない。
  - 実施記録（2026-08-11）:
    - `todo structure compile --plan --input`をsource adapter→Git provenance→既存ToDo DAG→overlay→storeの
      一方向dataflowとして配線した。保存済みcanonical sourceと入力が一致する時だけcompileし、
      `consistent`だけimmutable bindingを発行する。`inconsistent`／`unknown`はfinding付きderived artifactを
      残すが有効化せず、入力修正後の再compileを許す。
    - `todo structure [--plan] --json`は保存artifactだけを投影し、plan曖昧、missing、inconsistent、unknown、
      consistent、staleを別coverageにした。staleではcompiled verdictを履歴表示しても有効verdictはnullにする。
    - finding自身の`next_action`を重複なく表出し、helpへinput→compile→read→realize→finalizeの全順序を載せた。
      read-only呼出しはdashboard ownershipを取得せず、sensorを暗黙更新しない。
    - 実測: 実sensor初期化＋実Git＋実CLIのconsistent、sensor未初期化unknown、orphan output inconsistent、
      missing、plan曖昧、sensor DB削除後read、HEAD driftを含むstructure関連49 testがgreen。
      syntax checkとCLI surface検査（67 command、undocumented／unexercised 0）がgreen。

- [x] **sg10 — task realization chainを実装する**
  - Depends: sg08, sg09
  - Write: structure store／CLI、realization tests
  - 内容:
    - `todo structure realize --plan --task --input`をappend-onlyで記録する。
    - planned digest、task、HEAD、commit OID、code anchorを検証する。
    - 訂正はsupersedesで行い、旧recordとplannedを残す。
    - effective構造とplanned→realized差分を投影する。
  - 受入:
    - stale planned、他task commit、unreachable commit、壊れたsupersedes chainを拒否する。
    - correction後も全履歴と現行recordを区別して読める。
  - 実施記録（2026-08-11）:
    - `todo structure realize --plan --task --input`を追加し、active binding、planned digest、CLI target／actor、
      current HEAD、sequence／previous digest／supersedesをstore lock内で検証してcanonical JSONLへ追記する。
      拒否時はchain fileを作らず、既存chain bytesも変えない。
    - 既存Git provenance adapterへ`requireClean: false`のcommit-only読取を加えた。realization入力等のdirty
      worktreeを証拠へ混ぜず、明示commitが`baseline..HEAD` changesetに存在するかを既存binding関数で照合する。
      commit messageは引き続き読まない。
    - 他task chainがclaim済みのcommitを拒否し、realizedの全create／modify／delete anchor pathが明示commitの
      changesetと交差することを要求した。同一taskの訂正は同じcommitを再利用できる。
    - 通常readへplannedを保持したeffective transform、changed fields、全realization履歴、現行head digestを追加した。
      superseded recordは履歴に残り、最新sequenceだけがeffectiveになる。
    - 実測: stale planned、unreachable commit、anchor非交差、他task claim、壊れたsupersedes、正常訂正、
      planned→realized差分を含むrealization 3 E2Eと関連store／CLI／Git adapter計28 testがgreen。

- [x] **sg11 — todo doneとplan終端へ構造義務を配線する**
  - Depends: sg10
  - Write: `src/todo-cli.mjs`、`src/todo-store.mjs`、audit/status投影、focused tests
  - 内容:
    - 有効化済みplanのgraph taskだけ、fresh realization無しのdoneをjournal書込前に拒否する。
    - excluded／未適用planのdone bytesと意味を維持する。
    - `todo structure finalize --plan`で最終source＋全realizedを再compileする。
    - consistentでfreshなfinalizationが無ければterminal accept／完走projectionを保留する。
    - HEAD、topology、structure、realization変更でfinalizationをstaleへ戻す。
  - 受入:
    - gate拒否時にlifecycle journal、snapshot、manifest、structure chainのbytesが変わらない。
    - 全task doneでもfinalization不足がaudit_pending／statusで見える。
    - 構造未適用planの既存E2Eがbyte互換または明示したschema互換を保つ。
  - 実施記録（2026-08-12）:
    - immutable bindingを持つplanのgraph taskだけにdone前gateを接続した。realization欠落とHEAD driftを
      journal書込前にtyped拒否し、excluded／未適用planは従来経路を保った。
    - `todo structure finalize --plan <key> --json`を追加し、全task done、全realization、最終HEAD、
      effective code anchorのsensor観測、Git provenance、ToDo DAGを再結合する。consistent時だけ
      finalization artifactを書き、HEAD／topology／structure／realization headの変化をstaleへ戻す。
    - terminal `phase_accept`／`phase_close_unaudited`をfresh consistent finalizationで保持した。
      `todo status`はv7の`structure_finalization_pending`、`phase status`はv2のtyped状態とguidance、
      `project status`は同じ正規commandを返す。dispatch frontierはこの列を入力にしない。
    - 実Git・実sensor E2Eでmissing/stale realization、excluded done、finalization不足、finalize成功、
      terminal受理、受理後HEAD staleを一周した。拒否前後でmanifest、journal、snapshot、realization chain、
      finalization refのbytesが同一であることを固定した。
    - CLI surface正本に従来漏れていた`todo structure` namespaceも追加し、68 commandで
      undocumented／unexercised 0を確認した。
    - 実測: structure／status／terminal／project関連134 test、syntax 166 filesがgreen。

### Phase E — 表示と実動受入

- [x] **sg12 — dashboardへ独立した構造検査面を追加する**
  - Depends: sg09, sg10
  - Write: todo Gantt／dashboard presentationの加算module、HTML/SVG tests
  - 内容:
    - 工程依存図へdataflow edgeを混ぜず、別の「構造検査」面を作る。
    - task、data、code、external、commit provenanceを区別して表示する。
    - planned／realized／effective、finding、unknown、次の一手を表示する。
    - findingから問題node／edgeへ移動できるようにする。
  - 受入:
    - 工程依存とdataflowを同じ線として誤読しない。
    - 問題箇所と修正対象を3秒で特定でき、非script環境でもfinding一覧は読める。
  - 実施記録（2026-08-12）:
    - 保存済みsource／realization／compile／finalization artifactだけからboundedなGantt用projectionを作る
      加算moduleを追加した。描画時にsensorを起動せず、finalization後は着手前のactivation artifactでなく
      最終形態を再compileしたfinalization artifactを表示正本にする。
    - 既存の工程依存SVGは変更せず、右ペインへ独立した「構造検査」を追加した。task変換、data、code、
      既存source symbol、external contract、commit provenanceを種別付きnode／edgeとして表示し、
      planned／realized／effective差分、code anchor、変更path、freshness、finalization状態を同じ面で読める。
    - findingを先頭に置き、severity、関係node、既存edge、次の一手を表示した。node／edgeへのbuttonは対象を
      focusして中央へ移動する。unknownはconsistentへ丸めず、script無効時も`noscript`のfinding一覧を残す。
    - live head digestへstructure projection digestを束縛したため、保存artifactの変化も既存SSE更新経路で
      dashboard再描画を起こす。構造未適用planはbutton／panelを追加しない。
    - 実測: Gantt全110 test、finalization→通常Gantt描画を含むrealization 4 test、syntax 168 files、
      CLI surface 68 command（undocumented／unexercised 0）がgreen。

- [x] **sg13 — 正負E2Eと互換回帰を通す**
  - Depends: sg11, sg12
  - Write: `test/integration/`、fixture、必要な共通test helper
  - 内容:
    - 実Git repo、実sensor、複数commit、pending／in-progress／done taskでplanned compileを通す。
    - dependency missing、shape mismatch、orphan、anchor absent、unknown、dirty、staleを負例で固定する。
    - realize→done→全task done→finalize→terminal受理を一周する。
    - 構造未適用planが従来どおり完走することを確認する。
    - testで作ったworktree、sensor daemon、temp storeを共通fixtureで必ず回収する。
  - 受入:
    - 欠陥版で負例が落ち、修正版でgreenになる。
    - fixture外のlive Lattice／Peertable storeを変更しない。
  - 実施記録（2026-08-12）:
    - 共通fixtureでtemp Git repo、実todo store、三plan、実sensorを作り、fixture pathを含む残存processを
      SIGTERM→SIGKILLで回収してからtemp repoを削除する終了契約へ載せた。全CLIはfixture cwdと相対refだけを
      使い、live Lattice／Peertable storeへ触れない。
    - `negative` planでsensor未初期化unknown、dependency missing、shape mismatch、orphan output、
      anchor absent、dirty worktreeを別の期待codeへ固定した。consistentだけがbindingを発行し、その後の
      HEAD変更でcompiled verdictを有効なconsistentへ残さずstaleへ戻すところまで実Gitで確認した。
    - `lifecycle` planでpending→in-progress→実装commit→realize→done、excluded done、全task done、
      sensor再同期、finalize、terminal closeを一周した。`plain` planはstructure入力なしで従来の
      start→done→terminal closeを完走した。
    - 実sensor exact symbolの検索候補に浮動小数`score`が含まれ、構造artifact digestが拒否される欠陥を
      E2Eで発見した。shared sensor outcomeは変えず、構造evidence identityが消費するnode候補からだけ
      非意味的な検索順位scoreを除外し、異なるscoreでも同じdigestになる退行testを追加した。
    - 実測: 新規統合E2E 1件と構造全59 test、syntax 168 files、CLI surface 68 command
      （undocumented／unexercised 0）がgreen。

- [x] **sg14 — Peertable由来16件を移行fixtureとして実証する**
  - Depends: sg13
  - Write: Lattice repo内のfixture／evidenceだけ。Peertable repoはread-only
  - 内容:
    - `logical_dataflow.v0`をv1 structure setへ変換し、自由文で解決不能なanchorをunknownとして列挙する。
    - intentionalな依存欠落・shape不一致を入れ、findingが正しいtask／port／code refを指すことを確認する。
    - 修正入力でconsistentへ収束させ、planned→realized→finalの一周を通す。
  - 受入:
    - 「問題なし」の判断がfixtureの意図した正解と一致する。
    - Peertableのlive工程、room、credential、絶対pathへ依存しない。
  - 実施記録（2026-08-12）:
    - 秘密除去済み`logical_dataflow.v0` fixtureの16件を、plan境界ごとのv1 structure set 9本へ
      test専用の決定的変換で移した。outcome／receive／organize／emit／failure／初回E2E／非目標を
      v1 contractへ保持し、全setがruntime validatorを通過した。
    - v0がcode path／symbolを持たない16件は推測で埋めず、同じtask refへ
      `logical_dataflow_v0_has_no_code_path_or_symbol`を列挙し、code anchorを空のまま残した。
    - task announcementの`a2 → a3`へ意図的なhard dependency欠落とshape不一致を入れ、findingが
      `a2`／`a3`および`a2/emit-01`／`a3/announcement-in`を指すことを固定した。
    - dependencyとconsumer shapeを修正してplannedをconsistentへ収束させ、a2のrealization、done状態、
      commit provenanceを重ねたfinal compileでもconsistent、realized node、a3 sinkを確認した。
    - Peertable live repo／room／credential／絶対pathは未使用。移行判断と実測は
      `docs/evidence/2026-08-12-peertable-structure-migration.md`へ記録し、fixture test 4/4がgreen。

### Phase F — 正典・品質・配布準備

- [x] **sg15 — 公開契約・help・README・package surfaceを同期する**
  - Depends: sg11, sg12, sg14
  - Write: `docs/00_product-contract.md`、README、help、schema、package files、ADR参照
  - 内容:
    - opt-in、三値verdict、planned／realized、task／terminal gate、非適用plan不変を正典化する。
    - command、schema、error code、dashboard到達経路を公開面へ載せる。
    - 「AIが意味判断する」「自動で全planへ適用する」と誤読させる記述を置かない。
  - 受入:
    - CLI surface検査とproduct reachabilityが新機能の全入口を確認する。
    - package dry-runに必要なschema／module／fixture外公開資産が入る。
  - 実施記録（2026-08-12）:
    - README日英へ、code planだけの明示opt-in、schema→input→compile→read、三値verdict、
      append-only realization、done／finalize gate、未適用plan不変を同じ操作順で追加した。
    - 動的dashboardの構造検査を工程依存図とは別面として説明し、task／data／code／external／commit、
      planned／realized／effective、finding／freshnessを保存artifactから読むこと、dataflow edgeを工程線へ
      混ぜないことを公開した。
    - `docs/00_product-contract.md`へ5操作＋2読取、公開schema三面、sensor ownership、node／edge移動と
      noscript findingを正本化した。helpはfresh realization done gate、fresh consistent terminal gate、
      独立dashboard面をstore非依存で案内する。
    - package filesにstructure set／realization／bindingのJSON Schema三面と全`src` moduleが入る既存契約を
      維持し、公開文書の必須語彙を退行testへ固定した。
    - 実測: help／contract 16 test、syntax 168 files、CLI surface 68 command
      （undocumented／unexercised 0）、product reachability 114 module（未到達0）がgreen。

- [x] **sg16 — 最終品質gateとMarkdown工程を閉じる**
  - Depends: sg15
  - Write: 本文checkbox、必要なevidence
  - 内容:
    - 各taskのdiff、受入条件、focused test、未検証範囲を一回照合する。
    - `npm test`、`npm run test:sensor`、`npm run check`、`npm run check:cli-surface`、
      `npm run check:open-questions`、`npm run check:reachability`、`npm run ci`を関連gateとして実行する。
    - `npm pack --dry-run`で配布filesを確認する。
    - 既知の無関係な失敗は再現・所有・分離を記録し、本機能のgreenへ丸めない。
    - git diff、未追跡、既存WIPとの混入を確認し、対象限定commit候補を作る。
  - 受入:
    - 全checkboxと実態が一致し、未実装・未検証・carry overを明示する。
    - 新機能の正負E2Eと全関連gateがgreen。
  - 実施記録（2026-08-12）:
    - sg01〜sg15の差分63 file（9,033 insertions／102 deletions）を`main...HEAD`で照合し、
      planned compile、三値finding、realization／finalization gate、独立dashboard面、未適用plan互換、
      Peertable由来16件fixtureが各受入へ対応していることを確認した。`git diff --check`もgreen。
    - `npm test`はproduct gate 196 suite／1,756 testが全件成功した。`npm run test:sensor`は
      147 file／2,308 testが成功し、環境別parity 183 testは既定skip、失敗0だった。
    - syntax 168 files、CLI surface 68 command（undocumented／unexercised 0）、open question 29件
      （unanchored 0）、product reachability 114 module／research artifact 33件（未到達・stale宣言0）がgreen。
      `npm run ci`でも同じ全gateと`verify:todo-store`を一括再実行して完走した。
    - `npm pack --dry-run --json`はexit 0、825 entry、tarball予定7,482,429 bytesだった。structure set／
      realization／bindingの3 schema、`todo-structure-*` runtime、独立Gantt moduleが配布一覧に入ることを
      実物で確認した。publish、version bump、global install、公開dashboard変更は行っていない。
    - 未追跡は依存物`node_modules/`と`sensor/node_modules/`だけで、成果commitへ含めない。
      実装上のcarry overはなく、残るsg17はオーナー承認が必要な公開H操作として分離した。

- [x] **sg17 — H操作: version／publish／install／公開smoke**
  - Depends: sg16
  - Approval: オーナーの明示承認が必要
  - 内容:
    - 対象commitが既定ブランチ祖先であることを確認する。
    - version bump、npm publish、global install、dashboard再起動を承認範囲で行う。
    - インストール版CLI、実repo、公開dashboardでschema→compile→finding→realize→finalizeをsmokeする。
    - rollback対象versionと戻し方を実行前に提示する。
  - 受入:
    - registryとnpmの公開version、global install、公開dashboardが同じcommitを指す。
    - 公開後smokeとrollback条件を記録する。
  - 実施記録（2026-08-12）:
    - オーナーの`H承認　やれ`を受け、0.58.0へversion bumpしたrelease commitを`origin/main`へ通常pushした。
      公開直前にSensor本番依存`picomatch 4.0.3`のReDoSを検出し、4.0.5へ更新、本番依存audit 0、
      Sensor 147 files／2,308 tests passを確認した修正commit `59095c77…`だけを公開対象にした。
    - `npm publish --access public`は成功し、registryの`latest`は0.58.0。事前packとregistry tarballのSHA-1は
      `a786dbfe00a8cd2996eeaa82e35354855b938f5d`で一致した。packは825 entries、7,482,428 bytes。
    - 公開npmをMacへglobal installし、`lattice --version`、global package、bridge runtimeを全て0.58.0へ揃えた。
      bridgeはheartbeat accepted、runtime driftなし。公開dashboardはHTTP 200で、HTMLに
      `lattice.todo_structure_presentation.v1`を確認した。現在の公開planは未適用なので`plans: []`が正しい。
    - global install版CLIで実Git＋Sensorの正負compile、finding、realize、finalize、未適用plan互換を一周し、
      integration 1/1 pass。rollbackはglobal installを0.57.3へ戻してdashboard／bridgeを再起動し、
      npm unpublishやmain履歴巻き戻しは行わない。
    - 受入matrix、依存監査、公開操作、rollback条件は
      `docs/evidence/2026-08-12-v0.58.0-todo-structure-release.md`、最終受理はADR 0169へ固定した。

## 6. 依存の要約

```text
sg01 → sg02 → sg03 → sg04
          └──→ sg05 → sg06 ─┐
                 └──────────→ sg07 → sg08 → sg09 → sg10 → sg11
                                                   └──────→ sg12
                                         sg11 + sg12 → sg13 → sg14 → sg15 → sg16 → sg17(H)
```

単独writerのため実行は原則この順に直列化する。読み取り調査とtest fixture作成が独立でも、
本campaignでは子エージェントや並行writerを使わないというオーナー裁定を優先する。

## 7. 完了条件

- sg01〜sg16が全て`[x]`で、記載した受入と実測が一致する。
- 構造未適用planの挙動不変が確認される。
- planned compile、問題指摘、realize gate、finalize gate、独立dashboard面が実在する。
- Peertable由来16件のfixtureがconsistentへ収束する。
- sg17は承認された場合だけ実施する。未承認なら製品実装完了と公開未実施を分けて報告する。
