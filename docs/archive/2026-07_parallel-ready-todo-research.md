# 並列実行可能な計画／TODO設計 研究計画

**状態:** Active
**作成日:** 2026-07-15
**対象:** dotagentsの計画作法、Elastic orchestration、Observer以降の工場開発

この文書は、プロダクト計画全体を原子的なTODOの依存DAGへ変換し、安全な並列waveを
最大化するための研究計画兼TODOである。主たる並列性はTODO間の依存関係として表現する。
さらに、TODO候補のコード境界に切断可能なseamがある時は直列化を既定にせず、挙動不変レーンの
seam-refactorで境界を分離し、再解析後のplan versionへ並列性を解放する。コード構造を固定入力ではなく、
安全なschedulabilityを改善できる制御変数として扱う。
ただし、TODO内部に独立検証可能なread-only探索、候補生成、検証、または契約固定済みの
隔離writer frontierがある場合は、accountable ownerの下で一時的なfork-joinを許す条件も研究する。
ownerは最終統合・受入・再計画の責任を表し、worker数を一に制限する意味ではない。

実行順の親正本は[開発工場 統合マスター計画](https://github.com/kitepon/dotagents/blob/main/docs/plan_factory-master.md)。本研究中はObserverの
実装位置を保持し、採用規則を確定してから残るObserver計画を再構成して本筋へ戻る。

## 1. 研究上の問い

1. 要求・設計・コード構造から、真の依存と便宜上の順序をどう区別してDAGへ落とすか。
2. TODOを「小さすぎる管理単位」と「大きすぎる隠れプロジェクト」の間でどう切るか。
3. 循環依存、共有状態、巨大ファイル、不安定なinterfaceなど、並列化を妨げる結合をどう診断するか。
4. characterization、interface-first、抽出リファクタ、contract testを先行TODOとして置く条件は何か。
5. critical path、統合コスト、merge conflict、レビュー負荷を同時に抑えるwaveをどう組むか。
6. AI coding agentへ渡すTODOに、人間チームとは異なる追加契約が必要か。
7. 並列化しない方が安全または速い条件を、人数不足と混同せずどう明示するか。
8. CodegraphでTODO候補の実境界をどう測り、小さな重複を解くrefactorをどの条件で計画へ挿入するか。

## 2. 仮説と反対仮説

主仮説:

- 主たる並列性は、計画DAG上の同時ready node数として設計する。
- TODOはaccountable owner、明示した入出力、非交差write/effect scope、局所証拠、統合境界を既定にする。
- 分割不能なTODOがcritical pathを占有する場合、実装前に契約固定または構造分離TODOが必要である。
- TODO内部fork-joinは、独立検証可能なfrontierと明示したjoin gateがある場合だけ認可する。
- TODO境界は文章だけで推定せず、Codegraphのsymbol／dependency／impact／affected testと、静的解析で
  見えないstate／external effectを併記したboundary manifestで証拠化する。
- 境界重複は、切断可能なseam、挙動不変gate、再index前後の構造差分、静的解析外のsemantic／effect証拠が
  揃い、変換費を含む純並列便益が正になる時だけ、先行seam-refactorで解消する。

反対仮説:

- 細分化は調整・レビュー・統合の固定費を増やし、総所要時間を悪化させ得る。
- ファイル非交差でも、共有schema・状態機械・暗黙契約があれば意味上は独立していない。
- DAGを精密化しすぎると、実装中の発見へ追随できず計画保守が主作業になり得る。
- AI agentは境界を越えた局所最適を作りやすく、並列数の増加が品質向上を保証しない。
- TODO単位とrollback単位は常に一致せず、downstream依存後は統合cut単位のrollbackが必要になり得る。

## 3. 調査範囲と証拠

- ソフトウェア工学: information hiding、modularity、coupling/cohesion、Design Structure Matrix、
  Conway系研究、architectureとcoordinationの関係。
- 計画科学: Work Breakdown Structure、dependency network、critical path、critical chain、
  precedence constraints、parallel scheduling、batch size。
- 開発実務: trunk-based development、小さいchange、code ownership、contract test、feature flag、
  stacked/incremental change、merge conflict予測。
- AI agent研究: task decomposition、multi-agent software engineering、独立context、共有memory、
  verifier／integration agent、並列探索と実装の差。
- 特許: software task decomposition、dependency-aware scheduling、parallel development、
  conflict-aware work assignmentに関する公開特許。
- 静的解析／自動変換: call／import／reference graph、change impact、program partitioning、
  behavior-preserving refactoring、parallelizing compiler、再解析による境界検証。

一次論文、標準、公式handbook、原著者資料、公開特許を優先する。ブログやベンダー資料は
実務例として区別し、中心的な主張を単独では支えない。外部資料は`rag/parallel-ready-planning/raw/`
へ原文または抽出を保存し、出典・取得日・取得方法・確度を付ける。

## 4. 研究waveとTODO

### Wave 0 — 既存知識と評価枠

- [x] 既存のdotagents正典、RAG、Caveatから重複知識と未解決点を棚卸しする。
- [x] 資料の採否基準と、手法を比較する評価軸を固定する。

### Wave 1 — 独立文献調査（並列）

- [x] モジュール境界・依存構造・組織間coordinationの一次研究を調べる。
- [x] WBS・DAG・critical path・並列schedule・batch sizeの一次資料を調べる。
- [x] AI coding agentのtask decomposition・multi-agent integration研究を調べる。
- [x] 関連特許を探索し、学術・実務手法との差分と利用価値を整理する。

### Wave 2 — 統合モデル

- [x] 「要求からTODO DAGまで」の再現可能な分解手順を作る。
- [x] TODOの原子性、ready条件、typed dependency、write/effect scope、局所証拠、join、rollback cutを表す最小schemaを作る。
- [x] 直列化、先行リファクタ、interface-first、並列実装を選ぶ診断rubricを作る。
- [x] critical pathとcoordination costを踏まえたwave生成・再計画規則を作る。
- [x] 外層TODO DAGと内層fork-join graphを分け、内部並列のadmission／join条件を作る。
- [x] active plan versionのimmutability、edge witness、output contract、effect class、typed recoveryを統合する。
- [x] Codegraph 1.4.1のlicense、graph schema、impact／affected、dynamic boundaryを実repoで確認し、
  TODO境界判定に足りないmachine-readable contractを特定する。
- [x] 「境界解析→小径seam-refactor→再index→versioned TODO DAG」というschedulability compile loopを設計する。

裁定: `ready set |U|`は有用な観測値だが、それ自体を成功条件にしない。Graph Harnessは設計語彙だけを
採用し、未実装position paperと不整合なsurvey比率を効果証拠から除外した。LAMaSはcritical-path目的の
必要性を支持する限定実験として採用するが、token主体proxyを工場のwall-clock改善率へ読み替えない。

### Wave 3 — 実プロジェクト適用と反証

- [ ] 現在のObserver残計画へ適用し、旧構造と新しいDAG／waveを比較する。
- [ ] Observer provider bindingの二候補へboundary manifestを作り、非交差write面と静的解析外のeffectを証拠化する。
- [ ] 「細分化しすぎ」「ファイル分離だけの偽並列」「統合TODO増殖」の反対事例で壊す。
- [ ] 独立反証を一回行い、生き残った規則だけを採用する。

### Wave 4 — 還流

- [ ] 研究記事を`rag/parallel-ready-planning/`へまとめ、`rag/INDEX.md`へ登録する。
- [ ] 採用規則を`shared/orchestrate/contract.md`と委譲／Control契約の適切な所有箇所へ反映する。
- [ ] Observer計画をTODO間DAGとparallel wave中心に再構成し、本筋の保持位置へ戻る。
- [ ] schedulability compiler（仮称Lattice）の製品境界、Codegraph adapter／所有fork分岐、
  Observer初回dogfoodを統合マスター計画へ登録する。
- [ ] TODO完了候補でdiff・根拠・リンク・未検証範囲を一回確認し、本研究計画をarchiveする。

## 5. 成果物と完了条件

1. 少なくとも学術、標準／handbook、AI agent研究、特許の四系統を比較している。
2. 各重要結論が一次資料または明示した自前推論へ追跡できる。
3. 計画DAG上のTODO間並列を既定とし、TODO内部fork-joinは明示したadmission／join条件で制限できる。
4. 「並列化可能」「先行分離が必要」「意図的直列」の三つを機械的に判別できるrubricがある。
5. TODO分割によるcoordination costとintegration debtを抑える停止条件がある。
6. Observer残計画に適用した外層DAGと、必要な場合だけの内層fork-join例があり、次のdispatch waveが曖昧でない。
7. 反対仮説で棄却した規則と理由を記録し、人数を増やすこと自体を成功条件にしない。
8. Codegraph由来のboundary manifest、seam-refactor admission、再indexによる構造差分、静的解析外の
   受入証拠を一つの閉ループとして再現できる。

## 6. 非目標

- 汎用プロジェクト管理SaaSへ退行しない。研究waveでは製品契約とObserver初回実証までを固定し、
  schedulability compiler本体は独立製品waveとして継続する。
- TODO数、Worker数、並列度に固定目標を置かない。
- 論文の用語を、そのままdotagentsの強制schemaへ増殖させない。
- Observer本体の公開、実host起動、credential、provider quota消費を行わない。
