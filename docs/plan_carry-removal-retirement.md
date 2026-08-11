# plan: 打ち切り工程の退役を可能にする（2026-08-11 campaign）

- Status: Completed（0.57.3を公開し、Mac／WSL2への配布実測まで完了）
- 起点: 2026-08-11、打ち切り済みのbridge-hub bh5/bh6/bh7をplanから退役できないと判明した
- 関連: [ADR 0167](adr/0167-carry-tolerates-edges-to-tasks-removed-by-the-same-revision.md)（Proposed・反証中）・
  [ADR 0166](adr/0166-recovery-paths-must-not-refuse-the-state-they-repair.md)（同型の欠陥）
- 工程正本: Lattice store（`plan_key: carry-removal-retirement`）。本書は散文と裁定を持つ。

## 背景

オーナー裁定で打ち切った工程を`lattice todo revise`で退役させようとして、`carry_semantics_changed`で
拒否された。carry判定はcarry対象taskに触れる**全ての辺**を1つの比較へ含めて完全一致を要求するため、
末尾のbh5を削ると先行bh4の辺集合が変わって壊れる。bh4も削ればbh3が壊れ、連鎖して全taskが必要になるが、
planは`tasks >= 1`を要求するので空にもできない。`reset_pending`は比較を回避するがdoneをpendingへ戻す
（履歴の破壊）ため採れない。**打ち切った工程を退役させる表現が製品に存在しない。**

ADR 0166と同型である——片付けるための経路が、片付け対象そのものに阻まれている。

## 実測で分かっていること（着手の材料）

- **carry判定以外のgateは全て通る。** canonical bytes、digest鎖、source digest照合、
  `live_replacement`のlist構造、reconciliationは通過し、carry判定だけで落ちた。
- 生成scriptが手元にある（`narrative_anchor: null` ＋ `carry_reconciled_metadata` ＋ cutover batch）。
  直れば受入テストにそのまま使える。
- `docs/plan_bridge-hub.md`はToDo節が既に削除されており、storeのanchorが指すL65-71が存在しない。
  cutoverを通すにはcommit `f673b881`から原本行を復元する必要がある（digest 7/7一致を確認済み）。

## 非目標

- **plan単位の退役・削除機能**。本campaignはtask単位の退役だけを解く。
- `reset_pending`の意味論の変更。
- carry判定の一般的な緩和。緩めるのは「同じrevisionで削除が宣言された相手への辺」だけとする。

## 既知の罠

- **契約クリティカル（F）。** carryが保証する意味論そのものを変える。コード量は小さいがリスクは
  量ではなく不変条件の正しさにあるので、設計は反証を通してから実装へ渡す。
- 円卓のCodex席が動いている間、codex-sidecarは`AUTH_LEASE_BUSY`で使えない（auth leaseは1本）。
  卓の外からCodexへ反証を投げる計画を組まない。
- 緩和は`taskSemantics`と`phaseV3CarrySemantics`の両方に要る。片方だけ直すとphase v3経路が残る。

## 検証方法

- 単体: `test/todo-revision-writer.test.mjs`・`test/todo-phase-revision-v3.test.mjs`・
  `test/todo-store.test.mjs`をfocused testに使う（既存14アサーションがcarry系のcodeを参照している）。
- 退行の要: **削除以外の辺の増減は従来どおり拒否されること**を新規testで固定する。
  緩和が「辺は変わってよい」へ広がっていないことの証明が受入条件である。
- 受入: bh5/bh6/bh7が実際にplanから消え、`lattice todo status`と工程表に出なくなること。

## ToDo

- [ ] cr1-refute: ADR 0167を実コードで反証し、採用可否と代替案を所見として出す
- [ ] cr2-impl: carry判定の緩和を実装し、削除以外の辺変化が拒否されることをtestで固定する
- [ ] cr3-adr: 反証結果を反映してADR 0167をAcceptedへ確定する
- [ ] cr4-retire: bh5/bh6/bh7をreviseで退役させ、工程表から消えたことを実測する
- [ ] cr5-release: 本修正を含む版をreleaseし、全端末へ配って実測する（H）
