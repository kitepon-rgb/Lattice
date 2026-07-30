# 重監査を飛ばせない工程管理と authoring CLI の発見可能性 — 完了報告

- 工程: Lattice store の `phase-audit-and-cli-discovery`（10 ToDo・4 Phase）
- 版: **0.36.0 → 0.36.1**（0.36.1 は公開後 smoke で見つけた配布漏れの修正）
- 正典: [ADR 0147](../adr/0147-audit-is-on-by-default.md)・[計画](../plan_phase-audit-and-cli-discovery.md)

## 実施

| ToDo | 実施 | 主な検証 |
|---|---|---|
| t01 設計 ADR | 実施 | 参照 ADR 5 本の実在、`phaseV3CarrySemantics` と `taskSemantics` の差を実コードで照合 |
| t02 終端監査 gate | 実施 | 旧版 154 件 fold 対 新版 50 件 fold（差 104 件が監査待ちとして図に残る） |
| t03 acquire_phase | 実施 | done 保持での獲得成功／title 変更拒否／付け替え拒否を test で固定 |
| t04 schema 既定 | 実施 | `plan create --schema --json` が v3、`--schema-version 1` が互換で継続 |
| t05 schema flags | 実施 | 4 入口が title と required 10/4/12/10 を返し、store も git も読まない |
| t06 違反 detail | 実施 | 未ソート tasks で `violation_path: /tasks/1` |
| t07 plan show | 実施 | phase 無し plan で `has_phases: false`、未知 key は typed error |
| t08 docs | 実施 | 公開契約・README 英日・CHANGELOG |
| t09 release | 実施 | push → publish → install → daemon 載せ替え → 公開後 smoke 全項目 |
| t10 報告 | 本書 | — |

**スキップ: なし。**

## Phase gate（この plan 自身を Phase gate 付きで運用した — 受入条件 7）

migrate 済みで phase を持たなかったため、まず `revise-phase`（v2 経路）で 4 Phase を被せた。
各 Phase を `phase review` → evidence 束縛 `phase accept` で閉じた。

| Phase | 状態 | 監査で確定したこと |
|---|---|---|
| pa-1-design | accepted | ADR の主張を実コードで照合。参照 ADR の実在を確認 |
| pa-2-store-gate | accepted | **実害のある欠陥 1 件を差し戻した**（下記） |
| pa-3-cli-discovery | accepted | 4 件を実 CLI で再検証。`revision_set.v3` の限定を発見 |
| pa-4-deliver | accepted | release 経路と公開後 smoke |

## 重監査が捕まえた欠陥（この工程の存在意義）

1. **snapshot 常時 v2 化により既存 store の書き込みが全面停止していた。** 実測: on-disk が v1 の
   snapshot 29 件が全て stale 化し、`readTodoStore({forWrite:true})` が
   `STORE_WRITE_REFUSED / snapshot_stale` で失敗（26 member 中 24 が stale）。既存利用者の
   あらゆる mutation が止まる状態だった。worker の検証が読み取り経路だけで、書き込み経路を
   測っていなかったため露見していなかった。snapshot 形式を変えず、暗黙 Phase の状態を
   読み取り時の導出ビューとして供給する形へ差し戻した。
2. **新規 schema 4 件の配布漏れ**（0.36.0）。`package.json` の `files` は schema を個別列挙する
   ため、repo 内では通るのに global install では `INTERNAL_FAILURE` になった。公開後 smoke で
   検出。4 件を列挙し、**CLI が読む schema と配布リストの一致を強制する test** を追加した
   （列挙を 1 件抜くと落ちることを確認済み）。

## 起票した制約（起票条件つき・[backlog](../plan_backlog.md)）

- **複数 path を所有する ToDo は独立性記録を作れない**。`witness scaffold` が
  `multiple_owned_paths_unsupported` で拒否する——最も競合しやすい ToDo ほど機械判定を持てない。
  t02/t03 で実際に踏み、偽の宣言はせず、コード読解で確定した干渉（両者が `src/todo-store.mjs`
  を書く）を根拠に直列化した。
- **`todo_revision_set.v3` は phase revision の v1/v2 しか member にできない**。公開契約に
  この限定が書かれておらず、reconciled plan は cross-plan 同時切替に参加できない。

## 請求項との関係

本工程は工程 store の gate と CLI の案内であり、請求項本文には触れない。請求項 1 の
「並行実行可能な配置を決定し並行実行させる」を**弱めない**ことを不変として固定した——
終端監査は plan の「閉じ」だけを止め、`next_ready` / `active_set` / `dispatch_frontier` は
暗黙 Phase の状態遷移で不変（test で固定・ADR 0147 裁定 5、ADR 0062 継承）。
CLI の発見可能性は、工程が Lattice へ載る確率を上げる方向であり、請求項 1 の強化側にある。

## 並列の扱い

next_ready 6 件に対し `--parallel-frontier` を宣言し、ファイル所有で分けた 3 worker を並列で
走らせた（同一ファイルを 2 worker が書く形は作らない）。t02/t03 は両方が
`src/todo-store.mjs` を書くため実際に干渉するので直列化した——この申告は 0.35.0 の
`PARALLEL_DISPATCH_RECONSIDER` で一度突き返され、再考の上 `--serial-confirmed` で通した
（worker 数の都合なら拒否される設計であり、実際の干渉だったので通過した）。

## 検証（全て実行済み）

- `npm run ci` 全段 green（product 1168 test・sensor・CLI 表面 57 command・store verify）
- 公開後 smoke（global install 0.36.1）: 4 入口の `--schema`、`plan create --schema` 既定、
  `plan show`、phase 無し plan の終端監査、gantt fold 53 件、公開 URL 200
- 常駐 daemon 載せ替え: bridge 200、dashboard health が 0.36.1 を名乗る
