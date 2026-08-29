# ADR 0186: dashboard daemonの生存はlaunchd周期の`todo dashboard ensure`が機械保証する

- status: accepted
- date: 2026-08-29

## 文脈

dashboard daemonのensure（起動・引き取り・重複排除）は、書込み系todoコマンドの副作用として
だけ走っていた。OS再起動でdaemonが死ぬと、誰かがLatticeへ書込むまで公開工程図は503のまま
沈黙する（2026-08-29実被弾: Mac再起動後、オーナーが手動報告するまで誰も気づかなかった）。
毎回の手動蘇生はオーナー裁定で禁止された（「死んだら自動で起こせ。毎回手で復活させるな」）。

daemon本体をlaunchdのKeepAliveで直接走らせる案は、descriptor（ln）の所有設計と衝突する——
lnは起動側が所有するため、直起動のdaemonは登録簿に載らず、bridgeから観測されない不死個体になる
（2026-08-29に実測: 直起動個体がln外で配信し、公開経路は503のまま）。

## 決定

生存保証の独立入口 `lattice todo dashboard ensure --json` をCLIへ公開する。中身は既存の
`ensureActiveProjectDashboard`そのもの（ln引き取り・迷子掃除・不在時spawn）であり、冪等である。
運用はこの入口をlaunchd等の周期実行（RunAtLoad＋StartInterval）から叩く。定義見本は
`docs/launchd/dev.kitepon.lattice-dashboard.plist`（要: PATHとLATTICE_TODO_ACTOR_*の明示。
launchd環境は変数をほぼ持たない）。

daemon本体のKeepAlive直起動は行わない。

## 帰結

- v0.67.1で出荷。殺害テスト（daemon kill→周期tickで自動蘇生→公開URL 200）を実測済み
- ensureは書込みコマンドの副作用としても従来どおり走る（この決定は入口の追加であり移設ではない）
