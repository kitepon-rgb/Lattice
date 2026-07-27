# ADR 0139 — 自分のworktree内のcommitを許し、観測をbaseからの前進として読む

- Status: Accepted
- Date: 2026-07-27
- Relates: [ADR 0044](0044-rc3-runtime-contract.md)（隔離worktree executorと禁止操作）・
  [ADR 0064](0064-runtime-hold-public-bridge.md)（hold／carry-over／再計画）

## Context

runtime engineはworkerへ`forbidden_operations`として`commit`を配り、diff observerは
worktree HEADが`base_sha`から動いていたらfail loudしていた。実効機構はHEAD drift検査であり、
**観測モデルが「成果は未commit」を前提にしていた**。

この前提が実害を生んでいる。`recompileNextEpochPlan`は後継planへ`base_sha: plan.base_sha`を渡し、
**baseを前進させない**。carry-overで走り続ける作業が隔離worktreeへ変更を積んでいる間に他の工程を
再計画すると、その再計画は**進行中の変更を含まないsource**に対して行われる。
`carry_over_witness`が非重複を証明するので安全ではあるが、閉ループの前提——作業後のソースで
影響範囲を再推定する——が半分崩れている。witnessが縛るのは入力側のdigestだけで、
**生み出した木そのものは縛れていない**。

公開契約が禁じているのは「canonical branch、commit、外部effect、H操作を承認なしに行うこと」で、
懸念しているのは外向きの効果である。ところが`forbidden_operations`はどこへのcommitかを区別せず
全部禁じており、契約の懸念より広い。

## Decision

### 1. 自分の隔離worktree内のcommitを許す

`forbidden_operations`から`commit`を外す。detached HEADへ進めるcommitはcanonical branchを動かさず、
外部へ効果を出さない。一方で進行中の成果を耐久化し、diffを取れる形にする。

禁止のまま残すのは`push`／`branch`／`merge`／`rebase`／`reset`／`stash`である。
外部へ効果を出す操作と、HEADをbaseの子孫から外す操作である。

### 2. 観測は「baseからの前進」として読む

diff observerは、HEADが`base_sha`と異なる場合に**baseの子孫であること**を確かめる。子孫なら
`base..HEAD`の範囲を観測へ加え、未commitの変更と合わせて1つのdiffにする。子孫でなければ
——reset、branch切替、rebase——観測の前提が壊れるのでfail loudする。

commit済みの変更は`git status`へ出ない。範囲を加えないと、**commitした瞬間に変更が観測から消える**。
scope violationも実行時競合も、消えた変更については検出できない。

TOCTOU検査は「観測開始時のHEADと一致すること」へ変える。`base_sha`との一致を求めると、
許したはずのcommitを観測中の移動として弾いてしまう。

### 3. 記録は生み出した木を縛る（`lattice.checkpoint_diff.v2`）

diff recordへ`head_sha`を足す。入力側のdigestだけでは、進行中の成果がどの状態だったかを
後から指せない。木を指すshaがあれば、carry-over witnessも後継planのbaseも、そこへ縛れる。

## Consequences

**請求項7が要求する「他方の作業による変更を版管理システムへコミットさせる」の前提が整った。**
停止と再開は既に実装されており、欠けていたのは確定の手段である。

diff observerの検査は緩んでいない。禁じる対象が「HEADが動くこと」から「HEADがbaseの子孫から
外れること」へ変わっただけで、隔離の保証——本repositoryを触らない、宣言scope外の変更を検出する
——はそのままである。

## Open questions

1. **後継planのbaseを前進させる配線。** 本ADRはcommitを可能にし木を記録へ縛るところまでで、
   `recompileNextEpochPlan`が`head_sha`を新しいbaseとして採る配線は行っていない。
   採るべきは受理済みcheckpointのheadか、carry-over witnessが指すheadかを裁定する必要がある。
2. **canonical branchへの着地。** worktree内commitはcanonical branchへ出ない。出す段は
   引き続き承認を要する操作であり、本ADRは触れていない。
