# cp2 ready・frontier・active席数への反映

## 実装

- `projectTodoStatus`と`computeReadyFrontier`が共有するgraphへ、cp1の
  `cross_plan_dependency`を合成した。producer未完了のpending consumerは、接続直後から
  `next_ready`とdispatch frontierの双方へ出ない。
- storeのmerged predecessor/successor graphにも同じ依存線を合成した。表示だけ待機にして
  writerがstart/done/reopenを通す不一致を作らず、実遷移もhard gateで拒否する。
- consumer着手後に依存を発見した場合、append済みのstart履歴は巻き戻さない。consumerは
  `active_set`へ残り、`unmet_dependencies`へproducerを明示する。実装席数を求める側は
  `unmet_dependencies.length === 0`だけを数えるため、待機consumerを占有席へ数えない。
- synthetic read modelのようにplan-scoped chainを持たない投影入力は、接続線なしとして扱う。
  記録済み線を暗黙補完する挙動ではない。

## 境界判断

cp2のwitnessはstart gate追加でscope growthを検知したが、分割しなかった。status/readyと
writerのstart gateが別作業になると、同じ接続線に対して「表示上は待機だがstart可能」または
「表示上はreadyだがstart拒否」という中間状態を作るためである。両面を同じbehavior unitとして閉じた。

既存status schema v6の`active_set`は履歴上in-progressの集合であり、その各要素が
`unmet_dependencies`を既に持つ。待機発見時に要素自体を消すschema変更は行わず、このfieldを
schema-stableな実装席数入力として使う。

## 検証

```text
node --test test/todo-cross-plan-status.test.mjs
tests 3 / pass 3 / fail 0

LATTICE_DASHBOARD_AUTOSTART=0 node --test \
  test/todo-cross-plan-status.test.mjs \
  test/todo-cross-plan-dependency.test.mjs \
  test/todo-ready-frontier.test.mjs \
  test/todo-status.test.mjs \
  test/todo-store.test.mjs
tests 86 / pass 86 / fail 0

npm run check
syntax check passed: 150 files
```

新規testは、接続直後のready/frontier除外とstart拒否、着手後発見時の履歴保持と席数分離、
producer done後の自動解放とstart成功を実測した。既存回帰はstatus境界、ready投影、merged transition、
journal/snapshot、evidence、revision/importを通した。

直接`node --test test/todo-status.test.mjs`をactor環境付きで実行した初回は、製品CLIのdashboard
autostartがテスト用project identityと競合した。製品テスト入口と同じ
`LATTICE_DASHBOARD_AUTOSTART=0`で再測し、6/6 greenを確認した。孤児daemon一覧は0件だった。

## 次工程

cp3が同じ接続線をGanttへ描き、cp4が実plan間の接続からproducer完了後のconsumer解放までを
統合受入する。
