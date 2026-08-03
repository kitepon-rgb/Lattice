# ADR 0157: dashboard daemonはdescriptorではなく登録簿で観測する

- Status: Accepted
- Date: 2026-08-03

## Context

todo dashboard daemonの生死は`~/.lattice/dashboard/daemon.json`（descriptor）1枚だけが持っていた。
`ensureTodoDashboardDaemon`はこのfileが名指すpidをhealthで認証し、それ以外のprocessを見る経路を
持たない。したがって**descriptorから一度外れたdaemonは、生きていても二度と誰にも観測されない**。

2026-08-03に実機で2度起きた。v0.45.1のinstall直後、旧daemon（pid 39520・22:15起動）は版が古いので
`legacy`と判定され、新daemon（60417）が起動してdescriptorを書いた。旧daemonへSIGTERMを送る前に
起動側のprocessが死に、`daemon-start.lock`が残ったまま旧daemonが取り残された。以後、descriptorは
60417しか指さないので、39520は不死になった。

これはsensor側のdaemon登録簿の漏れ（`83e03d6`・実測978件）と同じ形である——状態をfileで持ち、
fileから漏れたものを現実と突き合わせない。直し方も同じで、pidごとの記録と、全daemonが必ず通る
一点での掃除である。

## Decision

1. **daemonごとの記録`<runtimeDir>/daemons/<pid>.json`を置き、書き手はdaemon自身とする。**
   内容はdescriptorと同一schema（`lattice.todo_dashboard_daemon.v1`）にして、既存の
   `validDaemonDescriptor`／`daemonAttestation`をそのまま記録の検証にも使う。判定器を増やさない。
2. **descriptorの所有者は起動側のまま動かさない。** 死ぬ側が触るのは自分の記録だけである。
   descriptorには置換のrollback契約（新daemon起動失敗時にlegacyへ戻す）が乗っており、
   死にゆくdaemonがそこへ書くと、可用性を守るための復元と競合する。
3. **記録を先に置き、descriptorを後に書く。** 逆順にすると「descriptorだけが在って記録が無い」
   瞬間ができ、その隙に起動側が死ねば、まさに直そうとしている観測不能なdaemonが生まれる。
4. **掃除とreconciliationは`ensureTodoDashboardDaemon`のstartup lock内で行う。** ここは
   全daemonが必ず通る唯一の点である。死んだpidの記録を落とし、descriptorの整合が確立した後
   （かつその後だけ）、descriptorが指さない生存daemonを停止する。
5. **descriptorを失った時は、2本目を建てずに登録簿の生存daemonを引き取る。** `current`なら
   descriptorを書き直して返し、`legacy`ならdescriptorへ据えてから既存の置換経路へ乗せる。
   引き取る相手はhealthで応答しているので、「descriptorは常に生きて応答するdaemonを指す」
   という不変条件を壊さない。
6. **signalを送るのは、その場で再認証を通った相手だけとする。** 応答しない生存pidへ送れば、
   pid再利用で無関係のprocessを殺しうる。認証できないpidは記録を残したまま見送り、次の起動が
   判定し直す。これはlegacy置換が既に守っていた不変条件を、孤児の停止へも同じ形で広げたものである。
7. **認証を通った孤児はLattice自身のdaemonなので、SIGTERMで死ななければSIGKILLへ上げ、
   それでも死ななければtyped error`DASHBOARD_ORPHAN_STOP_FAILED`で止まる。** 黙って諦めない——
   諦めれば漏れが元に戻り、次の観測不能なdaemonになる。
8. **`stopAttestedLegacyDaemon`と孤児停止を1つの関数へ統合しない。** 契約が違う——置換前の
   legacyは認証を失ったこと自体がerror（版を入れ替える確証が要る）、孤児は認証を失っても
   見送りでよい（次回がある）。共有するのは「signalしてから停止を待つ」核だけとする。

## Consequences

- **既にdescriptorから外れているdaemonは、この修正では見つけられない。** 記録を持たないまま
  取り残されているためで、原理的に発見手段が無い（port走査はしない）。実機に残っていた
  pid 39520は手で停止した。修正が防ぐのは以後の発生であり、過去の孤児の遡及救済ではない。
- 残る窓がある。daemonがportをbindしてから記録を書くまでの間に起動側が死ぬと、そのdaemonは
  記録を持たないまま生き残る。起動側はportを知らないので、代わりに記録を書くことはできない。
  この窓は起動側がchildをkillする経路で塞がれており、塞がらないのは起動側が突然死した場合だけである。
- 登録簿はsensor側と同じく自己制御になる。育つ上限は「生きているdaemon＋前回の起動以降に
  死んだ分」で、人の操作に依存しない。
