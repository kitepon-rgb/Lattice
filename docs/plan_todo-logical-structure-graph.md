# plan: ToDo構造データとソース結合グラフ検査

- Status: Planned
- Lane: 統括（受入が多段に連鎖するため）。ただしオーナー裁定により、本campaignはLattice store、
  Peertable、Control、子エージェントを使わず、本文のMarkdown checkboxだけを工程正本とする
- Detailed design: [design_todo-logical-structure-graph.md](design_todo-logical-structure-graph.md)
- Owner: このCodex親が単独writerとして直列実装する
- Started: 未着手

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

- [ ] **sg03 — structure setとrealizationのexact contractを実装する**
  - Depends: sg02
  - Write: 新規`src/todo-structure-contracts.mjs`、`docs/schemas/`、focused tests、`package.json`のfiles
  - 内容:
    - `lattice.todo_structure_set.v1`、task planned構造、data port、data contract、code anchor、external contractを定義する。
    - `lattice.todo_structure_realization.v1`とsupersedesを含むappend-only recordを定義する。
    - exact key、bounded collection、canonical order、repo相対path、self digestを検証する。
    - graph／excludedの全task coverageとexcluded reasonを検証する。
  - 受入:
    - malformed、過大、非canonical、digest不一致、未知field、task重複がpointer付きtyped errorになる。
    - 既存plan schemaとindependence schemaを変更しない。

- [ ] **sg04 — schema取得・dry-run・入力保存を実装する**
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

- [ ] **sg05 — 既存source graphへのstructure anchor adapterを作る**
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

- [ ] **sg06 — 既存sensor diffをcommit provenanceへ投影する**
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

- [ ] **sg07 — task transform overlayとstructure固有findingを実装する**
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

- [ ] **sg08 — derived artifact、鮮度、revision migrationを実装する**
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

### Phase D — CLI・realization・機械gate

- [ ] **sg09 — compile／read CLIと自己記述guidanceを完成させる**
  - Depends: sg04, sg08
  - Write: `src/todo-cli.mjs`、`src/cli-help.mjs`、必要なguidance module、CLI tests
  - 内容:
    - `todo structure compile --plan --input`と`todo structure [--plan] --json`を実装する。
    - plan曖昧、未適用、missing、stale、inconsistent、unknownを別結果にする。
    - findingごとに正規の次操作を案内する。
  - 受入:
    - helpだけで入力→compile→read→realize→finalizeの順へ到達できる。
    - readがcompileを暗黙実行せず、missingを空consistentへ丸めない。

- [ ] **sg10 — task realization chainを実装する**
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

- [ ] **sg11 — todo doneとplan終端へ構造義務を配線する**
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

### Phase E — 表示と実動受入

- [ ] **sg12 — dashboardへ独立した構造検査面を追加する**
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

- [ ] **sg13 — 正負E2Eと互換回帰を通す**
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

- [ ] **sg14 — Peertable由来16件を移行fixtureとして実証する**
  - Depends: sg13
  - Write: Lattice repo内のfixture／evidenceだけ。Peertable repoはread-only
  - 内容:
    - `logical_dataflow.v0`をv1 structure setへ変換し、自由文で解決不能なanchorをunknownとして列挙する。
    - intentionalな依存欠落・shape不一致を入れ、findingが正しいtask／port／code refを指すことを確認する。
    - 修正入力でconsistentへ収束させ、planned→realized→finalの一周を通す。
  - 受入:
    - 「問題なし」の判断がfixtureの意図した正解と一致する。
    - Peertableのlive工程、room、credential、絶対pathへ依存しない。

### Phase F — 正典・品質・配布準備

- [ ] **sg15 — 公開契約・help・README・package surfaceを同期する**
  - Depends: sg11, sg12, sg14
  - Write: `docs/00_product-contract.md`、README、help、schema、package files、ADR参照
  - 内容:
    - opt-in、三値verdict、planned／realized、task／terminal gate、非適用plan不変を正典化する。
    - command、schema、error code、dashboard到達経路を公開面へ載せる。
    - 「AIが意味判断する」「自動で全planへ適用する」と誤読させる記述を置かない。
  - 受入:
    - CLI surface検査とproduct reachabilityが新機能の全入口を確認する。
    - package dry-runに必要なschema／module／fixture外公開資産が入る。

- [ ] **sg16 — 最終品質gateとMarkdown工程を閉じる**
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

- [ ] **sg17 — H操作: version／publish／install／公開smoke**
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
