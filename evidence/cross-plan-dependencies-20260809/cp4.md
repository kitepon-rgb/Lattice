# cp4 実plan間の統合受入

## 一気通貫シナリオ

異なるproducer/consumer planを持つ実storeを作り、次の順序を公開CLIで実行した。

1. 発見前から進行中だった状態を再現するため、理由と`--serial-confirmed`を記録してconsumerを着手。
2. `todo dependency connect`で`producer/P → consumer/C`を接続。
3. `todo status`、event chain、Ganttを観測。
4. producerを着手し、git blobへ束縛したevidenceでdone。
5. 会話や外部状態変更なしでstatusとlive Ganttが解錠後状態へ変わることを観測。

接続直後の機械状態:

- `next_ready = [producer/P]`、dispatch frontierの推奨並列数は1。
- consumerは履歴上in-progressのため`active_set`へ残り、
  `unmet_dependencies = [producer/P]`を持つ。
- `unmet_dependencies.length === 0`のactive実装席数は0。
- consumer planのplan-scoped chainに`cross_plan_dependency`が1件あり、producer/consumerの
  topology digestを含むexact identityへ束縛される。
- Ganttは同じidentityのedgeを描き、consumerをreadyにしない。

producer done後の機械状態:

- consumerの`unmet_dependencies`は空になり、active実装席数は1。
- consumerは既にin-progressなので`next_ready`へ戻さず、そのまま作業再開可能になる。
- producer lifecycle chainは`plan_genesis → start → done`。
- consumer plan-scoped eventのdigestは接続時から不変。

## 自動検証

新規integration test:

```text
LATTICE_DASHBOARD_AUTOSTART=0 node --test \
  test/integration/todo-cross-plan-dependency.integration.mjs
tests 1 / pass 1 / fail 0
```

cross-plan全経路と旧plan内依存のfocused regression:

```text
LATTICE_DASHBOARD_AUTOSTART=0 node --test \
  test/integration/todo-cross-plan-dependency.integration.mjs \
  test/todo-cross-plan-dependency.test.mjs \
  test/todo-cross-plan-status.test.mjs \
  test/todo-ready-frontier.test.mjs \
  test/todo-status.test.mjs \
  test/todo-store.test.mjs \
  test/todo-gantt-cross-plan.test.mjs \
  test/todo-gantt-layout.test.mjs \
  test/todo-gantt-nested.test.mjs \
  test/todo-gantt-scope.test.mjs \
  test/todo-gantt-render.test.mjs
tests 152 / pass 152 / fail 0

npm run check
syntax check passed: 150 files
```

## 実ブラウザ受入

別の一時repo `cp4-browser`で同じconsumer先行着手→接続を再現し、
`todo gantt serve --port 0 --scope all`を実ブラウザで操作した。

接続直後:

- edgeは1本で、from=`["cp4-browser","producer","P"]`、
  to=`["cp4-browser","consumer","C"]`、画面上で可視。
- consumerは作業中表示だがready frontier枠を持たない。
- consumer詳細の「前提工程」は`☐ 未着手 / 工程 P / 入力を作る`。

ブラウザを開いたままproducerをstart→doneすると、SSEによるlive更新だけで:

- producer cardのaria labelが`工程P。完了。…正規ID producer/P`へ変化。
- consumer詳細の前提工程が`✅ 完了 / 工程 P / 入力を作る`へ変化。
- plan跨ぎedgeは同じexact identityのまま可視。
- CLI statusではconsumerの`unmet_dependencies=[]`。

確認後はbrowser tabを閉じ、serve processを正常停止した。一時repoはTrashへ移動し、元pathの
不存在を確認した。

## 非目標

完全静的発見は受入条件へ加えていない。cp1の明示接続契約を起点に、記録後の状態運搬と解錠が
機械だけで完結することを受け入れた。
