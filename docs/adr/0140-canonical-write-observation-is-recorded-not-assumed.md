# ADR 0140 — worktree外への書き込みは、検査したことを記録する（未検査を無変更と読ませない）

- Status: Accepted
- Date: 2026-07-27
- Relates: [ADR 0044](0044-rc3-runtime-contract.md)（隔離worktree executor）・
  [ADR 0127](0127-todo-independence-projection.md)（未検査と検証済みを混ぜない）・
  [ADR 0139](0139-worktree-local-commit-is-permitted.md)（観測をbaseからの前進として読む）

## Context

請求項9は「実際に変更された資源の範囲を観測し、当該範囲が当該作業に対応する変更影響範囲**の外に
及ぶ場合**…実行時競合を検出する」と述べる。現在の観測は`captureWorktreeDiff`であり、worktree内は
`--ignored=matching`でgitignore対象まで漏らさず見る。しかし**worktreeの外はまったく映らない**。

実行経路ごとに保護が揃っていなかった。

| 経路 | 本repositoryの不変検査 |
|---|---|
| `runtime-worktree-executor.mjs` | あり（HEAD・status・refを前後比較） |
| `isolation-runner.mjs` | あり（fingerprint前後比較） |
| **`runtime-managed-supervisor.mjs`** | **なし** |

managed supervisorは**実hostのprocessを駆動する経路**である。そこだけ本repositoryへの書き込みが
無検査だった。しかも観測結果には「見ていない」という事実がどこにも残らないため、findingが空である
ことが「範囲外への書き込みが無かった」と読めてしまう。

## Decision

### 1. 本repositoryの不変を、実hostを駆動する経路でも検査する

observation bindingが`canonical_root`と`canonical_fingerprint_digest`を渡した場合、観測時に
指紋を取り直し、一致しなければfail closedにする。指紋はHEAD・作業ツリー状態（untracked／ignoredを
含む）・全refを畳んだものである。

対で渡すことを要求する。片方だけを受けると、照合していないのに「検査した」と読める記録が作れる。

### 2. 検査していないことを記録へ残す（`lattice.direct_worktree_fingerprint.v2`）

fingerprint recordへ`canonical_fingerprint_digest`を足す。渡されていなければ`null`であり、
これは**未検査**を意味する。無変更の主張ではない。

これはADR 0127がwitness宣言について定めた規律と同じである——**判定していないものを、競合が無いと
読ませない**。観測の空白を安全側の事実へ丸めない。

### 3. worktree外の一般的な書き込みは、この面では扱わない

`/tmp`、home、ネットワーク、他repositoryへの書き込みは依然として観測できない。これらを捕まえるには
I/O検知（FSEvents／inotify／FUSE／eBPF）かprocess sandboxが要る。

**Latticeはそれを実装しない。** 実dispatchの所有者はhostであり（公開契約）、workerはLatticeの
processの外に居る。Latticeが持てるのは、封じ込めの境界を**packetで宣言し、検査できる範囲を検査し、
検査していない範囲を記録する**ことまでである。

## Consequences

実hostを駆動する経路で、workerが本repositoryを書き換えたらfail closedになる。従来は素通りだった。

観測記録を読む側は、`canonical_fingerprint_digest`が`null`のとき「本repositoryは検査していない」と
読める。今までは区別できなかった。

worktree外の一般的な書き込みは引き続き見えない。これは速度の問題ではなく、checkpoint間隔を
詰めても永久に見えない。塞ぐならI/O検知かsandboxであり、後者はhostの持ち物である。

## Open questions

1. **packetによる封じ込め境界の宣言。** 現在`executor_packet`は`scope.writes`と
   `forbidden_operations`を配るが、「書いてよいのはこのworktreeの中だけ」という封じ込め境界を
   明示していない。hostが何を守るべきかを契約として述べる余地がある。
2. **他workerのworktreeへの書き込み。** worker Aがworker Bのworktreeへ書くと、Bのdiffに現れて
   **Bのscope violationとして誤帰属**する。帰属にはI/O水準の情報が要り、diffだけでは決まらない。
