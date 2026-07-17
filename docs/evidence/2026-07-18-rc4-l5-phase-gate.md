# RC4 Phase gate（L5）— full CI・クロスprovider検証・fable反証・knowledge return

- Date: 2026-07-18
- 対象: RC4 campaign全体（Stage 0〜2）とdotagents着地3 commit（`97a931a..b248c46`）
- Control: `lattice-rc4-dotagents-v1`
- 裁定ADR: [ADR 0051](../adr/0051-rc4-phase-gate-support.md)
- 検証規律: 実測値のみ。全gate装置の生結果を本書へ保存する

## 1. full CI（両repo・2026-07-18）

- Lattice `npm run ci`: **exit 0**（green）
- dotagents `make ci`: **exit 0**（隔離HOME Codex routing verifier含む全green）

## 2. クロスprovider検証（1回・02_models.md既定の実行形）

`codex_review`（model `gpt-5.6-terra`・reasoning effort high・read-only）に着地範囲
`97a931a..b248c46` の実diffをレビューさせた。指摘2件・統括が実ファイルで敵対的裁定し**両方採用・即修正**:

| 指摘 | 裁定 | 修正 |
|---|---|---|
| medium: `b248c46`がresume-checkのenvelopeへ`summary`を追加したが、CLI契約正典`shared/orchestrate/control-record.md`は成功envelopeを`{ok, command, result}`のまま定義（契約未更新の観測可能変更） | 実在確認（契約1293行・`bin/orchestrate-run.mjs:77-82`）→**採用** | 契約正典へresume-check例外（4-key envelope・既存キー不変・他コマンド不波及・実被弾対策の理由）を明記 |
| low: `tests/orchestrate/executor-adapters.test.mjs:213`コメント「UUID v4」が実validator（`executor-adapters.mjs:546`＝version nibble `[1-5]`受理）とfixture（v1 UUID）に不一致 | 実在確認→**採用** | コメントを「UUID形式（v1〜v5）」へ訂正 |

- 付随提案「strict consumer互換test追加」は**棄却**: repo内にstrict schema consumerは存在せず
  （`resume-check`消費者は`bin/orchestrate-run.mjs`と契約文書のみをgrepで確認）、契約正典への
  例外明記が根本対処。テストは薄く速く（オーナー裁定 2026-07-16）に従い形骸testを足さない。
- 修正後: focused test（executor-adapters 6件）green・`make lint` PASS。

## 3. `fable`×high refuter（1回・read-only）

主張「RC4はLattice編入（L6）supportの証拠として十分」を殺しにかからせた。**総合verdict: 条件付きsupport**。

殺せなかった核心（独立再検証で裏付き）:

- artifact `v4-landing` 19 checkを**read-onlyで独立再実行し全pass再現**
- provider-runs.jsonのduration_msがevidenceの秒数記載と**ミリ秒単位で一致**（計939秒≈15.7分）
- 5 receiptのpatch added行（計89行）が着地3 commitの実diffに**欠落0で全存在**、
  focused test合計162件が現HEADで162 pass / 0 fail再現
- RC4反証条件4種（witness超過・見逃し誤判定・境界事故・丸め/fail-open）は**いずれも不成立**

部分的に殺された点・条件（ADR 0051 Decisionへ反映）:

1. **claim境界の明記が必須**: 単一provider（全10 runが`claude-implementer-subagent`）・
   Stage 2は受理報告を仕様として渡した再実装・着地物はtest支配の小粒patch（95行中挙動変更7行）・
   字義の隔離HOME未達（ADR 0050代替形）・実timeout/patch reject/rollback未観測
2. **patch bind検証は主張より浅い**: `patches_bound_to_accepted_receipts`はpath照合のみで、
   保存`checkpoint_digest`もreceipt content digestとの突合も未検証＝取り違え・破損はpath一致なら通る。
   今回は親の実読review＋apply＋test greenが補償。強化はmaintenance queueへ
3. **behavior-preserving lane下のfeat着地**（`b248c46`のsummary追加＝観測可能変更）の字義的緊張を裁定・記録
4. **ADR 0050残余リスク（読取の帰属不能）の恒久化条件**を編入契約へ

## 4. knowledge return

- caveat（private・reproduced）: `lattice-receipt-path-digest-patch-worktree-rc4-stage-2`
  ——「digest参照だけ保存して実体がworktree破棄と消える」型の欠陥と教訓・手戻り実測≈16分
- 正典還流: dotagents `shared/orchestrate/control-record.md`へresume-check envelope例外を明記
  （クロスprovider指摘の根本修正）
- rag還流: **スキップ**（本Phaseに外部仕様調査なし。全て自repo一次実測でevidence/ADRが正）

## 5. Control操作（本gateでの記録）

phase gate 9 stepのadvance（baseline〜complete）、Control finalization
（受入matrix=本plan・最終監査=本書＋Stage 2着地evidence・回帰=本書§1・knowledge return=本書§4・
親Decision=ADR 0051）、archiveを本書commit後に実施。planはRC3-J作法どおり`docs/archive/`へ退避。
