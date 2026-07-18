# Lattice 工程表・ガント出力面 計画（Phase LG実装側）

**Status:** Active
**作成日:** 2026-07-18
**親裁定:** dotagents [Lattice編入計画 Phase LG](../../dotagents/docs/plan_lattice-factory-integration.md)（オーナー裁定 2026-07-18）・親queue 23
**対象repo:** Lattice（実装）／dotagents（消費者adapter・受入）

## 0. 背景

AIの規律ではToDoの順序・チェック消化を維持できないというオーナー裁定（2026-07-18）を受け、
工程表を機械管理する仕組みをLatticeへ実装する。外部PMツール（Plane等）は正本の二重化を生むため
不採用。Latticeは既に`lattice.plan_graph.v1`（immutable node・typed edge・capacity・join）で
ToDoのDAGを所有しており、**足りないのは工程store（status正本・§1.6-1）、critical path projection、
ガント出力面の3つ**。
（2026-07-18監査訂正・§1.7: 「DAGを所有」は過大評価だった。現行producerはhard dependencyを
生成しておらず〈conflict edgeのみ・`joins: []`固定〉、工程の依存関係はstoreのfirst-class fieldとして
新設する必要がある。）

## 1. 調査結果（2026-07-18・確定済み入力）

- **repo実査（dotagents統括）**: `plan_graph.v1`はnode/typed edge/capacity/joinを持つが、
  critical pathの明示保存とガント描画面は不在。`plan_input.v1`がToDo候補の入口、
  `plan_diff.v1`がToDo改良差分を所有（docs/00_product-contract.md）。
- **描画方式調査（Grok外部レーン）**: 比較3方式のうち **(a) inline SVG自前生成を採用**。
  - (a) inline SVG自前生成: 依存ゼロ・完全制御・純文字列構築。**採用**
  - (b) OSS lib埋込（frappe-gantt等）: license/埋込サイズ/表現の自由度で劣後
  - (c) mermaid gantt埋込: 依存edge矢印・critical path強調の表現力不足
  - 実装スケッチ: `computeCriticalPath(plan)`（hard_need edgeのみ）→`computeLayout(plan)`
    （wave段組み＝トポロジカル列。duration情報なしDAGはcolumn scheduleで写像）→
    `buildGanttSVG`（rect bar＋status class＋crit縁取り・arrow marker付path・joinはpolygon）→
    `renderStandaloneHTML`（inline style・data属性＋最小scriptでhover/click詳細とstatus filter）。
    status色: pending=#94a3b8 / in-progress=#3b82f6 / done=#16a34a / blocked=#dc2626・critical赤太縁。

## 1.5 オーナー裁定（2026-07-18・authoring方式）

1. **Markdownを常設的に解釈してガント化する方式は採らない**。Claude/Codexの
   ToDo書式に統一性がなく、柔軟解釈は品質欠陥の再生産になる。
2. **既存planのMarkdown取り込みは一回きりの移行変換**とする。変換で順序・依存が
   曖昧な項目は推測で埋めず、`unknown_requires_evidence`と同思想でfail closedし、
   オーナー／親の裁定で確定してから登録する。
3. **定常はToDoを最初から構造化データとして書く**。ただしAIにJSONを手書きさせず、
   **CLI経由でのみ書ける**契約にする（例: `lattice todo add --after <id>` 型）。
   順序違反・依存欠落・evidenceなしdoneはツールが書込時に拒否する。
4. **正本の二層構造**: 工程（task・依存・status・evidence ref）は構造化store、
   散文（背景・裁定・非目標・罠）はMarkdownのままnodeからリンク。既存planの
   checkbox列は移行完了後に廃止し、mdは散文専用へ痩せる。

## 1.6 オーナー要求（2026-07-18・追加確定分）

1. **store形式は repo内の構造化JSONファイル**（SQL不採用）。決め手は性能でなく
   ①git同期＝「GitHubが真実」の既存運用に乗る（SQLiteはbinary blobで失格）
   ②Lattice既存契約（versioned JSON＋digest束縛）と同じ監査道具が効く
   ③1行1itemのcanonical serializationでgit diffレビュー可。
   形は current snapshot＋append-only遷移journal。SQLは実測で並行書込み限界が出た時の別裁定。
