# ADR 0124 — TODO工程とruntime実行を結ぶ公開投影を持つ

- Status: Accepted
- Date: 2026-07-25
- Extends: [ADR 0123](0123-runtime-contract-distribution-and-diagnosability.md)（runtime契約の配布と診断）
- Relates: [ADR 0053](0053-todo-store-and-gantt-surface.md)（TODO工程store面）・
  [ADR 0044 Decision 7](0044-rc3-runtime-contract.md)（packet／receiptの帰属）

## Context

「Lattice公開面だけで、子ごとのTask identity・scope・result digest・run／packet帰属を検証できるか」を
実測した。できなかった。実測（Lattice 0.12.20）で分かったのは次のとおり。

- `todo status`のtask entryは`plan_key`・`task_id`・`label`の3keyだけを返す。
- `executor_receipt.v1`は`todo_id`と`packet_digest`を持つが、`todo_id`はrun requestで
  host自身が決めた値であり、TODO storeの`project_id`／`plan_key`／`plan_version`修飾を持たない。
- したがってhostは「このreceiptはどのTODO taskの結果か」を自分の側の対応表で主張するしかない。

決定的なのは受入証拠の実験である。`todo_id`が`WRONG-NOT-t-001`のreceiptを指すevidence descriptorを
task `t-001`の完了証拠として渡したところ、`todo done`は受理した。evidenceはblobをcontent digestで
bindするだけで、receiptがそのtaskの実行結果かを検証しない。**相関はhostの自己申告であり、
公開面が保証する事実ではなかった。**

一方で、環そのものは設計済みだった。`lattice.todo_plan.v5`のtaskは`compile_binding`を持ち、
store側validatorは`{boundary_manifest_digest, compiled_plan_digest, topology_digest, base_sha}`という
非nullの値を受理する。実測でも、この形を含むplanが`buildTodoPlan`／`validateTodoPlan`を通過した。

欠けていたのは値の置き場ではなく**公開の読み取り面**である。`compile_binding`はどの公開投影にも
現れないため、設定されていてもhostから見えず、検証に使えなかった。

## Decision

1. `lattice todo bindings [--plan <key>] [--json]`を追加し、`compile_binding`が設定されたTaskだけを
   TODO正本のidentity（`project_id`・`plan_key`・`plan_version`・`task_id`）つきで投影する。
   schemaは`lattice.todo_binding_projection.v1`とし、自己digest規則の`result_digest`を持つ。
2. `lattice.todo_status_result.v4`は変更しない。binding投影は加算の別面とし、v4を受理する
   既存hostを壊さない。工程の読み取りとbindingの読み取りを別の面に保つ。
3. 投影は`compile_binding`の値を加工せずそのまま渡す。hostは`compiled_plan_digest`で
   `runtime_plan.v1`を、`base_sha`でrun requestのbaseを照合し、そこから`executor_packet.v1`
   （`plan_ref`・`todo_id`）と`executor_receipt.v1`（`packet_digest`帰属）まで辿る。
4. `--plan`で指定したplanが存在しない場合、read modelが不正な場合は、空集合へ丸めずfail closedにする。

## 非目標

- `executor_receipt.v1`へTODO store identityを足さない。receiptの帰属規律（ADR 0044 Decision 7.4、
  event順序で判定）を変えず、TODO側から辿れる面を用意することで環を閉じる。
- `compile_binding`の書込口を新設しない。`lattice.todo_plan.v5`は既に非null値を受理し、
  revision transactionが更新経路である。`plan create`が`compile_binding`をnull固定にする制約は
  authoring時点でcompile結果が存在しないためであり、維持する。
- evidence受理時にreceipt内容を検証しない。evidenceはblobをcontent digestでbindする面であり、
  receiptの意味解釈をそこへ持ち込まない。binding検証はbinding投影の側で行う。

## Consequences

- TODO task identityからexecutor receiptまでが、公開CLIとversioned schemaだけで辿れるようになる。
  hostの側の対応表を信用する必要がなくなる。
- `todo bindings`は`compile_binding`が未設定なら空集合を返す。これは「binding経路が無い」ではなく
  「まだ束ねていない」を意味し、両者が公開面で区別できる。
- `test/todo-binding-projection.test.mjs`が、identity付き投影・plan絞り込み・安定順序・
  fail closed・自己digestを機械検査する。
