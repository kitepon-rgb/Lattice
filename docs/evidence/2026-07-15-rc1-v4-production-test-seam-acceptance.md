# RC1-J production＋test seam acceptance evidence

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v4` / RC1-J
- Control: `lattice-rc1-closed-loop-v3` / `RC1-J-production-test-seam-v4`
- predecessor: [ADR 0017](../adr/0017-rc1-v4-identifiability-safety-net.md)、[ADR 0018](../adr/0018-rc1-v4-single-compiler-accepted.md)
- Decision: [ADR 0019](../adr/0019-rc1-v4-production-test-seam-accepted.md)
- classification: F。transform外behavior oracleと隔離worktreeのwrite／accept境界を親が直轄した。

## Accepted result

`runRc1BlackBoxOracle`はversioned oracle v2をtransform source／transform-owned testsとは別のexecutorで実行し、正常2件、
validation failure 6件をportable receiptへする。return value、frozen状態、throw name／messageを比較し、expected／observedは
digestで残す。receipt本文へrepo絶対pathを入れず、oracle inputを変異しない。同じcurrent fixtureへの2実行はdeep equalだった。

`applyRc1V4Transform`はdisposable worktree内だけで次の6 fileを決定的に生成する。

| concern | production write | TODO-owned test write |
|---|---|---|
| channel policy | `research/fixtures/dispatch-record/src/dispatch-channel.mjs` / `selectDispatchChannel` | `test/research-dispatch-channel.test.mjs` / `channelPolicyContract` |
| label policy | `research/fixtures/dispatch-record/src/dispatch-label.mjs` / `formatDispatchLabel` | `test/research-dispatch-label.test.mjs` / `labelPolicyContract` |
| stable composition | `research/fixtures/dispatch-record/src/dispatch-record.mjs` / `buildDispatchRecord` | `test/research-dispatch-record.test.mjs` / public shape＋frozen contract |

shared composition testは`pager`、`queue`、具体labelを期待値に持たず、policy-specific expected valueの共同write先ではない。
exact behaviorはtransform scope外oracle、concern別policyはTODO-owned testsが担う。

`runRc1V4SeamTransform`は同じdetached worktreeでoracleを変換前後に実行し、その後に3 test fileのfixed verifierを実行する。
accepted resultはpublic `lattice.transform_artifact.v1`と`lattice.rc1.seam_transform_receipt.v4`へ、base SHA、control source
bindings、6-path scope、binary patch、output content digests、verification receipt、oracle digest、pre／post receipt、cleanupを
bindする。2つのfresh disposable worktreeでartifact、receipt、patchが一致し、canonical source HEAD／status／fixture contentと
worktree集合は不変だった。

次は全てtyped rejected artifactとなり、acceptedへ進まなかった。

- oracle input pathへのscope外write → `scope_violation`
- routine channelを壊すproduction変換 → `behavior_verification_failed`、post oracle `failed`
- `channelPolicyContract` test seam欠落 → `behavior_verification_failed`

caller所有のoracle／source bindingsはisolated execution前にsnapshotする。custom transformがclosure経由で元の
`sourceBindings`を変異しても、artifactとfixed-input digestは開始時snapshotへ拘束された。

## Codegraph before／after

test追加前のplanned exportsはquery `[]`、caller／callee／impactがexit 0の非JSON `Symbol not found`、affected tests `[]`だった。
test-first red追加後はmissing importだけを観測し、source ownerはまだunknownだった。実装後はCodegraph 1.4.1、34 files、632
nodes、2,462 edges、pending changes／refs 0、worktree mismatchなし、reindex recommendationなし。

| exported symbol | exact owner | callers | callees | impact nodes | affected tests |
|---|---|---:|---:|---:|---|
| `runRc1BlackBoxOracle` | `src/rc1-black-box-oracle.mjs` | 4 | 8 | 6 | oracle unit、v4 transform、H characterization |
| `runRc1V4SeamTransform` | `src/rc1-v4-transform.mjs` | 1 | 17 | 2 | v4 transform unit |
| `applyRc1V4Transform` | `src/rc1-v4-transform.mjs` | 1 | 1 | 2 | v4 transform unit |

generated production／test symbolsはcanonical repoではsource stringであり、実code ownerとしてindexされたとは扱わない。
`channelPolicyContract`、`labelPolicyContract`、2 policy modulesのexact owner／caller／impact／affectedは、RC1-Lのaccepted
transformを適用した隔離worktreeで同じquery setをfresh indexして初めて判定する。

## Gates

- test-first red: 2 test files、0 pass / 2 fail。planned oracle／transform moduleのESM import不在。
- first focused: 6 tests中5 pass / 1 fail。missing test seamをacceptせずthrowしたため、typed rejectionへ補正。
- focused correction: incomplete test seam reject 1 pass、fixed-input snapshot 1 pass。
- focused converged: oracle／transform 7 pass / 0 fail / 0 skip。
- related final: 上記7件＋H black-box characterization、8 pass / 0 fail / 0 skip。
- `git diff --check`: pass。
- full `npm run ci`: source収束後のRC1-Mへ集約したため未実行。

## Accepted identity

| path | SHA-256 |
|---|---|
| `src/rc1-black-box-oracle.mjs` | `1246c04842dae884a037b9253010450f7164ee86a56c5491fa3aa5a7f43e13d0` |
| `src/rc1-v4-transform.mjs` | `5915adde8ef0fd11d3632416402a76258aa46fdc63938669367c60617b4be63c` |
| `test/rc1-black-box-oracle.test.mjs` | `df7642a17cac4038139d0dd59f8e5c1095024c55c1916844ea76a55742a4d8d6` |
| `test/rc1-v4-transform.test.mjs` | `5068b784c263d9c2d495349db4a4b9957bdaeeade493346836345db9a4cf9a8c` |

## Parent audit and residual boundary

- lightweight auditで、missing test seamがacceptedにはならないもののtyped artifactにならない欠陥を再現し、
  `behavior_verification_failed`へ補正した。
- 同auditで、caller所有source bindingの変異が事前fixed-input digestとartifact sourceを乖離させる経路を塞いだ。
- accepted artifactへ進むには、6 exact changed paths、pre／post同一oracle green、fixed verifier green、patch／output、cleanup、
  source unchangedが全て必要である。
- Kが所有する既存ignored protected content fingerprintはまだ未実装であり、Jのsource invariantだけで完了扱いしない。
- actual v4 transform artifact、generated surfaceのfresh Codegraph index、single compiler treatment、H1-v4支持はRC1-L／Mまで未受理。
- canonical worktreeと既存detached 2 worktreeだけが残り、dotagents／Observer関連repoはread-only、remote作成、push、publishは
  行っていない。