2. **左右ペインUI**: 左＝ガント、右＝散文。右ペインの動作（オーナー要求 2026-07-18追記）:
   - **非選択時（既定）**: 全taskの散文を従来の計画書のように**全文一覧表示**する
     （ガントを開く＝計画書を読む体験を置き換える）
   - **task選択時**: 該当taskの散文（背景・裁定・受入条件・evidence）だけへ切替
   - **右ペイン最上部に「全文表示へ戻る」ボタン**を常設し、1クリックで既定へ復帰
   自己完結要件を保つため、生成時にnodeがリンクするMarkdown節をHTML内へ埋め込む。
   各行の左端はtaskの短いラベル（1行）とし、長文は右ペインが担当する。
3. **プロジェクト内の全ToDo統合表示**: master＋全子計画のstoreを1グラフへmergeし、
   レーン／計画でグルーピングする。
4. **着手・終了の両フラグ必須**: 遷移journalに`started_at`／`done_at`（＋evidence ref）を
   独立に持ち、statusはその投影。バー上に両時刻を表示する。
5. **クリティカルパス表現必須**（§1スケッチどおりhard_need chainの強調）。
6. **アクセス性**: `lattice plan gantt`（仮称・G1で確定）が安定パス（gitignore対象の生成物root・
   G1論点③）へ再生成してrepo相対`output_ref`を返し、SessionStart hookが絶対file://パスへ解決して
   現在地と併せて毎session案内する。
7. **AIが自然に使う仕組み（3枚重ね）**: ①authoring CLIをcheckbox手書きより低摩擦にする
   ②hook接続（SessionStart=storeから現在地・次pending注入、Stop=commitあるのに遷移なしをWARN）
   ③移行完了時に憲法「計画文書の作法」へ「工程はLattice store・散文はMarkdown」を規範化。

## 1.7 Codex監査結果（2026-07-18・5レーン。全文は[evidence](evidence/2026-07-18-lg-codex-audit.md)）

計画の骨格（構造化正本・CLI限定書込・二層構造）は5レーンとも支持。ただしG1裁定なしに
実装へ入れないP0が9系統ある。要点だけ列挙し、決定文案はevidenceを正とする。

1. **前提訂正（契約レーン・storeレーンが独立に一致）**: 現行producerはhard dependencyを
   生成しない（`plan_input.v1`に依存field自体がなく、conflict edge＋`joins: []`固定。
   runtime front-endも`precedences: []`）。また`plan_graph.v2`・`runtime_plan.v1`も
   Accepted公開契約であり、「既存系列=v1のみ」の認識は誤り。→依存関係はstoreの
   first-class field。G1に全plan familyの互換表を置く。
2. **store×plan_graph裁定への推奨（storeレーン）**: 既存系列の拡張は却下——既存graph系は
   不変のdispatch用compile結果で、日常のstart/doneを受けるとdigest identityが壊れる。
   **新`todo_store.v1`契約＋source変更taskのみoptional compile binding**を推奨
   （評価表・契約境界スケッチ・落とし穴6件はevidence参照）。
3. **P0裁定9系統**: ①journalが唯一の正本・snapshotはprojection cache（不一致は
   `STORE_INCONSISTENT`で全拒否）②closed transition kindの状態機械（2時刻投影では
   blocked/resume不能。順序根拠はsequence、時刻は表示用）③topology immutable＋
   successor plan version（journalにtopology eventを混ぜない）④node ID=
   `{project_id, plan_key, node_id}` structured tuple＋store manifest列挙⑤並行書込=
   CAS＋`STORE_WRITE_CONFLICT`・Git分岐=fast-forward onlyで受理し専用reconcile CLIのみで
   解消⑥evidence ref=content digest付きtyped descriptor⑦「critical path」の数理は偽り
   （無durationのhard_need最長鎖はcritical pathでない）——定義変更か改称かの二択
   ⑧スケール契約（既存256上限 vs 全plan統合。折畳み・段階開示必須）⑨Markdown埋込XSS
   （AST→allow-list renderer必須。`http(s)://`文字列検査は不十分）。
4. **既存欠陥の発見**: timestamp validatorが`2026-02-30`を受理（regex＋`Date.parse`のみ）。
   G2のstrict round-trip parserで解消する。

## 2. 設計（実装契約の骨子。詳細はG1のADRで裁定）

- **新公開面**: `lattice plan gantt`（名称はADRで確定・本計画内はこの仮称で統一）。
  入力=工程store（§1.6-1）＋graph構造、出力=**単一の自己完結静的HTML**
  （外部CDN・SaaS・network参照ゼロ）。
