# RC1 v5 Phase gate証拠

- 日付: 2026-07-16
- 対象plan: `lattice-research-campaign-1-v5` / RC1-R
- 対象Control: `lattice-rc1-closed-loop-v3`
- 対象HEAD: `88d0654aa55c8c3c8354a50c5a46d9b4f3d49598`
- Decision: [ADR 0028](../adr/0028-rc1-v5-phase-gate-rejection.md)
- immutable mechanism record: [ADR 0027](../adr/0027-rc1-v5-immutable-closed-loop-accepted.md)

## Scopeとwriter境界

RC1-RはPhase完了時の重い監査として、full CI一回、独立refuter、独立Critic、親の再封印実験、Phase裁定を実施した。
Latticeだけをwriter scopeとし、dotagentsはorchestrate CLI／契約のread-only利用、Observer関連repoはread-only境界を維持して編集していない。
remote作成、push、publish、credential／loginは行っていない。

## Full CI

`npm run ci`をHEAD `88d0654`で一回実行した。test段階は`90 tests / 87 pass / 3 fail / 0 skip`で、test failureのため
`npm run check`には進まなかった。失敗は次の3件である。

1. `test/integration/control-portability.integration.mjs`: canonical repo全体の`git worktree list --porcelain`を実行前後で
   exact比較し、同時実行中の別integrationが所有する`lattice-isolated-transform-*`を漏れと誤認した。
2. `test/integration/treatment-recompile.integration.mjs`: clone内worktreeは正しくcleanupしたが、同じcanonical repo全体の
   worktree集合assertionが別testのtemporary worktreeと競合した。
3. `test/integration/rc1-v4-campaign.integration.mjs`: committed immutable `research/campaigns/rc1/artifacts/v4`が存在する
   canonical repoへ`writeRc1V4Artifacts`を再実行し、正規の上書き拒否でfailした。

失敗後、canonical statusはcleanで、worktreeはcanonical、`/private/tmp/lattice-rc1-codegraph-adapter`、
`/private/tmp/lattice-rc1-isolation-runner`の既存3件だけだった。temporary worktree leakはない。

### Failure-scope characterization

full suiteを再実行せず、3 scopeを直列に一回ずつ実行した。

| scope | 結果 | 意味 |
|---|---|---|
| `node --test test/integration/control-portability.integration.mjs` | 1 pass／0 fail／0 skip、約4.07秒 | 単独green、並列resource ownership欠陥 |
| `node --test test/integration/treatment-recompile.integration.mjs` | 1 pass／0 fail／0 skip、約4.95秒 | 単独green、並列resource ownership欠陥 |
| `node --test test/integration/rc1-v4-campaign.integration.mjs` | 0 pass／1 fail／0 skip、約16.86秒 | immutable root再発行を単独再現 |

test修正前のCodegraphは1.4.1、46 files、1,036 nodes、3,952 edges、pending 0、state completeだった。
3 test fileのfile node、`compileInFreshWorktree`、`writeRc1V4Artifacts`、`runRc1TreatmentRecompile`のcaller／callee／impactを確認した。
`codegraph affected`は3 changed test fileに`affectedTests: []`を返したが、changed file自身がtestであり、repo-global Git side effectと
Node test並列scheduleはgraph未表現のmanual unknownとして残した。空結果を依存なしへ丸めていない。

## Independent audits

Control revision 127から次のstrict Worker Reportを順にimportし、revision 128／129でcompleted、親裁定によりrevision 130／131で
acceptedにした。両workerはLatticeのPacket allowlistだけをread-only inspectionし、changed pathは0だった。

| lane | run | result digest | 主なfinding |
|---|---|---|---|
| refuter | `RC1-R-behavior-refutation-run-01-v5` | `1a61240589c41ceee129395ba8e9abb9796ea37682b59f706c336797ca967038` | oracle／case、snapshot、plan predecessorのP1 |
| Critic | `RC1-R-behavior-critic-run-01-v5` | `035b753be64371f5244ec94f9345f640a280bc7287ffdf149cfb6635be438e8d` | oracle／case、snapshotを再確認。Codegraph／runtime identityを追加 |

採用したのは実コードの非識別経路だけであり、前例不足、複雑さ、価値、新規性、read-only縮小、worth-it判断はfindingにしていない。

## Parent reproduction

親はcanonical v5 manifestと32 payloadをmemoryへ読み、tracked fileを変更せず次の2 corruptionを作った。

1. pre／post両receiptの`oracle_digest`を保存oracleと無関係な`aa…aa`へ変更。
2. pre／post先頭caseの`observed_digest`を`expected_digest`と異なる`bb…bb`へ変更し、`outcome=passed`を保持。

各caseでreceipt、behavior envelope、transform receipt、plan diff、comparison、hypothesis evaluation、execution evidence、
manifest result、全payload byte hashを依存順に再計算した。実行結果は次である。

~~~json
{
  "baseline_valid": true,
  "substituted_oracle_chain_valid": true,
  "false_passed_case_chain_valid": true,
  "substituted_oracle_failed_conditions": [],
  "false_passed_case_failed_conditions": []
}
~~~

再現scriptのSHA-256は`e3459c522cca47eb9e5ac387b23b31697dfbea9de5c349e81fdf167a4d510608`で、Control acceptance evidenceとして
Latticeの`.git/dotagents/orchestrate/rc1-r-reproduce-v5.mjs`へ保存した。これはtracked evidenceの代用ではなく、本書へ実験条件と
結果を還流するための一時Control artifactである。

## Finding adjudication

| ID | 判定 | 根拠 | Phase impact |
|---|---|---|---|
| REF-01／CRT-01 oracle digest・case semantics | 採用 P1 | 全依存再封印後もfull verifierがtrue | H0-cを排除不能 |
| REF-03／CRT-02 snapshot preimage | 採用 P1 | run digestは形式検査後compilerへ自己注入、bundleにpreimageなし | H0-bを排除不能 |
| REF-04 plan predecessor | 採用 P1 | 成功条件13に対しplan diffはv4文字列ref＋transform blockだけ | version barrier未充足 |
| CRT-03 Codegraph identity | 採用 correction | canonicalは全run 1.4.1だがcross-condition predicateなし | current値は反証せず将来driftを未排除 |
| CRT-04 runtime identity | 採用 correction | Worker execArgv継承事故を実runで観測、receiptにruntimeなし | current成功runは反証せず再現性不足 |

棄却した懸念は、oracleがproduction exportを直接実行しない、transformがfixed surface外を変更する、ESM cacheでpostを再利用する、
timestamp／絶対pathがbehavior差を作る、negative controlが消える、cleanupを実行しない、署名がないため無価値、である。
保存source、artifact、testから具体的経路が成立しないか、cooperative threat model外だった。

## Phase verdict

v5のclosed-loop mechanism evidenceは保持するが、H1-v5のPhase-level supportは`refuted_by_non_identifiable_artifact_chain`とする。
v5 artifactは上書きせず、active planをv6へ全再compileする。v6はoracle semantic case、runtime、snapshot preimage、Codegraph identity、
raw evidence、transform output、digest付きpredecessorを保存bytesから再計算する。

未検証をgreenへ丸めない。v6 correction、immutable v6 artifact、corrected full CI、v6 Phase反証は未実施である。
