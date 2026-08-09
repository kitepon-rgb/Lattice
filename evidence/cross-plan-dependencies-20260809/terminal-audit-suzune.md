# plan跨ぎ依存 独立終端監査（すずね）

## 判定

findingなし。`cross-plan-dependencies-20260809`を受入可と判定する。

監査者は実装者りんとは別のすずね。t19で、別planの入力を待つconsumerが
`in-progress`のまま機械上は稼働中に見え、席数制御を誤らせる欠落を実測した文脈保持席として、
2026-08-09に終端監査を行った。

review event:

- phase: `terminal-audit`
- event digest: `0da87ba1d28f62ddbb634e3b74dade41a593c578b376e9057fb07868e4b6ca47`
- sequence: 9

## 実物照合

- `7fbc063`: `todo dependency connect`はproducer/consumerのproject・plan・task・topology digestを
  exact identityへ束縛し、consumer planのappend-only plan-scoped chainへ記録する。
- 同一plan、重複、stale topology、merged graph cycle、完了済みproducer/consumer、owner不一致を
  typed errorで拒否する。記録前にmerged graphを検証するため、拒否時に部分writeを残さない。
- `963d27a`: 接続線はplan内DAGと同じready/frontier/start/done gateへ合成される。
  先行着手済みconsumerは履歴上`active_set`に残すが、未完了producerを
  `unmet_dependencies`へ出し、実装席数の入力から分離する。
- `a52b64b`: flat/nested Ganttは同じexact identityを`cross_plan` edgeとして描き、
  nested lineageでは各endpointを表示levelのroot containerへ射影する。
- `8cf3bed`: 公開CLIだけの一気通貫testが、consumer先行着手→発見時接続→待機投影→
  producer完了→会話なしの自動解錠と、event digest不変を確認する。
- backlogの要件どおり、完全静的発見は要求せず、開発中に発見した線の明示接続以後を
  machine-held obligationとして運ぶ。independence compileの意味的完全性は拡張していない。

## 検証

- 実装者固定資料: `9ea3324198704af844a408917381350c8fde19d0`
  (`terminal-audit.md` blob `32862914995b266d6fdf4e56831aaf24e04732c5`、
  content SHA-256 `ee08934a7bb754a6464e19f38179859d3e13e10a0d46f3202a92405b18af64f0`)
- clean SHA `1faee295c1d316fd1028157af824e4734654ba8c`からの`npm run ci`: exit 0、
  product 1550/1550、sensor・syntax/static・CLI surface・open questions・reachability・store verify green。
- 初回CIのexact key不一致は`1faee29`で現行契約へ追従。時間依存失敗は対象test単独2回と
  修正後完全CIでgreenとなり、source変更を要する再現欠陥は確認されなかった。
- 監査者のfocused再実行:
  `todo-cross-plan-dependency` integration/unit、`todo-cross-plan-status`、
  `todo-gantt-cross-plan`の計12件すべてgreen。
- store verify: topology `cf97f3bfa73d37d72ebf27614f30a354b9e989248900e79d58854cf20a14d710`、
  task journal head `25429c6ec2f38c9d5bf4a9ce730e2ffabce9275b5703b088a7220eaa1b975f62`、
  through sequence 8、snapshot stale=false。
- cp4実ブラウザ証拠は、producer未完了時の待機表示とexact edge、producer完了後のSSEだけによる
  card・前提工程・CLI `unmet_dependencies`の解錠を記録している。

以上から、t19で実測した機械状態と実態の乖離は、発見時接続後のready/frontier/席数/Ganttへ
一貫して反映される形で閉じた。未充足条件はない。