- **既存CLI規約への追従**: 新CLIはADR 0044のsurface規約（stdout=versioned JSON 1行・診断stderr・
  exit 0/1/2・暗黙fallbackなし）とADR 0052 `cli_error.v2`に従う。HTML本体はfileへ書き、
  stdoutには**repo相対**の`output_ref`とdigestを含むresult JSONを1行返す（絶対file://パスを
  portable resultへ混ぜない。絶対パス解決はstderr診断またはdotagents hook側の責務）。
  authoring CLI（G5）も同規約の受入対象: 全subcommandのexact argv・成功result schema・
  exit matrix・**exit 1/2時のstore bytes不変（atomic replace/CAS）**をG1で列挙する。
- **storeとplan_graphの関係（G1最重要論点）**: §1.6-1の工程store（snapshot＋遷移journal）が
  既存`plan_input.v1`→`plan_graph.v1`系列の**拡張**なのか、より軽量な**新todo store契約**
  （graph compileを経ずに直接描画可能）なのかをG1で裁定する。**監査推奨（§1.7-2）は
  新`todo_store.v1`＋source変更taskのみoptional compile binding**——既存拡張はstatus churnが
  dispatch用digest identityを壊し、exact-key規律のin-place拡張禁止とも矛盾するため。
  G1はこの推奨を反証込みで採否裁定する。未裁定の間、実装は着手しない。
- **critical path projection**: graph構造からの純関数導出。versioned JSON
  （`lattice.critical_path.v1`仮）としてsource digestへ束縛。既存契約どおりexact key・
  bounded・fail closed。ただし**無duration DAGのhard_need最長鎖は数理的にcritical pathでは
  ない**（§1.7-3⑦）ため、G1で (A) unit-duration＋全schedule制約のlongest path=
  「logical critical chain」へ定義変更 か (B) hard_need限定を維持し「hard-dependency spine」へ
  改称（受入文言も撤回）かを二択裁定する。どちらでもactive set・次に着手可能node・
  blocked reasonを別視覚要素にする。
- **result digestの束縛**: `gantt_result`のsource digestは単数でなく、sorted member
  manifest・各store head・active topology・evidence／埋込Markdown content digest・
  projection／renderer versionを含むversioned preimageへ束縛する（§1.7・evidence補記）。
- **セッション中authoringの意味論（2026-07-18整理。監査決定文案の帰結を運用像へ固定）**:
  - **status遷移（start/done/block）は軽い日常動作**: journalへ1 event追記＋snapshot再生成。
    書込はCASで、並行セッションと競合したら`STORE_WRITE_CONFLICT`で無変更拒否（自動retryせず
    読み直してから打ち直す）。
  - **ToDo新規作成・依存変更は意図的に重い**: topology eventをjournalへ混ぜず、successor plan
    versionの発行になる。新genesisが旧version digest＋node移行mapへ束縛され、
    「セッション中に計画の形を変えた」ことが世代として消せない形で残る。
  - **真実性の3段階**: working treeの未commit書込=`unattested`表示 → commit → CIの
    `todo verify`通過=accepted。ガントはunattestedも描くがacceptedと表示上区別する。
    commitと遷移の食い違いはStop hookがWARN。
  - この非対称の狙い: 「AIが会話の勢いでToDoを書き換えて計画が溶ける」を構造で殺す。
    status更新は摩擦ゼロ、計画変更は痕跡必須。
  - ガントHTMLは静的生成物で自動更新されない。**再生成のタイミング（遷移成功後のhook自動
    再生成を含む）はG5のhook設計で裁定**する。
- **read-only第一級**: ToDoに変更がなくてもstore読取→描画だけを実行できる。描画はstoreを変更しない。
- **status**: statusはjournalの`started_at`／`done_at`（§1.6-4）の投影。遷移の書込強制
  （順序違反fail closed・evidence必須done）はG5のauthoring CLIが所有し、v1描画は
  store読取のみで完結する。

## 3. 実行TODO

