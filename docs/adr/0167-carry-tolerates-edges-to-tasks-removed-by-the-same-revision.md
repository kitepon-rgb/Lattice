# ADR 0167 — carryは、同じrevisionで削除される相手への辺の消滅だけを許す

- Status: Accepted（2026-08-11、実コード反証を通過。必須条件をDecision 5へ取り込んだ）
- Date: 2026-08-11
- Extends: [0166 — 復旧経路は、復旧対象の状態に拒否されてはならない](0166-recovery-paths-must-not-refuse-the-state-they-repair.md)
- 計画正本: [plan_bridge-persistence-recovery.md](../plan_bridge-persistence-recovery.md)

## Context

2026-08-11、オーナー裁定で打ち切られた工程（`bridge-hub`のbh5/bh6/bh7）をplanから退役させようとして、
正規経路の`lattice todo revise`が`carry_semantics_changed`で拒否した。

carry判定（`taskSemantics`／`phaseV3CarrySemantics`）は、carryするtaskに触れる**全ての辺**を
1つの比較へ含めて完全一致を要求する。末尾のbh5を削ると、その先行であるbh4の辺集合が変わるため
bh4のcarryが壊れる。bh4も削ればbh3が同じ理由で壊れ、連鎖して全taskが必要になるが、
planは`tasks >= 1`を要求するので空にもできない。**打ち切った工程を退役させる表現が存在しない。**

回避路も塞がっている。`reset_pending`はcarry比較を通らないが、doneのbh1〜bh4をpendingへ戻す——
完了した実績を未完了に見せる履歴の破壊であり、採れない。

この形はADR 0166と同型である。**片付けるための経路が、片付け対象そのものに阻まれている。**

なお、この判定以外のgateは全て通ることを実測で確認済みである（canonical bytes、digest鎖、
source digest照合、live_replacementのlist構造、reconciliation）。残る障害はこの1点だけである。

## Decision

1. **carryは辺の完全一致を要求し続ける。ただし、同じrevisionの`task_migration`で
   `to_task_id: "removed"`と宣言された相手への辺だけは、消滅を許す。**
   比較の前に、predecessor側の`hard_dependencies`・`joins.after`・`phase_accept_dependencies`から
   「相手がこのrevisionで削除されるtask」を除外する。
2. **緩めるのは削除に限る。** 削除以外の理由で辺が増減した場合は従来どおり
   `carry_semantics_changed`で拒否する。「辺は変わってよい」という一般化はしない。
3. **根拠は宣言の存在である。** 削除は`task_migration`へ明示されており、黙って壊れるのではなく
   revisionの一部として申告されている。申告された削除の帰結を、申告していない意味変化と
   同じ厳しさで拒む理由が無い。
4. **task属性の一致要求は変えない。** title・lane・compile_binding・narrative（policyに依る）の
   比較は従来のままとする。本決定が触るのは辺だけである。
5. **`joins.after`からremovedを除外した結果が空になる場合、そのjoinはpredecessor意味論から
   join全体を除外する。** 空の`after`を残してはならない——desired plan側のvalidatorが
   `after.length > 0`を要求するため、空afterを持つjoinは表現不能であり、比較も一致しない。
   複数`after`から一部だけを抜いた場合は、残ったafterをsortしてからjoinを比較する。
   （2026-08-11の反証で発見。この条件を欠くと、joinを持つplanで本決定は成立しない。）
6. **`acquire_phase`も同じfilterを通す。** `reset_pending`はcarry比較自体を通らない別系統なので
   触らない。`carry_reconciled_metadata`は同一filterの下で従来どおり属性比較を残す。
   既存の分岐構造は変えない。

## Consequences

- 打ち切った末尾工程を、先行taskのdone状態を壊さずに退役できる。
- 削除された相手へ依存していたtaskは、その依存を失った状態でcarryされる。これは意図した挙動で、
  「先行の完了実績は、後続が消えても消えない」という素直な意味論に一致する。
- 逆向き（削除されたtaskからの入力辺を持つtask）も同じ規則で扱う。孤立は削除の帰結であり、
  revisionが申告している。
- 危険は「削除を宣言すれば辺の検査を緩められる」経路が開くことである。緩むのは**その削除された
  task_idに触れる辺だけ**で、他の辺は従来どおり完全一致を要求するため、緩和の範囲は削除宣言の
  範囲を超えない。

## 棄却した代替

**`removed`ではなく`retired`状態を新設する案**を検討し、棄却した。state machine・runtime task
migration・source cutoverのいずれも広げることになり、辺の比較だけを削除宣言の範囲で緩める本決定より
影響面が広い。「より安全な代替」として成立しない（2026-08-11の反証で確認）。

## 非目標

- planそのものの退役・削除機能。本決定はtask単位の退役だけを解く。plan単位の始末は別の問題として扱う。
- `reset_pending`の意味論の変更。
- carry判定の一般的な緩和。緩めるのは削除が宣言された相手への辺だけとする。
