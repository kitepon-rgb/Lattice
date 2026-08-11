# cr3-adr 受入証跡

## 成果物

`docs/adr/0167-carry-tolerates-edges-to-tasks-removed-by-the-same-revision.md`（Status: Accepted）

## 確定した不変Decision

1. carryは辺の完全一致を要求し続ける。ただし、同じrevisionの`task_migration`で
   `to_task_id: "removed"`と宣言された相手への辺だけは消滅を許す。
2. 緩めるのは削除に限る。削除以外の理由で辺が増減した場合は従来どおり拒否する。
3. 根拠は宣言の存在。削除は`task_migration`へ明示されており、黙って壊れるのではない。
4. task属性の一致要求は変えない。本決定が触るのは辺だけである。
5. **`joins.after`からremovedを除外した結果が空になる場合、join全体をpredecessor意味論から除外する。**
   空`after`はdesired plan側のvalidatorが`after.length > 0`を要求するため表現不能
   （`todo-migration.mjs:125-131`）。
6. `acquire_phase`も同じfilterを通す。`reset_pending`は比較を通らない別系統なので触らない。
   `carry_reconciled_metadata`は同一filter下で属性比較を残す。

## cr1の反証から取り込んだもの

Decision 5 は**私の設計漏れ**だった。提案時のADRは「joins.afterから除外する」とだけ書いており、
除外の結果が空になる場合を扱っていなかった。cr1（suzune・gpt-5.6-terra）が実コードの行を引いて
指摘し、必須条件として取り込んだ。Decision 6 も同じ反証から。

## 棄却した代替

`removed`ではなく`retired`状態を新設する案。state machine・runtime task migration・source cutoverの
いずれも広げることになり、辺の比較だけを削除宣言の範囲で緩める本決定より影響面が広い。
「より安全な代替」として成立しないと反証で確認された。

## この時点で未検証のこと

本Decisionは実装（cr2-impl）前の判断である。実装で「削除以外の辺変化が従来どおり拒否されること」を
testで固定するまで、緩和が意図の範囲に収まっている証明は無い。それはcr2の受入条件が持つ。