### G1 — 契約裁定（F・契約クリティカル）
- [ ] ADR起草。論点（§1.7のP0裁定9系統＋evidence決定文案を一次入力とする）:
      ①**storeとplan_input/plan_graphの関係**（§2参照。監査推奨=新`todo_store.v1`＋optional
      compile bindingの採否。全plan familyの互換表〈v1/v2/runtime_plan〉と、Ganttが読む
      canonical directed graphの一択を含む）
      ②store schema（journal唯一正本＋snapshot projection cache・closed transition kindの
      状態機械・topology immutable＋successor version・JSONL byte契約・segment seal/rotation式
      compaction・digest束縛・evidence typed descriptor）
      ③store配置とgit扱い（`.lattice/`配下かdocs隣か。storeはcommit対象必須＝gitignore不可、
      **生成HTMLは別rootでgitignore・Codegraph coverageからも分離**）
      ④複数plan統合（node ID=`{project_id, plan_key, node_id}` tuple・store manifest列挙・
      merge後cycle等の閉包検査・laneはpresentation-only projection）
      ⑤並行書込と分岐（CAS＋`STORE_WRITE_CONFLICT`・fast-forward only・reconcile CLI・
      digestの信頼境界=真正性はCI verifier通過commitで定義）
      ⑥CLI名・入出力schema・critical path定義/名称の二択（§2）・スケール契約
      （merged display graphの上限とfail closed/集約方式）・Markdown sanitize方式
      （AST→allow-list）・timestamp strict parser
      ⑦error意味論（cli_error.v2準拠）・authoring CLIのexact argv/exit matrix/store無変更保証・
      既存面matrix（CLI 6面・runtime-errors・`--version`・`factory-diagnostics`・MCP）との責務分離
      作法: `fable`スポット諮問＋`fable`×high refuter 1回＋クロスprovider `codex_opinion` 1回
- [ ] 非目標をADRへ固定: 常駐化・外部SaaS・Markdown正本との二重管理・duration推定・自動再配置・
      global capacity scheduling・v1での真正な履歴削除
- [ ] **G1のdone条件**: ADRファイルがdocs/adrへ存在しAccepted・上記論点に未裁定ゼロ・
      諮問/refuter/cross-provider記録がevidenceへ収容済み・親（dotagents Phase LG）へ
      裁定結果を還流済み

### G2 — store契約＋critical path projection実装（A）
- [ ] 工程store契約の実装（schema validation・JSONL byte契約・digest・読取層。G1裁定に従う。
      書込はG4移行toolとG5 authoring CLIだけが行う。既存runtime event storeは流用せず
      汎用chain helperへ抽出して共有）
- [ ] byte-level fail closed fixture（duplicate key・invalid UTF-8・BOM/CRLF・truncated write・
      merge marker・symlink escape・schema version混在・genesis欠落・上限超過→全拒否）＋
      journal/snapshot不整合fixture（`STORE_INCONSISTENT`）
- [ ] timestamp strict round-trip parser（既存validatorの`2026-02-30`受理欠陥をここで解消し、
      既存契約側の影響有無も確認）
- [ ] critical path（またはG1裁定後の名称）純関数＋versioned projection＋fixture
      （分岐/join/複数最長鎖/空graph/merge後cycle拒否。§2の二択裁定に従う）
- [ ] codegraph coverage分離（store=tracked・生成HTML=gitignore）のintegration testを
      レンダラ実装より先に置く
- [ ] focused gate green

### G3 — SVG/HTMLレンダラ実装（A・左右ペイン＋散文埋込・全plan統合・started/done両時刻表示を含む）
- [ ] §1スケッチを基にした純文字列構築レンダラ＋`lattice plan gantt` CLI配線
      （ADR 0044 surface規約・安定パス出力＋repo相対`output_ref`のstdout result JSON）。
      レイアウトはlane優先＋交差低減（barycentric等）・既定表示はcritical＋選択node入出辺の
      段階開示・folding（§1.7-3⑧）
- [ ] Markdown埋込はAST→allow-list rendererで実装（raw HTML/任意URL無効化・script JSONは
      Unicode escape・`innerHTML`不使用・節byte上限）。XSS fixture（`javascript:`・`//host`・
      `data:`・`</script>`脱出・SVG event属性→全拒否）
- [ ] 右ペインの3状態実装（§1.6-2: 既定=全散文一覧／選択=該当散文／最上部「全文表示へ戻る」
      ボタン。全文一覧は表示切替のみで再生成しない＝埋込済み節の表示制御で実現）
- [ ] 自己完結検証fixture（network参照の**allow-list検査**〈全URL-bearing属性・CSS・
      protocol-relative含む〉・単一file・meta CSP `default-src 'none'`基調）＋
      file://直開きsmoke（開発者確認。オーナー目視はG4）
- [ ] スケール・可読性fixture（300/1,000 node規模のレイアウト破綻・超過時fail closed/集約）＋
      keyboard/ARIA最低線（イベント委譲controller・inline handler禁止）
