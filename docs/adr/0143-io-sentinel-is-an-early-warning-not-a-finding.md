# ADR 0143 — 実行時競合の早期警報は、findingではなく引き金である

- Status: Accepted
- Date: 2026-07-28
- Relates: [ADR 0044](0044-rc3-runtime-contract.md)（隔離worktree executor・receipt裁定）・
  [ADR 0127](0127-todo-independence-projection.md)（未検査と検証済みを混ぜない）・
  [ADR 0140](0140-canonical-write-observation-is-recorded-not-assumed.md)（Decision 3を狭く上書きする）

## Context

競合はcheckpointを撮った瞬間にしか見つからなかった。checkpointに周期は無く、timerも監視も無い。
hostがCLIを叩いた時——実質、workerが完了した時——とhold barrierの時だけ観測される。2つのworkerが
同じ資源を触っても、**片方が完了するまで誰も気づかない**。holdで捨てる作業量の正体はこの窓である。

判定に要る材料は既にある。書き込みイベントのpathからworktree rootを剥がせばrepo相対pathになり、
**そのpathが他のrunning TODOの宣言scopeに入るか**を見ればよい。checkpoint findingとまったく同じ
述語である。

ADR 0140 Decision 3は「I/O検知はやらない」と述べた。本ADRはそれをworktree**内**の早期警報について
狭く上書きする。worktree**外**（`/tmp`、home、ネットワーク）は引き続き見えず、`write-coverage`の
発火条件つき保留のまま残す。

## Decision

### 1. I/Oイベントをfindingにしない

findingの契約はcheckpoint digestを3箇所で必須にしており、それはfindingが「事後に再読して再導出
できる主張」であることを担保している。fs eventは取りこぼす（FSEventsのcoalesce、inotifyのキュー
溢れ）し、事後再読もできない。

よってI/O検知が出すのは**早期警報**であり、判定の正本は今までどおりcheckpointとする。この非対称が
安全性の根拠になる——警報は**何かを抑制することが無く、早める方向にしか働かない**。取りこぼしても、
従来と同じタイミング（完了時・hold時）で必ず捕まる。**保証を一切緩めずに遅延だけを縮める。**

### 2. 警報とcheckpoint findingの述語を同一にする

`coveredBy`を共有する。述語が分かれると「警報は出たがcheckpointでは競合にならない」種類のずれが
生まれ、どちらが正しいのか誰にも分からなくなる。

### 3. 警報だけで止めず、probeを挟む

警報だけで止めると、書いて消したtempでも全workerを止めてしまう。かといって警報をfindingへ昇格
させることもできない（Decision 1）。

そこで警報を受けたら無停止で`captureWorktreeDiff`をprobeとして撮り、当該pathが**残っていれば**
実在、消えていればtransientとする。probeが撮ったcheckpointはgitから読んだ本物のdiffなので、
そのままfindingの証拠になる——契約を1つも緩めずに済む。

重なりの主張は両者のdiffに残っていることを要件とし、scope警報は自分1人の話なので自分のdiffだけで
足りる。checkpointを撮れていないTODOは書き手と数えない——観測できていないことを「書いていない」へも
「書いた」へも丸めない。

### 4. 帰属はworktree rootだけで決める。だから1対1でない構成では観測しない

sentinelはプロセス帰属を持たない。書き込みの帰属はrootが決める。この単純さは、worktreeとTODOが
1対1である限り正しい。

**複数TODOが同じrootを共有する構成では成立しない。** 1件の書き込みが全watcherへ配られ、誰が書いたか
観測から言えない。無実のTODOへ「他人のscopeへ書いた」と主張することになる。probeも助けにならない
——同じ木を2回読むので、両方が書いたように見える。

よってrootを共有して走っているTODOは監視しない。共有rootでも走っているのが1つなら帰属は立つので
見る。escalation側にも同じ確認を置く。**見えないものを見えるふりにしない。**

この制約は早期警報に閉じない。並列workerが別々の木で作業し、実際に触った資源の観測から競合を
捕まえるのが装置の中核である。よって管理daemonのdispatchはTODOごとに実worktreeを切る。supervisorが
**dispatchの前に**木を用意して監視を張る——応答を待つと、応答の中で書き込みが終わっている構成では
観測対象のイベントが一度も起きない。

### 5. escalationは新しい停止経路を作らない

