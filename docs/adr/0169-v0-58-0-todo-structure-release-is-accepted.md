# ADR 0169 — v0.58.0 ToDo構造グラフ公開を受理する

- Status: Accepted
- Date: 2026-08-12
- Owners: Lattice
- Implements: ADR 0168
- 計画正本: [plan_todo-logical-structure-graph.md](../plan_todo-logical-structure-graph.md)
- 公開証跡: [2026-08-12-v0.58.0-todo-structure-release.md](../evidence/2026-08-12-v0.58.0-todo-structure-release.md)

## Context

ADR 0168で決めたToDo構造グラフ検査は、実装、回帰、配布面の確認を終えた。オーナーは
`H承認　やれ`と明示承認し、remote main、npm、Macのglobal CLI、公開dashboardへ同じ0.58.0を
届けるH操作を許可した。

公開直前の依存監査では、Lattice Sensorの本番依存`picomatch 4.0.3`にReDoS advisoryが見つかった。
公開対象を4.0.5へ更新し、本番依存audit 0、Sensor全test greenを再確認した後のcommitだけを公開した。

## Decision

release commit `59095c77dce1e805432523cee5c52aac7a8df4ff`から作った
`@quolu/lattice@0.58.0`を、ToDo構造グラフ機能の受理済み公開版とする。

- `origin/main`、npm registryの0.58.0、Mac global install、常駐bridgeは同じ公開版へ揃った。
- npm tarballのSHA-1は事前packとregistryで
  `a786dbfe00a8cd2996eeaa82e35354855b938f5d`に一致した。
- 公開dashboardはHTTP 200を返し、保存artifactから作る
  `lattice.todo_structure_presentation.v1`を含む。
- 公開npmからglobal installしたCLIで、実GitとSensorを使うcompile、finding、realize、finalize、
  未適用plan互換の一周を成功させた。
- 構造検査未適用の現行公開planが`plans: []`を返すことは、opt-in契約どおりであり欠落ではない。

## Rollback

npm版はunpublishしない。Mac側を`npm install -g @quolu/lattice@0.57.3`で戻し、dashboard登録と
`dev.kitepon.lattice.bridge`を再起動する。remote mainの履歴は巻き戻さず、必要な修正は新しいversionで出す。

## Consequences

- sg17を完了とし、Markdown工程を閉じる。
- 0.58.0以後の利用者は、code planへ明示opt-inした場合だけ構造入力、compile、realization、finalizationを使う。
- Sensorの開発専用依存にはVitest 2系由来のaudit advisoryが残る。0.58.0のインストール時・実行時依存には
  含まれず、本番依存auditは0である。Vitest major更新は公開済み0.58.0を書き換えず、別の保守変更で扱う。

