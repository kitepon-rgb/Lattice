# Lattice 工程表・ガント出力面 計画（Phase LG実装側）

**Status:** Active
**作成日:** 2026-07-18
**親裁定:** dotagents [Lattice編入計画 Phase LG](../../dotagents/docs/plan_lattice-factory-integration.md)（オーナー裁定 2026-07-18）・親queue 23
**対象repo:** Lattice（実装）／dotagents（消費者adapter・受入）

## 0. 背景

AIの規律ではToDoの順序・チェック消化を維持できないというオーナー裁定（2026-07-18）を受け、
工程表を機械管理する仕組みをLatticeへ実装する。外部PMツール（Plane等）は正本の二重化を生むため
不採用。Latticeは既に`lattice.plan_graph.v1`（immutable node・typed edge・capacity・join）で
ToDoのDAGを所有しており、**足りないのはcritical path projectionとガント出力面だけ**。

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

## 2. 設計（実装契約の骨子。詳細はG1のADRで裁定）

- **新公開面**: `lattice plan gantt`（名称はADRで確定）。入力=compile済み`plan_graph.v1`
  （＋任意のstatus注釈）、出力=**単一の自己完結静的HTML**（外部CDN・SaaS・network参照ゼロ）。
- **critical path projection**: `plan_graph.v1`からの純関数導出。versioned JSON
  （`lattice.critical_path.v1`仮）としてsource graph digestへ束縛。既存契約どおりexact key・
  bounded・fail closed。
- **read-only第一級**: ToDoに変更がなくてもcompile→描画だけを実行できる。plan_graphを変更しない。
- **status注釈**: v1は外部から渡す注釈（node id→pending/in-progress/done/blocked）の表示のみ。
  status遷移の強制（順序違反fail closed・evidence必須）は第二wave（G4）で別裁定。

## 3. 実行TODO

### G1 — 契約裁定（F・契約クリティカル）
- [ ] ADR起草: CLI名・入出力schema（gantt入力にstatus注釈を含むか）・`critical_path.v1`の
      導出規則（hard_need限定か全typed edgeか）・digest束縛・error意味論・既存CLI 6面との責務分離。
      作法: `fable`スポット諮問＋`fable`×high refuter 1回＋クロスprovider `codex_opinion` 1回
- [ ] 非目標をADRへ固定: 常駐化・外部SaaS・Markdown正本との二重管理・duration推定・自動再配置

### G2 — critical path projection実装（A）
- [ ] 純関数＋versioned projection＋fixture（分岐/join/複数critical/空graph/循環はcompile側拒否前提）
- [ ] focused gate green

### G3 — SVG/HTMLレンダラ実装（A）
- [ ] §1スケッチどおりの純文字列構築レンダラ＋`lattice plan gantt` CLI配線
- [ ] 自己完結検証fixture（出力HTMLに`http(s)://`参照ゼロ・単一file・ブラウザ表示smoke）
- [ ] focused/related gate green

### G4 — dotagents消費者接続と受入（dotagents側・親queue 23の受入条件）
- [ ] dotagents ToDo md（master plan queue・子計画チェック）→`plan_input.v1`写像adapterの範囲裁定
      （md直読をLattice本体に入れない。dotagents側adapterで構造化して渡す）
- [ ] **受入: dotagents master planの実workloadをガント表示し、クリティカルパスと現在地が
      ブラウザで一目で判ること（オーナー目視）**
- [ ] status遷移enforcement（順序違反fail closed・evidence必須done）の設計を別waveとして起票

## 4. 非目標

- 常駐サービス化・外部PM SaaS採用・Markdown正本との二重管理（表示は生成物、正本は一つ）
- duration推定・カレンダー時間軸（v1はwave段組みの論理時間軸のみ）
- plan_graphのschema変更（既存v1を読むだけ。変更が必要ならwire級の別裁定）

## 5. 検証

- G2/G3はfixture snapshot＋`npm run ci` green。G4はdotagents実データでのオーナー目視受入。
- 出力HTMLのnetwork参照ゼロを機械検証（fixture）。
