# cp1 発見時接続の契約と書込面

## 実装

- 公開CLI `lattice todo dependency connect --from-plan <key> --from-task <id> --to-plan <key>
  --to-task <id> --reason <text>`を追加した。
- 接続はconsumer planの`plan-scoped.jsonl`へ`cross_plan_dependency` eventとしてappendする。
  lifecycle journal、task状態、snapshot、manifest headは直接動かさない。
- eventはproducer/consumerの`project_id`・`plan_key`・`task_id`・
  `expected_topology_digest`を保持する。active topologyと一致しない参照はstaleとして拒否する。
- 読み側の共通入口`projectTodoCrossPlanDependencies`は、active plan群に記録された線だけを
  task identity順で投影する。依存の自動推定や暗黙補完はしない。

## typed validation

- plan/task不存在
- project不一致、同一plan内の接続、consumer planとevent ownerの不一致
- active topologyと一致しないbinding
- 同一producer→consumer辺の重複
- 既存plan内・plan間依存と合成したcycle
- done済みproducerまたはconsumerへの後付け

拒否はappend前に行い、plan-scoped chainへ失敗eventを残さない。

## 検証

```text
node --test test/todo-cross-plan-dependency.test.mjs
tests 5 / pass 5 / fail 0

node --test test/todo-coordination-mode.test.mjs test/cli-help.test.mjs \
  test/todo-store.test.mjs test/todo-cross-plan-dependency.test.mjs
tests 87 / pass 87 / fail 0

npm run check
syntax check passed: 150 files
```

新規testは、chain分離、actor・identity・topology束縛、共通投影、同一plan・重複・stale・
cycle・terminal拒否、公開CLI result、公開helpのexact argvを実測した。既存testは
coordination eventのplan-scoped chain、cross-plan predecessorを含むmerged graph、journal/snapshot、
evidence、revision/importの回帰を通した。

## 境界

cp1は接続事実の記録と検証だけを実装した。接続済みの線をready/frontier/active席数へ反映するのはcp2、
Ganttへ描くのはcp3、実plan間の一気通貫受入はcp4が持つ。
