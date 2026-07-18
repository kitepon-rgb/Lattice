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
2. **左右ペインUI**: 左＝ガント、右＝選択nodeの散文（背景・裁定・受入条件・evidence）。
   自己完結要件を保つため、生成時にnodeがリンクするMarkdown節をHTML内へ埋め込む。
3. **プロジェクト内の全ToDo統合表示**: master＋全子計画のstoreを1グラフへmergeし、
   レーン／計画でグルーピングする。
4. **着手・終了の両フラグ必須**: 遷移journalに`started_at`／`done_at`（＋evidence ref）を
   独立に持ち、statusはその投影。バー上に両時刻を表示する。
5. **クリティカルパス表現必須**（§1スケッチどおりhard_need chainの強調）。
6. **アクセス性**: `lattice plan gantt`（仮称・G1で確定）が安定パス（`.lattice/gantt.html`等）へ再生成して
   file://パスを出力し、SessionStart hookが現在地と併せて毎session案内する。
7. **AIが自然に使う仕組み（3枚重ね）**: ①authoring CLIをcheckbox手書きより低摩擦にする
   ②hook接続（SessionStart=storeから現在地・次pending注入、Stop=commitあるのに遷移なしをWARN）
   ③移行完了時に憲法「計画文書の作法」へ「工程はLattice store・散文はMarkdown」を規範化。

## 2. 設計（実装契約の骨子。詳細はG1のADRで裁定）

- **新公開面**: `lattice plan gantt`（名称はADRで確定・本計画内はこの仮称で統一）。
  入力=工程store（§1.6-1）＋graph構造、出力=**単一の自己完結静的HTML**
  （外部CDN・SaaS・network参照ゼロ）。
- **既存CLI規約への追従**: 新CLIはADR 0044のsurface規約（stdout=versioned JSON 1行・診断stderr・
  exit 0/1/2・暗黙fallbackなし）とADR 0052 `cli_error.v2`に従う。HTML本体はfileへ書き、
  stdoutには出力path・source digestを含むresult JSONを1行返す。
- **storeとplan_graphの関係（G1最重要論点）**: §1.6-1の工程store（snapshot＋遷移journal）が
  既存`plan_input.v1`→`plan_graph.v1`系列の**拡張**なのか、より軽量な**新todo store契約**
  （graph compileを経ずに直接描画可能）なのかをG1で裁定する。前者はboundary evidence契約と
  地続きになる代わりに日常ToDoへ重く、後者は軽い代わりに契約が一つ増える。
  未裁定の間、実装は着手しない。
- **critical path projection**: graph構造からの純関数導出。versioned JSON
  （`lattice.critical_path.v1`仮）としてsource digestへ束縛。既存契約どおりexact key・
  bounded・fail closed。
- **read-only第一級**: ToDoに変更がなくてもstore読取→描画だけを実行できる。描画はstoreを変更しない。
- **status**: statusはjournalの`started_at`／`done_at`（§1.6-4）の投影。遷移の書込強制
  （順序違反fail closed・evidence必須done）はG5のauthoring CLIが所有し、v1描画は
  store読取のみで完結する。

## 3. 実行TODO

### G1 — 契約裁定（F・契約クリティカル）
- [ ] ADR起草。論点:
      ①**storeとplan_input/plan_graphの関係**（§2参照・既存系列の拡張か新todo store契約か）
      ②store schema（snapshot＋遷移journal・canonical serialization・digest束縛・journal compaction方針）
      ③store配置とgit扱い（`.lattice/`配下かdocs隣か。git同期＝正本要件（§1.6-1）よりcommit対象必須＝gitignore不可）
      ④複数plan統合のnode ID名前空間とmerge規則（§1.6-3のレーン／計画グルーピングの単位）
      ⑤CLI名・入出力schema・`critical_path.v1`導出規則（hard_need限定か全typed edgeか）・digest束縛
      ⑥error意味論（cli_error.v2準拠）・既存CLI 6面＋runtime-errors＋MCP面との責務分離
      作法: `fable`スポット諮問＋`fable`×high refuter 1回＋クロスprovider `codex_opinion` 1回
- [ ] 非目標をADRへ固定: 常駐化・外部SaaS・Markdown正本との二重管理・duration推定・自動再配置

### G2 — store契約＋critical path projection実装（A）
- [ ] 工程store契約の実装（schema validation・canonical serialization・digest・読取層。
      G1裁定に従う。書込はG4移行toolとG5 authoring CLIだけが行う）
- [ ] critical path純関数＋versioned projection＋fixture
      （分岐/join/複数critical/空graph/循環はcompile側拒否前提）
- [ ] focused gate green

### G3 — SVG/HTMLレンダラ実装（A・左右ペイン＋散文埋込・全plan統合・started/done両時刻表示を含む）
- [ ] §1スケッチどおりの純文字列構築レンダラ＋`lattice plan gantt` CLI配線
      （ADR 0044 surface規約・安定パス出力＋stdout result JSON）
- [ ] 自己完結検証fixture（出力HTMLに`http(s)://`参照ゼロ・単一file）＋ブラウザ表示smoke（オーナー目視はG4、ここでは開発者確認）
- [ ] focused/related gate green

### G4 — 一回きり移行変換＋オーナー受入（dotagents側受入・§1.5裁定に従う）
- [ ] 既存plan mdの**一回きり移行変換tool**（AI変換＋曖昧項目はunknownでfail closed→裁定後登録。
      常設のmd解釈pipelineは作らない。storeへの初回書込はこのtoolが担う）
- [ ] dotagents側アクセス配線: SessionStart hookがガントの安定パスと現在地を毎session案内（§1.6-6。正本はdotagents settings断片）
- [ ] **受入: dotagents master planの実workloadをガント表示し、クリティカルパスと現在地が
      ブラウザで一目で判ること（オーナー目視）**

### G5 — authoring CLI＋enforcement＋定着（A→dotagents側規範化）
- [ ] **authoring CLI実装**: ToDo追加・遷移（start/done/block）をCLI経由に限定し、順序違反
      （`--out-of-order --reason`なし）・依存欠落・evidenceなしdoneを書込時拒否する（§1.5-3）
- [ ] hook接続: SessionStart=storeから現在地・次pending注入／Stop=commitあるのに遷移なしをWARN（§1.6-7②。正本はdotagents）
- [ ] 憲法「計画文書の作法」へ「工程はLattice store・散文はMarkdown」を規範化し、
      移行済みplanのcheckbox列を廃止（§1.5-4。正本はdotagents `shared/constitution.md`）

## 4. 非目標

- 常駐サービス化・外部PM SaaS採用・Markdown正本との二重管理（表示は生成物、正本は一つ）
- duration推定・カレンダー時間軸（v1はwave段組みの論理時間軸のみ）
- plan_graphのschema変更（既存v1を読むだけ。変更が必要ならwire級の別裁定）

## 5. 検証

- G2/G3/G5はfixture snapshot＋`npm run ci` green。G4はdotagents実データでのオーナー目視受入。
- store契約はfail closed fixture（未知field・欠落・過大入力・journal/snapshot不整合の拒否）を持つ。
- 出力HTMLのnetwork参照ゼロを機械検証（fixture）。
