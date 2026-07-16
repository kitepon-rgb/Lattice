# RC3-G — 後発競合のselective holdとplan vN+1 recompile

- 日付: 2026-07-17
- plan: [plan_lattice_rc3_runtime_vertical_slice.md](../plan_lattice_rc3_runtime_vertical_slice.md) RC3-G節
- 契約: ADR 0044 Decision 6（intake freeze・affected closure）・7（全plan失効とcarry-overの両立）
- Control: `lattice-rc3-runtime-v1`（task `RC3-G-hold-recompile-v1`、review run `RC3-G-implementation-review-run-01-v1`）

## 実装

### `src/runtime-hold-recompile.mjs`

- **decideHoldAndCarryOver**: frozen prefix（現epochのconflictのみをseed）からaffected closureを
  producer独自実装（conflict edge伝播＋hard predecessor下流＋共有resource witness到達）で計算し、
  closure外のin-flight TODOは次の全条件を通過した場合だけcarry-over witnessを発行してcontinueする:
  post-freeze diff/receipt event不在、競合finding pathとのdeclared/observed scope非交差、
  witness sources（todo_input・boundary_manifest・validator・context_content）の再実証。
  1条件でも証明不能ならholdへ戻し、理由をwitnessFailuresへ記録する。
  hold_decision.v1（finding・closure・hold/continue集合・根拠conflict event digest）をevent保存し、
  **verifierのrecomputeHoldDecisionとのexact一致を自己検査**（divergenceは即例外）。
- **recompileNextEpochPlan**: plan vN+1をepoch+1・新plan_refで全体再発行（active planへの追記なし）。
  predecessor_refsへ旧plan_refとaccepted checkpoint digestをbind。additionalConflicts（後発競合）を
  dedupe/sortしてmerge（irreducible conflictはprecedenceへ偽装せずunordered conflictのまま保持）。
  carried-over TODOが追加conflictの当事者なら設計矛盾としてfail loud。
  contextは**全TODOで一斉失効**（context_invalidated、reauthorized_via=epoch_rebind|redispatch）し、
  hold集合のrunning executorは旧epochで終端（redispatch可能化）。carried-overへはepoch rebind packet
  （content digest不変・epoch/plan refのみ更新、authorized_checkpoint_digest=frozen prefix内最終checkpoint、
  checkpoint無しはgenesis sentinel 64桁ゼロ=RC3-J ADR裁定予定）、redispatchへは新plan_ref由来の
  別content packetを発行。runtime_plan_diff.v1保存後にintake_resumed。
- **routeConflictTreatment**: predeclared treatmentがfinding pathを覆う場合だけseam transform lane、
  それ以外はintentional serial。

### engine／verifierのepoch意味論拡張

- frontier除外（dispatched/terminal/held）・freeze境界・hold seedを**現plan epochのevent**へscope。
  旧epochの記録は新epochの運転を塞がず、redispatchが可能になる。RC3-C characterization
  「resume後の旧epoch receiptはstale」は維持（旧planに対する裁定では最初のfreezeが境界のまま）。
- checkpoint bindingを**同一dispatch attempt**（最後のexecutor_dispatched以降）へscope。
- **unrebound_epoch reject**: dispatchが旧epochのTODOが現epoch receiptを名乗る場合、
  epoch_rebound event（receipt以前・new_plan_epoch一致）を必須にする。rebindなしのepoch自称
  （偽装receipt）はengine/verifier双方でreject。

### 旧epoch receiptの正規裁定経路（review P1-4の裁定）

frozen prefix内のvN pending receiptは、witness発行後・recompile前に**旧planで**裁定する。
witness bindingがあるreceiptだけ受理され、無いものはwitness_unproven reject（Decision 7.5）。
vN+1 planへの裁定はrebind後の新epoch receiptだけを対象にする（自動routingは持たない設計）。

## 異provider review（commit前）

codex-sidecar `codex_review`（gpt-5.6-sol×high、read-only）が7 finding（P0×1・P1×5・P2×1）を返した。全採用:

- P0 epoch詐称receipt→unrebound_epoch reject（両側）＋敵対test。
- P1 witness意味検証不足→post-freeze event不在・finding scope非交差のproducer gating
  （accepted checkpoint scope交差・plan同値の完全再照合はRC3-H artifact verifierで配線、評価残に明記）。
- P1 hard predecessor下流欠落→producer closureへ追加。
- P1 旧epoch witness-bound receipt→旧planでの裁定を正規経路として固定＋test。
- P1 authorized_checkpoint_digest→frozen prefix内最終checkpointから導出（genesis sentinelはRC3-J ADR）。
- P1 失効がhold集合限定→全TODO一斉失効へ（carried-overはrebind再認可）。
- P2 二度目freezeのseed混入→現epoch conflictへscope（両側）。

residual riskの記録: runtime_plan_diffのnode_edge_diff exact shape検査とintake_resumedの
queued件数契約はRC3-H campaign artifact検証で扱う。

## 検証

- focused: `test/rc3-hold-recompile.test.mjs` 8 green（exact hold/continue集合、witness正負、
  閉ループ完走、epoch詐称reject、witness-bound旧epoch裁定、二responsibility routing）。
- related gate（source収束後1回）: RC3全対象＋CLI＋worktree integration＝85 test green、
  `npm run check` pass（module 1件追加）。

## 未検証・持ち越し

- 8条件scripted campaignと正解集合exact比較・artifact-only再計算はRC3-H所有。
- witnessの「accepted checkpoint／seam transformとのscope非交差」「新planでの
  predecessor/conflict/capacity/affected-test同値」の完全再照合はRC3-H artifact verifierへ配線。
- genesis sentinel（checkpoint無しcarry-overのauthorized digest）の正式契約はRC3-J ADR。
