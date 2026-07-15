# ADR 0006: RC1のartifact・sensor・isolation基盤を受け入れる

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v2`
- 対象Control: `lattice-rc1-closed-loop-v3`

## Context

RC1-D以降のboundary compile、seam transformation、plan recompileは、次の3境界を共通前提にする。

1. artifactのbyte列、digest、schema rejectが再生成可能である。
2. Codegraphの空結果、非JSON、stale、failureを独立性へ丸めない。
3. transformがcanonical repoへ漏れず、検証したsnapshotと返却patchが同一である。

各moduleの単体greenだけではこの前提を受け入れられない。親検収では、実Codegraph 1.4.1のstatus shapeと
ANSI付き不在出力、ignored write、verifier mutation、source invariant違反を実行して反証した。

## Decision

次の3実装をRC1のfoundation contractとして受け入れる。

### RC1-A: artifact contract

- commit `c49a4bc`の`src/artifact-contracts.mjs`と`test/artifact-contracts.test.mjs`を受け入れる。
- canonical payloadはplain JSONだけを受け、UTF-8、object key lexical order、array order保持、末尾改行なしとする。
  SHA-256 digestはpayload外で計算し、自己参照digestをpayloadへ埋め込まない。
- `plan_input.v1`、`boundary_manifest.v1`、`boundary_verdict.v1`、`plan_graph.v1`、`plan_diff.v1`はRC1で使う
  exact subsetだけを受ける。conflict resourceとTODO access、seam後ownershipの非重複、edgeとwave順序、old-plan
  invalidation参照を論理不変条件にする。
- Codegraph statusの`absent`をmanifestへ接続し、operationごとに不可能なstatusを拒否する。

### RC1-B: Codegraph adapter

- commit `24c9541`の`src/codegraph-adapter.mjs`と`test/codegraph-adapter.test.mjs`を受け入れる。
- Codegraph 1.4.1の実status shapeを検査し、ready／absent／stale／unsupported／unresolvedを区別する。
- queryのJSON `[]`は`symbol_absent`、affected testの空配列は`empty`とし、どちらもindependenceを意味しない。
- `callers`／`callees`／`impact`の未存在symbolで観測したANSI付きexact info messageだけを
  `symbol_absent`へ変換し、近似messageや任意非JSONを`invalid_json`にする。
- 親live gateで固定query setを実行し、status、既存symbol、caller／callee／impactは`ready`、未作成seam symbolは
  `symbol_absent`、既存pathと未作成pathが混在するaffected結果は`unresolved`として保持できた。

### RC1-C: isolation runner

- commit `3fd1856`の`src/isolation-runner.mjs`と`test/isolation-runner.test.mjs`を受け入れる。
- detached disposable worktree、NUL-safe status、allowed path、symlink／submodule／特殊file拒否、untrackedを含む
  binary patch、shellなしverifier、cleanup、source HEAD／status不変を契約にする。
- ignored writeもscope検査へ含める。transform直後のchanged path＋patch snapshotを固定し、verifierまたはobserveが
  snapshotを変えた場合はrejectする。
- primary failure、cleanup failure、source invariant violationが同時発生した場合は、元failureを失わず複合errorで返す。

## Parent verification

- RC1-A focused: 6 pass／0 fail／0 skip。syntax 2件とdiff check成功。
- RC1-B focused: 6 pass／0 fail／0 skip。syntax 2件成功。実Codegraph live gate成功。
- RC1-C focused integration: 7 pass／0 fail／0 skip。syntax 2件成功。
- integration後のCodegraph: 13 files、154 nodes、603 edges、pending changes／refs 0、mismatchなし。3 public symbolの
  query／caller／callee／impactと各sourceのaffected testが`ready`。
- full `npm run ci`は同じPhase内の重複実行を避け、RC1-GのPhase gateへ集約する。

## Rework evidence

- RC1-Bは親live gateで2回差し戻した。1回目はstatusの実shape誤読、2回目はindex telemetry fieldとANSI info prefixの
  fixture欠落である。いずれもfakeだけでは検出できず、実CLIで再現した。
- RC1-Cは親adversarial runで2回差し戻した。ignored scope bypassとverified-state／patch不一致、続いてprimary
  failure時のsource invariant報告欠落を再現した。さらにWorker Report claims digest不一致を1回差し戻し、親は
  silent normalizeしなかった。

## Boundaries and residual unknowns

- canonical JSONはRC1固有契約であり、RFC 8785互換や他言語実装の互換性を主張しない。
- Codegraph adapterは1.4.1実shapeに固定する。公開shapeが変われば`unresolved`へ倒し、暗黙fallbackしない。
- cleanup自体の強制失敗、symlink／submodule／特殊fileの個別integration、process timeout／output上限は未検証である。
  RC1-Eの固定fixture transformに必要なacceptanceを満たすが、一般変換基盤の完成とは扱わない。
- dotagentsおよびObserver関連repoはread-onlyのまま維持し、本Decisionはそれらのwriter境界を変更しない。
