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

`run activate`がepoch全体をlifecycle lockを握ったまま同期駆動するため、escalationがlockを
取れるのはactivate完了後である。その時点でworkerは既にterminalなので、probeが`observed`と
裁定しても、escalationは`skipped`（観測したTODOが既にrunningでない）で終わる。

これはescalationの不備ではなく、**epoch駆動がcontrol operationの中に閉じ込められている**ことの
帰結である。切り離しは管理runtimeの構造変更にあたるため、次の工程として独立させた。

したがって**検出遅延の実測もまだ行っていない**。holdまで通らない状態で測っても、測っているのは
警報が出るまでの時間だけであり、工程が求めている「早期検知から再開まで」ではない。

## この証拠が主張しないこと

- Linuxでの動作。実daemon統合testはmacOSでのみ検証している
- 早期検知による遅延短縮量
- worktree外（`/tmp`、home、ネットワーク）への書き込みの検知（`write-coverage`の保留のまま）
