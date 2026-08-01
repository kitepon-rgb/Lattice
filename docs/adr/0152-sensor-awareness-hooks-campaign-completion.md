# 0152 — sensor気づかせ導線install契約campaignの完了裁定

- Status: Accepted（不変Decision）
- Date: 2026-08-02
- Control: `sensor-awareness-hooks-20260801`（dotagents orchestrate control store）
- 起票: backlog `bk-006`（2026-08-01オーナーGO）／散文plan: [plan_sensor-awareness-hooks.md](../plan_sensor-awareness-hooks.md)

## Decision

1. `lattice hooks install|status|uninstall|emit --host claude|codex` を@quolu/lattice **0.40.0**として
   公開し、hooks導線を製品のinstall契約とする（正典: docs/01_integration-package.md「hooks導線」節）。
   旧Codegraph prompt-hookの正式継承であり、Spotter非導入環境の導線欠落はこれで閉じた。
2. 品質はwave構造で担保した: 設計反証4巡37 finding（35採用・1棄却・1部分採用、
   [設計契約r5](../evidence/2026-08-01-sah-p1-design-contract.md)）＋実装独立レビュー6 finding全修理
   （[P4受入](../evidence/2026-08-01-sah-p4-integration-acceptance.md)）＝公開前に43破壊経路を閉鎖。
3. 対象端末（オーナー主端末）はClaude/Codex両host `wired`・verify-install green・hook trust承認済み
   （[P5公開証跡](../evidence/2026-08-01-sah-p5-publish.md)・[P6受入](../evidence/2026-08-01-sah-p6-dotagents-followup.md)）。
4. 波及修理: dotagents apply-codex-configの`timeoutSec`無効キー欠陥を同campaignで修理
   （dotagents `3c493bb`・caveat: codex-hooks-json-hook-timeout-key-timeout-timeoutsec-600）。
   Throughline/Caveat所有の同種残存6件は各製品repoの後続waveへ切り出し（chip起票済み）。

## Process record（証跡の所在と逸脱申告）

- 工程正本: Lattice store `sensor-awareness-hooks` plan（P0〜P7全doneの完了証拠つき）。
- Control record: init・lane admission（4条件true）・phase gate（risk=high/behavior-change）・
  baseline〜integration全gate advanceを記録。**逸脱**: worker-run-record以降のelastic placement
  連鎖は使用せず、委譲の記録はstore task noteとPacket込みprompt・受入証拠docで代替した
  （逸脱はsah-p2/p3のnoteに申告済み。手動forgeがCLI設計上のanti-patternであるため）。
- インシデント1件: P3初回Runのbaselineテストが実HOMEへinstallを1回走行→自implementationの
  backupから復元・実物検証済み・hermetic guardを受入条件へ昇格して再発閉鎖
  （[P3受入](../evidence/2026-08-01-sah-p3-implementation-acceptance.md)）。

## 残課題（本Decisionの範囲外・所在明示）

- Windows native対応（v1はtyped unsupported——対応時は`commandWindows`形の固定を含む独立工程）。
- Throughline/CaveatのtimeoutSec修理（各製品repo・chip起票済み）。
- 他端末への波及はverify-installのwired検査とonboarding手順が機械的に誘導する。