- [ ] focused/related gate green

### G4 — 一回きり移行変換＋オーナー受入（dotagents側受入・§1.5裁定に従う）

依存ゲート: **G1 Accepted → G2 store読み書き面 → G3レンダラ → G4着手**。
repo交差の段階: Lattice commit → NPM配布/version pin → dotagents側配線 → オーナーH受入 → host適用。
rollback: G4開始前に両repoのHEAD・対象path・digestを記録し、受入失敗時は
「G3 accepted artifact＋G4前snapshot」へ戻す（host settingsはH承認まで適用しない）。

- [ ] 既存plan mdの**一回きり移行変換tool**（AI変換＋曖昧項目はunknownでfail closed→裁定後登録。
      常設のmd解釈pipelineは作らない。storeへの初回書込はこのtoolが担う）。
      対象planのcheckbox inventory・履歴時刻の変換規則（欠落はunknown、推定で埋めない）・
      `unknown_requires_evidence`項目の裁定記録と再登録手順を含む
- [ ] NPM配布・version pin・dotagents側での`lattice` CLI利用可能化（既存の工場更新経路に乗せる）
- [ ] dotagents側アクセス配線: SessionStart hookがガントの安定パスと現在地を毎session案内
      （§1.6-6。正本はdotagents settings断片・isolated HOME検証を通す）
- [ ] **受入: dotagents master planの実workloadをガント表示し、クリティカルパス（G1裁定後の
      名称）と現在地がブラウザで一目で判ること（オーナー目視）**。受入証跡とreject/retry記録を
      evidenceへ残す

### G5 — authoring CLI＋enforcement＋定着（A→dotagents側規範化）
- [ ] **authoring CLI実装**: ToDo追加・遷移（start/done/block/unblock。遷移表はG1裁定）を
      CLI経由に限定し、順序違反（`--out-of-order --reason`なし）・依存欠落・evidenceなしdoneを
      書込時拒否する（§1.5-3）。topology変更はsuccessor plan version経由（§1.7-3③）
- [ ] **enforcementの実体はCI/`todo verify`**: 「CLI経由のみ」はファイル権限では強制できない
      （手編集・Git mergeを防げない）。journal・snapshot・依存・done evidence・compile bindingの
      読取時再検証をCI必須gateへ入れて初めて強制になる（§1.7・storeレーン落とし穴5）
- [ ] hook接続: SessionStart=storeから現在地・次pending注入／Stop=commitあるのに遷移なしをWARN
      （§1.6-7②。正本はdotagents・isolated HOME検証）
- [ ] ガント再生成タイミングの裁定（§2セッション中意味論: on-demandのみか、遷移成功後の
      hook自動再生成を足すか。自動化する場合も描画失敗で遷移自体を巻き戻さない＝表示は投影）
- [ ] **cutover gate（一回で切替）**: 移行済みplanのcheckbox列廃止＋store正本化＋憲法
      「計画文書の作法」へ「工程はLattice store・散文はMarkdown」を規範化（§1.5-4。正本は
      dotagents `shared/constitution.md`）を同一gateで実施し、二重正本期間を作らない
- [ ] 公開契約（00_product-contract.md）・README・dotagents install/verify・生成憲法の同期

## 4. 非目標

- 常駐サービス化・外部PM SaaS採用・Markdown正本との二重管理（表示は生成物、正本は一つ）
- duration推定・カレンダー時間軸（v1はwave段組みの論理時間軸のみ。「critical path」の名称/定義は
  この非目標と整合するようG1で二択裁定・§2）
- plan_graphのschema変更（既存schemaは読むだけ。変更が必要ならin-place拡張でなくv2化＋wire級の別裁定）
- global capacity scheduling・v1での真正な履歴削除（compactionはseal/rotationのみ）

## 5. 検証

- G2/G3/G5はfixture snapshot＋`npm run ci` green。dotagentsへ触れるwave（G4/G5）は加えて
  dotagents側 `make ci`・`verify-install`・isolated HOME検証を通す。
- store契約はbyte-level fail closed fixture（§G2の列挙）を持つ。「green」だけでなく、
  期待するnode数・critical chain・status・exit code・stdout schemaをfixtureに固定する。
- 出力HTMLのnetwork参照ゼロはallow-list検査で機械検証（`http(s)://` grepでは不十分・§1.7-3⑨）。
- G4はdotagents実データでのオーナー目視受入＋受入証跡。
