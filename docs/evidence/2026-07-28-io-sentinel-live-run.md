# I/O sentinel: 実runで初めて発火した（2026-07-28）

`io-sentinel` planのst-004（worktree分離と実run発火）に対する受入証拠。
**検証したことと、まだ通っていないことを分けて書く。**

## 何が変わったか

| commit | 内容 |
|---|---|
| `8e82680` | workerをTODOごとの実worktreeへ分離し、監視をdispatch前に張る |
| `555f534` | probeが一度も動いていなかったのを直す（`captureWorktreeDiff`のimport漏れ） |
| `959cc4e` | workerを非同期に走らせ、走行中の観測を成立させる |

## 実runで観測したもの

`test/integration/io-sentinel-live-run.integration.mjs`。実daemon・実worktree・実gitで、
T1が`src/alpha.mjs`を、T2が`src/beta.mjs`を宣言し、**T2が宣言外の`src/alpha.mjs`へも書く**構成。

```
io_warning_observed   | io_scope_warning   | observed | src/alpha.mjs
io_warning_observed   | io_overlap_warning | observed | src/alpha.mjs   todo_ids=[T1,T2]
io_escalation_decided | skipped | 観測したTODOが既にrunningでない
```

一時file（`src/.alpha.mjs-<pid>.tmp`）に対しては**`transient`**と裁定された。書いて消したもので
workerを止めない、という二段構えが実runで働いている。

**走行中に観測した証拠は重なり警報そのものである。** 重なり警報は当該pathが「他の*running* TODOの
宣言scopeに入る」時にしか作られず、running集合はsentinelが監視中のTODOそのものである。監視は
TODOがterminalになった時点で外れるので、T1とT2を名指す警報は**両者が同時に走っている最中にしか
生成されない**。事後の観測では作れない。

一時fileの観測も実測では出るが、受入条件にはしていない——fs.watchの取りこぼしは仕様であり、
取りこぼしても判定はcheckpointが担うという設計どおりである。

## 検証したこと

- `npm test` 1081件 pass / 0 fail / 0 skip（macOS。実daemonを起こす統合testを含む）
- `npm run check` syntax 129 files pass
- 実run受入testを3回連続で緑（fs eventに依存する受入条件を外した後）
- workerの書き込みは各worktree内にとどまり、**canonical repoは触られない**
  （`src/alpha.mjs`が元の内容のまま、`git status --porcelain`が空）

## まだ通っていないこと

**警報からholdまでは実runで通っていない。**

epoch駆動からの切り離しは済んでいる。駆動中の警報は積むだけにし、駆動側が
`replaceEventsAtomically`の直後——diskとメモリのeventsが一致している唯一の点——で捌く形にした。
これで走行中のworkerに対して`finding_record`→`conflict`→`intake_frozen`まで実runで到達することを
確認している。

残るのは**静止の証明**である。直接OS観測はexecutorのprocessが実際に停止していることを要求するが、
scripted controllerは自分のprocessで作業するので、止めると制御そのものが止まる。`abandon`も同じ
証明を要求するため、freezeだけ掛かった状態のrunは進むことも畳むこともできない。

よって**証明できない構成ではconflictの手前で止める**（ADR 0143 Decision 9）。freezeできるのに
あえてしない——止まれない状態を作る方が危険だからである。理由はcontrol journalへ残る:

```
io_escalation_decided | rejected |
  executorがcontroller自身のprocessで走っており、静止を証明できない
  （停止すると制御も止まる）。freezeさせるとrunを畳めなくなるので進めない
```

埋めるにはexecutorを別processにする必要がある。dispatch応答がworkerのpidを運ぶので、契約の版上げを
伴う。したがって**検出遅延の実測も未了**である。holdまで通らない状態で測れるのは警報が出るまでの
時間だけであり、工程が求めている「早期検知から再開まで」ではない。

### 配線して見つけた実欠陥

holdへ実際に到達したことで、この経路で一度も実行されていなかった3件が露出した。

| 症状 | 原因 |
|---|---|
| `INVALID_RUNTIME_CONTROL_REQUEST` | control operationはartifact**全体**のdigestを要求するが、candidateの自己digestを渡していた |
| `barrier timeout` | barrierが作業の完走を待っていた。barrierは「いま静止せよ」であり、完走を待たせると止めたい時ほど止まらない |
| `observation binding不正` | binding に`process_children`が無い。この経路のholdが一度も走っていなかったので欠落が見えなかった |

## この証拠が主張しないこと

- Linuxでの動作。実daemon統合testはmacOSでのみ検証している
- 早期検知による遅延短縮量
- worktree外（`/tmp`、home、ネットワーク）への書き込みの検知（`write-coverage`の保留のまま）