probeが実在と裁定したら、daemon自身が、hostが叩くのとまったく同じ
`finding_record`→`conflict`→`hold`をcontrol requestとして発行する。findingの再導出も、epoch束縛も、
durable evidenceの照合も、既存handlerがそのまま行う。**早期警報が短くするのは気づくまでの時間
だけで、通す関門は1つも減らない。**

途中で断られたらそこで止め、理由をcontrol journal（`io_escalation_decided`）へ残す。静かに別経路へ
逃げない。

### 6. probeのcheckpointを、receipt裁定のbinding基準にしない

receipt裁定は「receipt直前の最後の観測checkpoint」との一致を要求する。executorの自己申告をbinding
証拠にしないための規則である。

probeはexecutorの申告境界ではなく、supervisorが選んだ走行中の一点である。その後も書き続けた
executorのreceiptと一致しないのが正常であり、混ぜると正当なreceiptが`checkpoint_mismatch`で落ちる。
由来を印として残し、engineとverifierの双方でbinding基準から外す。証拠としてはeventに残り、findingの
導出には使われ続ける。

### 7. workerはdispatchで作業を終えない

dispatchの中で作業を終えてterminalを返すと、走行中のTODOが1つも存在しないrunになり、実行時の観測が
原理的に成立しない。dispatchは作業を起こして返り、完了はobserveが拾う。barrierは静止の宣言なので、
ackを返す前にsettleを待つ——走行中の作業を残したままackすると、止まったと言いながらworktreeが動き
続ける。

### 8. escalationはepoch駆動の安全点で捌く

epoch駆動はrun eventsをメモリに抱えたままawaitをまたぎ、節目ごとに全体を置換する。
その最中に横から追記すると次の置換で消えるので、**lockを取れるようにするだけでは静かに
記録を失う**。駆動中の警報は積むだけにし、駆動側が`replaceEventsAtomically`の直後——diskと
メモリのeventsが一致している唯一の点——で捌く。そこはworkerがまだ走っている最中でもある。

### 9. 静止を証明できない構成では、freezeさせない

holdは静止の証明を要求する。直接OS観測はexecutorのprocessが実際に停止していることまで
確かめるが、**executorがcontroller自身のprocessである構成では証明できない**——止めると制御
そのものが止まり、止めなければ証明できない。

`conflict`はintakeをfreezeするので、freezeが掛かってholdが通らない状態を作ると、runは進むことも
畳むこともできなくなる（`abandon`も同じ静止証明を要求する）。よって**証明できないと分かって
いる構成では、conflictの手前で止める**。freezeできるのにあえてしない——止まれない状態を作る方が
危険だからである。理由はcontrol journalへ残す。判定は従来どおりcheckpointが担う。

## Consequences

- 早期警報は**実runで発火する**ようになった（[受入証拠](../evidence/2026-07-28-io-sentinel-live-run.md)）。
  一時fileに対しては`transient`、宣言scope外の実書き込みに対しては`observed`と裁定される。
- **警報からholdまでは、まだ通らない。** epoch駆動からの切り離しは済み、走行中のworkerに対して
  `finding_record`→`conflict`→`intake_frozen`まで実runで到達することは確認した。残るのは静止の
  証明であり、**executorを別processにするまで埋まらない**（Decision 9）。scripted controllerが
  TODOごとに子processを起こし、supervisorがそれを停止する形になる。dispatch応答がworkerのpidを
  運ぶ必要があるので、契約の版上げを伴う。したがって**検出遅延の実測も未了**である。
- runはユーザーのtreeを直接書き換えなくなった。workerの成果は`<runDir>/worktrees/`の中にあり、
  `close`では畳まない（木そのものがrunの成果である）。`abandon`は成果を捨てる決定なので畳む。
- `LATTICE_IO_SENTINEL=off`で警報を完全に無効化できる。無効でもrunの判定は従来どおり成立する。

## 学んだこと

**「観測できなかった」を正常系の値に持つ機能は、成功した観測を一度は要求するtestが無いと、
壊れていることが構造的に見えない。** 実際、probeは`captureWorktreeDiff`のimport漏れにより実装以来
一度も動いておらず、常に`unprobed`を返していた。広すぎる`.catch(() => null)`が`ReferenceError`ごと
握り潰し、syntax checkもlintも1080件のtestも緑のままだった。再発は受入条件側で塞ぐ——実runで
probeが実在を裁定することを統合testが要求する。
