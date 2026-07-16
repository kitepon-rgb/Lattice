# RC2 bounded scheduler core implementation

- 日付: 2026-07-16
- Control: `lattice-rc2-bounded-graph-v1` revisions 23〜25
- Task: `RC2-C1-bounded-compiler-independent-verifier-v1`
- source commit: `7ade1feb4f1d0c79f6df8e49e4563a3367f2b499`
- governing Decision: ADR 0033

## Source identity

| path | SHA-256 |
|---|---|
| `src/schedulability-compiler-v2.mjs` | `e9e5cc87d5eca5f295292f51c0cbe417595441a296daefbcdd89eb4ab5c5fbcf` |
| `src/schedulability-verifier-v2.mjs` | `ad41f37df8a69c1da51b2e1eb6dd8ef643f214f7db1ce2948b51f492a4c89d0d` |

両moduleにimport文はなく、compilerとverifierはgraph validation、DAG validation、feasibility、minimum探索を別々に実装する。
v1／RC1 sourceとimmutable artifactは変更していない。

## Focused verification

`node --test test/rc2-schedulability-characterization.test.mjs`:

```text
tests: 18
pass: 18
fail: 0
skip: 0
```

compiler／verifierそれぞれの`node --check`と、source 2-pathのcached `git diff --check`もpassした。

fixture例への過学習を反証するため、4 TODOの全64 undirected conflict graph、ID順forward edgeからなる全64 DAG、capacity
1〜4の直積を、production実装を呼ばないbrute-force oracleへ照合した。

```text
cases: 16384
compiler_oracle_mismatches: 0
verifier_mismatches: 0
```

これは8-node全空間の証明ではないが、K3／single-edgeだけの特判、conflictのprecedence化、capacity無視、非canonical assignmentを
16,384 bounded casesで反証する。

## Codegraph preflight and postflight

characterization commit直後、`codegraph status --json`はcomplete／pending changes 0だったが、`codegraph files --json`に新test 2 filesが
存在しなかった。明示的な`codegraph sync .`は4 files／115 nodesを追加した。したがってstatusのgreen単独をindex coverageの証拠に
しない。

source前preflightでは、予定2 symbol／2 pathは未作成だった。

- query: empty。
- callers／callees／impact: symbol not found。
- affected: 0 tests／0 traversed。
- 解釈: typed bootstrap unknown。characterization test内のdynamic import定数をmanual affected-test witnessとした。

source追加後の明示syncは2 source files／44 nodesを追加した。indexはcomplete、61 files、1,445 nodes、5,561 edges、pending refs 0。

| symbol | owned | direct caller | direct callees | impact depth 3 | affected test |
|---|---|---|---:|---|---|
| `compileSchedulabilityGraphV2` | compiler `:271-303` | RC2 characterization | 6 | 2 nodes／1 edge | RC2 characterization |
| `verifySchedulabilityPlanV2` | verifier `:290-317` | RC2 characterization | 6 | 2 nodes／1 edge | RC2 characterization |

compilerのcalleesは`normalizeGraph`、`normalizeOptions`、`searchMinimum`、`pairwiseVerdicts`等、verifierのcalleesは
`verifierGraph`、`verifierOptions`、`inspectPlan`、`shorterSchedule`等であり、cross-callは0だった。

## Verification classification

- `focused`: syntax 2 pass、characterization 18 pass／0 fail、bounded exhaustive 16,384 pass／0 mismatch。
- `related`: affected test 1 fileを上記focused gateで実行済み。
- `full`: 未実行。RC2 Phase gateへ集約する。
- remote、push、publish、Lattice外write: 0。
