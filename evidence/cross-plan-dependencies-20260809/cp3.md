# cp3 Ganttのplan跨ぎ依存表示

## 実装

- cp1の`cross_plan_dependency`をGanttのmerged topologyとlayout graphへ合成した。
  edge kindは`cross_plan`とし、既存のhard/join edgeと同じrouting・wave・最長鎖・live/all scopeの
  構造計算へ載せる。
- `renderTodoGanttForProject`が作るchain projectionにも同じ辺を入れたため、図のwaveと
  最長依存鎖がplan内edgeだけを見て食い違わない。
- endpointは`project_id`・`plan_key`・`task_id`の完全identityで束縛する。layoutに存在しない
  taskや同一taskへ近似せず、既存どおりtyped errorでfail closedする。
- nested lineageでは、子task間のplan跨ぎedgeを各level直下のcontainerへ射影する。
  root図だけ依存線が消えたり、子task参照を存在しない近似taskへ結んだりしない。
- ready判定もlayoutの同じincoming graphを見る。producer未完了ならconsumerは未着手表示のまま
  ready frontier枠を持たず、producer完了後は同じedgeを保ってreadyになる。

## 自動検証

```text
LATTICE_DASHBOARD_AUTOSTART=0 node --test \
  test/todo-gantt-cross-plan.test.mjs \
  test/todo-gantt-layout.test.mjs \
  test/todo-gantt-nested.test.mjs \
  test/todo-gantt-scope.test.mjs \
  test/todo-gantt-render.test.mjs \
  test/todo-gantt-live.test.mjs
tests 78 / pass 78 / fail 0

npm run check
syntax check passed: 150 files
```

新規test 3件は、exact identityのedge、入力待ちconsumerの非-ready、producer完了後の解放、
nested containerへの射影を実測した。既存回帰は座標・routing・join・folding・live/all scope・
階層・HTML/SVG・dynamic serveを通した。

## 実ブラウザ受入

一時repo `cp3-browser`へproducer planの`P`とconsumer planの`C`を作り、公開CLI
`todo dependency connect`で`producer/P → consumer/C`を接続した。producerをin-progressにして
`todo gantt serve --port 0 --scope all`を起動し、実ブラウザで操作した。

- `[data-edge-id]`は1件で、from=`["cp3-browser","producer","P"]`、
  to=`["cp3-browser","consumer","C"]`、画面上で可視だった。
- consumer cardは可視で`next-ready-node`を持たなかった。
- consumerを選択すると、詳細ペインの「前提工程」に
  `▶ 作業中 / 工程 P / 入力を作る`が表示された。
- producer/consumer cardのaria labelはそれぞれ正規ID `producer/P`・`consumer/C`を含んだ。

確認後はbrowser tabを閉じ、serve processを正常停止した。一時repoはTrashへ移動し、元pathの
不存在を確認した。

## 次工程

cp4が実storeで、接続記録、待機投影、Gantt、producer完了後のconsumer解放を一気通貫で受け入れる。
