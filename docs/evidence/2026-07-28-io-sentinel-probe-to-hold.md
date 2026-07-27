# I/O sentinel: 警報からprobeを経て自動holdへ繋ぐ（2026-07-28）

`io-sentinel` planのst-001〜st-003に対する受入証拠。**検証したことと、検証できていないことを
分けて書く。**

## 入れたもの

| commit | 内容 |
|---|---|
| `52f37c7` | `io_escalation_decided` control event契約——escalationの成否を理由付きで残す |
| `e89ae5b` | probe——警報が実在の重なりだったかをcheckpointで確かめる |
| `aab00eb` | 帰属が立たないworktree rootを監視しない |
| `22b213b` | probeを通った警報をfinding candidateへ写す |
| `7707920` | daemonが警報からhold経路（`finding_record`→`conflict`→`hold`）を自分で駆動する |

新しい停止経路は作っていない。daemonはhostが叩くのとまったく同じcontrol requestを発行するので、
findingの再導出、epoch束縛、durable evidenceの照合はすべて既存handlerが行う。**早期警報が
短くするのは気づくまでの時間だけで、通す関門は1つも減らない。**

## 検証したこと

- `npm test` 1079件 pass / 0 fail / 0 skip（macOS。実daemonを起こす統合testを含む）
- `npm run check` syntax 128 files pass
- `test/integration/scripted-adapter-controller.integration.mjs` 単体でもpass——
  帰属guardを入れた後もscripted構成のactivate〜closeが従来どおり完走する
- probeの三値（`observed`／`transient`／未観測）を単体で固定。書いて消したtempで
  全workerを止めないこと、片側しか書いていない重なりを実在としないこと、checkpointを
  撮れていないTODOを書き手と数えないことを個別に押さえた
- **candidateがproducerと一致することを実測**。`buildIoEscalation`が返すcandidateを
  `detectCheckpointFindings`へ突き合わせ、kind・path・todo_ids集合が一致することをtestで固定した。
  ここが揃っていないとfinding_recordの再導出照合で落ちるので、写像の正しさの中心はこの1件である
- 監視の張り方を単体で固定。rootを共有して走っているTODOを監視しないこと、共有rootでも
  走っているのが1つなら見ること、走り続けているTODOのwatchを張り替えないこと

## 検証**できていない**こと

**警報からholdまでを実runで通していない。実行できる構成が存在しないためである。**

管理daemonが駆動するのはscripted controllerだけで、その構成は全TODOのbindingが同じrepo rootを
指す（`src/runtime-cli.mjs`のdispatch応答）。sentinelの帰属はrootだけで決まるので、
共有rootでは書き手を特定できない——よって`syncSentinelWatches`が監視を張らず、警報が発生しない。

加えて、scripted controllerは自分の宣言write以外を書かず、書き込みはdispatch応答の**前**に
完了する。したがって仮に監視を張っても、この構成では観測対象のイベントが起きない。

**つまりio-sentinelは、実装以来まだ一度も発火していない。** 今日まで実害が無かったのは警報が
拘束力を持たなかったからであり、設計が正しかったからではない。

## この証拠が主張しないこと

- Linuxでの動作。実daemon統合testはmacOSでのみ検証している
- 早期検知の遅延短縮量。実測は実行できる構成を得た後にしか意味を持たない
- worktree外（`/tmp`、home、ネットワーク）への書き込みの検知。`write-coverage`の保留のまま

## 次の一手

工程の次段を「実測」から**管理daemonのdispatchをworktree分離へ広げること**へ読み替えた。
理由は[docs/plan_backlog.md](../plan_backlog.md)の「実行時競合の早期警報（I/O sentinel）」節が持つ。
