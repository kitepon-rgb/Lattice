# RC4 Stage 0 — batch定義（dotagents実TODO 6件）

- Date: 2026-07-17
- 選定: オーナーGO（2026-07-17 chat。候補6件を提示しそのまま承認）
- 運用合意（オーナー裁定 2026-07-17）: **凍結不要**。Stage 0はread-only判定のみで、dotagents側の
  消化は止めない。判定のstale化はそれ自体を実測記録とする。
- 対象repo: dotagents（Lattice側cloneのHEADで固定。正規repoへの書込ゼロ。
  `codegraph init`はclone上でのみ実行する）
- 検証規律: witness作成時間・参照証拠・書けなかった項目を1件ずつ実測記録（丸め・事後推定禁止）。
  Stage 0はControl外（ADR 0046 Decision 3）だが検証規律は維持する。

## batch（TODO 6件・混在要件充足）

| id | 系 | TODO | 出典 |
|---|---|---|---|
| T1 | control-record | finalization側archive衝突の設計裁定・実装（file型evidenceのarchive退避とevidence解決の正典衝突） | dotagents plan_factory-master 予約裁定・ADR 0060残論点 |
| T2 | control-record | resume-check出力の誤読防止改善（`result.outcome`の実UX欠陥。`--brief`系出力の改善） | 2026-07-17実被弾（統括自身がblocking 0と誤読） |
| T3 | adapter | queue 22: LatticeのBugHub source登録（adapter/schema/認証） | dotagents plan_factory-master queue 22（**cross-repo: ServerManager**） |
| T4 | adapter | claude-native consult adapterのlive H gate前の非H整備 | dotagents docs/02_models.md「Consultation多provider化」・executor-adapters |
| T5 | docs | メモリ昇格queue: bellbot deploy手順（BuildKitキャッシュ罠）の還流 | dotagents queue_memory-promotion.md |
| T6 | docs | メモリ昇格queue: Codex tokenUsage意味論（total vs last）の還流 | dotagents queue_memory-promotion.md |

意図した交差: T1×T2は`lib/orchestrate/control-record.mjs`／`bin/orchestrate-run.mjs`／
`tests/orchestrate/control-record.test.mjs`で衝突するはず（制御盤交差ケースの意図的包含）。
T3はrepo境界外への書込を含むcross-repo TODO＝witness表現力の限界を測る題材（非dispatchable／
unknown分類が期待値であり、失敗ではない）。T5/T6はcall graph非可視（markdown）の盲点題材。

## 添付caveat（dotagents私有。既知の罠を再走しない）

- `orchestrate-run-worker-run-record-approach-family-ref-null`（reproduced）:
  Control Record CLIのworker-run-recordは`lineage.approach_family_ref: null`をBUDGET_UNKNOWNで拒否。
- `orchestrate-run-cli-internal-error-lib`（tentative）: CLIのINTERNAL_ERRORはmutation未適用を
  保証しない。lib直呼びで実因確認と適用有無照合をしてから再試行。
- `control-record-file-evidence-1-blocked-decision`（resolved・ADR 0060）: resume-checkの結果は
  `result.outcome`を見る。blocking/review/resumableというトップレベルキーは無い。
- `macos-bsd-date-n-3n-literal-iso-timestamp`（confirmed）: BSD dateの`%3N`罠。verifier_refsに
  環境依存コマンドを入れない（RC4 plan既知の罠と同一）。
- `metadata-drvfs-9p-repo-control-record-state-mode-fidelity-probe-xdg-state-chmod-0700`
  （resolved）: DrvFS上のControl stateは外部XDG配置。Stage 0はMac ext4 cloneのため非該当。

## 実測記録

（witness作成の実測は本ファイルへ追記する）
