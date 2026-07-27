# I/O sentinel: 警報からholdまでが実runで通った（2026-07-28）

`io-sentinel` planのst-004（worktree分離と実run発火）以降、同じ流れでexecutorのprocess分離まで
到達した記録。**検証したことと、この証拠が主張しないことを分けて書く。**

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

## 警報からholdまで通ること（実測）

worker 2並列、T2が宣言scope外の`src/alpha.mjs`——T1の宣言scope——へ書く構成。

```
io_escalation_decided | held | 早期警報からhold: io_scope_warning/src/alpha.mjs
run events: … checkpoint_observed, conflict_found, intake_frozen,
             checkpoint_observed ×2, hold_decided
control    : executor_quiesced ×2
```

| 段 | dispatchからの経過 |
|---|---|
| 実在警報（probeが`observed`と裁定） | **137 ms** |
| `intake_frozen` | **662 ms** |
| `hold_decided` | **663 ms** |
| （従来）worker完了まで | **8,000 ms** |

従来値は**workerの実行時間そのもの**であり、装置が決められない値だった。長い作業ほど差が開く。

これを成立させたのが**workerのprocess分離**である。holdの静止証明は「名指しされたprocessが
実際に停止していること」を要求するが、controller自身のprocessで作業していると、止めれば
応答できず止めなければ証明できない。workerを別processへ出し、`detached`で独立process groupへ
置き、barrierでSIGSTOPして止まった木を読む。**装置はprocessを止めない**——止めるのはexecutorの
責務で、Latticeが行うのは検証だけである。

### 配線して見つけた実欠陥

holdへ実際に到達したことで、この経路で一度も実行されていなかった不整合が露出した。

| 症状 | 原因 |
|---|---|
| `INVALID_RUNTIME_CONTROL_REQUEST` | control operationはartifact**全体**のdigestを要求するが、candidateの自己digestを渡していた |
| `barrier timeout` | barrierが作業の完走を待っていた。barrierは「いま静止せよ」であり、完走を待たせると止めたい時ほど止まらない |
| `observation binding不正` | bindingに`process_children`が無い |
| `processがquiescedでない` | executorがcontroller自身のprocessだった（構成として証明不能） |
| `直接再観測不一致` | attestationの形が違った。実際に流れているのは`direct_process_observation.v2`と`direct_worktree_fingerprint.v1` |

最後の1件は、**両側のdigestを出力させて初めて分かった**。読んでいたcodeと流れているものが
別だったので、推測で合わせようとした時間が最も長い。

## この証拠が主張しないこと

- Linuxでの動作。実daemon統合testはmacOSでのみ検証している
- 早期検知による遅延短縮量
- worktree外（`/tmp`、home、ネットワーク）への書き込みの検知（`write-coverage`の保留のまま）
