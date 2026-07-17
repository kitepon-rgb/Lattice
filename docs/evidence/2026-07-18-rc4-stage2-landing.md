# RC4 Stage 2 — 正規dotagentsへの着地（3 batch・review経路・H gate毎batch）

- Date: 2026-07-18
- 契約: [ADR 0046](../adr/0046-rc4-writer-target-stage-override.md) Decision 1（Stage 2＝親のreview→
  pathspec commit経路のみ）、[ADR 0050](../adr/0050-stage1-executor-isolation-implementation.md)
- Control: `lattice-rc4-dotagents-v1`（batch H task 3件・approval snapshot付き・全finalize済み・rev 9）
- 正典artifact: `research/campaigns/rc4/artifacts/v4-landing`（on-disk検証**19 check green**・
  patch束縛検査 `patches_bound_to_accepted_receipts` 含む）
- 検証規律: 実測値のみ。丸め・事後推定なし

## 前段: Stage 1→2契約欠陥の発見と即時修理（P1・critical path）

着地素材の実体確認で、**receiptがdiffのpath＋content digestのみを保存し、patch本文が
worktree破棄と同時に消えている**ことが判明した。Stage 2の設計（受理receiptのpatchを親review
で着地）が成立しない＝campaign critical pathを塞ぐP1として即時修理した（Lattice `b61ee3d`）:

- worktree破棄前に `git add -A`＋`git diff --cached --binary` でpatch本文を捕獲、receipt schemaは
  不変のまま `patches.json` としてartifactへ保存・receipt_id/checkpoint_digestでbind
- verifierへ「accepted receiptごとにpatchが存在しpathsがreceiptと一致」検査を追加
  （旧artifact v3/v3-holdはmanifest記載文書のみ検査の既存規則のまま）

**手戻りコスト（実測）**: Stage 1受理済み5成果の再取得のため着地run（`rc4-stage2-landing-e1`・
base `97a931a`・5 TODO・capacity 2）を再実行した。Stage 1の受理報告を仕様として渡したため
executor実行は56〜470秒/件（計約16分・5 dispatch＋wave裁定3回）で完了。この再走がこの欠陥の
実測rework費用である。

## 着地run（round 3）実測

- 全5 receipt accepted・findings 0・residual worktree 0・conflict serialization再現
  （TB dispatchはTA受理後）。artifact `v4-landing` atomic発行・19 check green。
- executor実測: TA 470秒/19 tool・TB 272秒/21 tool・TC 72秒/7 tool・TD 56秒/6 tool・TF 69秒/8 tool。

## 3 batch着地（dotagents正規repo）

親が全5 patchを実読reviewしてから、batchごとにH gate承認をControlへ記録し着地した
（オーナー承認2026-07-18「やれ」を各batch approval snapshotへ適用）:

| batch | receipt | 着地commit | focused test | 正規gate |
|---|---|---|---|---|
| 1 | TC-a1-r1 | dotagents `e117ac5`（executor-adapters fail-closed test） | 23/23 | make lint PASS |
| 2 | TD-a1-r1＋TF-a1-r1（**並列受理対**） | `8a3befd`（quota-snapshot境界＋rate-selector等号境界） | 12/12 | make lint PASS |
| 3 | TA-a1-r1＋TB-a1-r1（**conflict対の統合**） | `b248c46`（resume-check summary＋ADR 0060対称性test） | 127/127 | make lint PASS |

- TA/TBのhunkは非重複（file末尾追記 vs 2692行付近＋bin）で、`git apply --3way`が両方clean適用。
  merge手作業0。
- 着地後の**full gate**: dotagents `make ci` exit 0（隔離HOME Codex routing verifier含む全green）。
  push済み（`97a931a..b248c46`）。
- 境界: 着地はH承認済みの意図的書込のみ（3 commit・対象6 file書換なし逸脱0）。

## 実測サマリ（L5条項「wall-clock・rework・手戻り」）

- 着地作業本体（patch review→apply→test→lint→commit×3→full ci→push）: 約15分
- rework: patch捕獲欠陥起因の再走約16分（上記）。それ以外の手戻り0（apply失敗0・test fail 0）
- 3 batch・うち1 batchは並列2 TODO同時進行分＝L5の最低要件を充足

## 残（L5 Phase gate・未実施）

full CIはgreen済み。**`fable`×high refuter 1回・クロスprovider検証1回・support/refute ADR・
knowledge return・Control finalize**が未実施＝L5を閉じる最終gateとして次の作業単位で行う。
