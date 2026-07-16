# RC3-F — isolated worktree executorとdiff observer

- 日付: 2026-07-17
- plan: [plan_lattice_rc3_runtime_vertical_slice.md](../plan_lattice_rc3_runtime_vertical_slice.md) RC3-F節
- 契約: ADR 0044 Decision 5（diff cross-bind・conflict分類）・9（adapter境界・isolated worktree限定）
- Control: `lattice-rc3-runtime-v1`（task `RC3-F-worktree-executor-v1`、review run `RC3-F-implementation-review-run-01-v1`）

## 実装

### `src/runtime-diff-observer.mjs`

- `captureWorktreeDiff`: 実git statusをbounded canonical checkpoint record
  （`lattice.checkpoint_diff.v1`、path昇順・content digest付き・entry数上限）へ変換。
  - `--ignored=matching`でgitignore済みwriteも検出（迂回封じ、isolation-runner規律）。
    ignored directoryの集約entryは内包fileへ展開する。
  - rename=移動先added＋移動元deleted、copy=複製先addedのみ（複製元は残存）。
  - symlink・submodule・special fileは現在側lstatとbase側`git ls-tree` modeの両面で
    fail closed（削除経由の迂回も塞ぐ）。
  - HEAD drift（commit等の禁止操作）は観測前後の二重検査（TOCTOU窓の閉鎖）。
  - pathはreceipt契約と同じbyte-safe規律（制御文字・backslash・1024 byte上限・遡上拒否）。
- `detectCheckpointFindings`: observed pathをdeclared scope（scope_violation）と他running TODOの
  declared write（observed_write_conflict、prefix対応）へcross-bind。findingはverifierと同じ
  per-path shape（`{kind, todo_ids, path}`）。

### `src/runtime-worktree-executor.mjs`

- disposable repoのbase_shaからdetached worktreeをtmpdirへprovisionし、work関数の実変更だけを
  checkpoint／receiptとして報告するadapter（scripted executorと同一契約）。
- 失敗経路（work例外・観測失敗・禁止操作検出）でもworktreeを孤立させず、cleanup試行→
  失敗時は残存pathと回収条件を失敗messageへ載せてfail loud。dispatch予約は解放しretry可能。
- terminal時cleanupの成否・残存path・回収条件は`executor_terminal` event payloadへ保存
  （成功への丸めなし）。
- canonical repo・共有refsへのwrite／ref作成は、dispatch前後のcanonical fingerprint
  （HEAD＋status＋for-each-ref）比較で検出しreject（協調前提の検出guard）。

### engine／verifier拡張

- checkpoint binding: receipt以前の最後の観測checkpointへのdigest一致＋observed_diff一致を
  engine裁定とverifier再計算の両方で要求（`checkpoint_mismatch`。executor自己申告をbinding証拠にしない）。
  checkpoint payloadは64hex digest必須。
- `classifyCheckpointObservation`: 検出findingをconflict_found＋（未freeze時）intake_frozenへ保存。
  既記録findingの再分類はidempotent（重複記録なし）。
- verifier `classifyObservedDiff`: 観測pathが未観測の別TODOのdeclared write（prefix含む）へ到達する
  片側観測のlate conflictもobserved_write_conflictとして返す意味論補完（重複はdedupe）。

## 異provider review（commit前）

codex-sidecar `codex_review`（gpt-5.6-sol×high、read-only）が10 finding（P0×4・P1×5・P2×1）を返した。裁定:

- **採用9件＋shape統一**: ignored write迂回（--ignored=matching＋directory展開）、例外時worktree leak
  （全失敗経路のcleanup＋予約解放）、producer/verifier finding意味論divergence（verifier側へ
  observed×declared補完＋producer側per-path shape統一）、checkpoint binding弱点（digest必須・
  sequence境界・observed_diff一致）、再分類重複（idempotence）、rename/copy分解誤り、
  symlink/submodule削除迂回（base mode検査）、HEAD TOCTOU（前後二重検査）、path規律統一。
- **一部棄却1件（P0-2）**: 「任意work関数への別process sandbox必須」は、planのNon-goals
  （malicious executor・敵対的PATH差替えを扱わない）とH1-RC3のcooperative executor前提により
  棄却。代替としてcanonical repoへのwrite・ref作成をfingerprint比較で検出するguardを実装した。
  actual executor（RC3-I）はprovider側の隔離とH gate承認の下で実行される。
- **openQuestionの裁定**: checkpoint観測ゼロのreceipt受理はRC3-E挙動を維持（worktree adapterは
  常にcheckpointを先行させる。scripted adapterの無checkpoint経路は敵対条件注入用に残す）。
  findingの正規shapeはper-path単数（verifier形）で固定した。

## 検証

- integration: `test/integration/rc3-worktree-executor.integration.mjs` 8 green（実repo・実worktree・実diff）。
- related gate（source収束後1回）: RC3対象＋isolation-runner＝82 test green、`npm run check` pass
  （module 2件追加）。

## 未検証・持ち越し

- hold裁定・affected closure・carry-over・redispatch・intake_resumedはRC3-G所有。
- 8条件campaignでの正解集合exact比較はRC3-H所有。
- 非UTF-8 filenameはgit statusのlossy変換により置換文字pathとして観測される（制御文字規律で
  大半はreject。byte-exact pathが必要になった場合は-z + core.quotepath検討をRC3-J評価残へ）。
