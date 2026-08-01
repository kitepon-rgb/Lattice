# sah-p0-baseline — 実装前baseline（sensor-awareness-hooks campaign）

- 記録: 2026-08-01 / Control `sensor-awareness-hooks-20260801` / base `80af73e`
- 実行者: claude-fable-parent（統括直轄・読み取り実測）

## 実測

| 項目 | 結果 |
|---|---|
| `npm test` | **exit 1（main既存赤）**。失敗7件は全て rc3-scripted-campaign 系statement（初段 `BOUNDARY_UNKNOWN: clean条件がdispatchableにならない` からの連鎖）。pass側マーカー1207件 |
| `npm run check` | exit 0（syntax 134 files） |
| release祖先gate | **実装済み**。`package.json` の `prepublishOnly` → `npm run verify:release-commit`（`scripts/verify-release-commit.mjs`）。受入条件6の「無ければ導入」は不要 |
| 現行version | 0.39.0 |

## 既知失敗の扱い（成功へ丸めない）

rc3-scripted-campaign統合の失敗はhooks工事と無関係のmain既存欠陥。工場欠陥処理に従い
即時修理せず、P4統合検証のfull gate前のmaintenance waveで修理する（sah-p4-integrationのnoteに登録）。
P5 publishはこの修理完了が前提になる。

## 不足一覧と後続入口

- hooks隣接の既存CLI・hook配布物・host設定fixtureの構造調査は、P1設計の入口として実施する
  （design memoの「後続調査入口」をP1へ引き継ぐ）。
- source変更ToDoのdispatch前に `.lattice/todo/witness/sensor-awareness-hooks.json` の宣言と
  `independence compile` が必要（planの「Lattice工程への導線」どおり・現状 coverage=missing）。
