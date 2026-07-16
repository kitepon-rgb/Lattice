# ADR 0033: RC2 v2 compilerとminimum verifierを独立したbounded exact実装にする

- 状態: Accepted
- 日付: 2026-07-16
- 対象plan: `lattice-research-campaign-2-v1` / RC2-B、RC2-C
- 対象Control: `lattice-rc2-bounded-graph-v1` revision 21
- predecessor: ADR 0032
- evidence: [RC2 characterization safety net](../evidence/2026-07-16-rc2-characterization-safety-net.md)

## Context

RC1 v1は2 TODOに固定されたartifact／compilerであり、3 TODO verdictをrejectする。一方、v1 plan validatorはproducerが
`minimum_feasible_waves`と同数のwavesを自己申告すれば、single conflict edgeとisolated TODOを3 wavesへ過剰直列化したplanも
acceptする。RC2はv1を緩和せず、candidate／fixture／pathを見ない新しいnormalized graph coreを加算する必要がある。

producer自身の出力だけでfeasibilityとminimumを証明すると、同じscheduler欠陥が生成と検証へ共通原因として残る。RC2-Bの
test-first characterizationは、graph compiler 11ケースと、compilerを呼ばずdirect planを与えるindependent verifier 5ケースを
production実装前のexpected-redとして固定した。

## Decision

### Compiler contract

- 新入口を`src/schedulability-compiler-v2.mjs`のnamed export
  `compileSchedulabilityGraphV2(normalizedGraph, options?)`とする。v1 source／validator／artifactは変更しない。
- core inputはexactな`lattice.normalized_boundary_graph.v2`で、`todos`、undirected `conflicts`、directed
  `precedences`、`unknowns`、writer `capacity`だけを受ける。candidate ID、fixture path、repo path、transform adapter、oracle、
  expected wavesを入力へ入れない。
- TODO数は1〜8に限定する。9件以上は`outcome: unsupported`／`code: NODE_LIMIT_EXCEEDED`、探索予算枯渇は
  `outcome: unsupported`／`code: SEARCH_BUDGET_EXHAUSTED`を返し、planを発行しない。
- 一件でもboundary unknownがあれば`outcome: unknown`／`code: BOUNDARY_UNKNOWN`を返し、planを発行しない。
- bounded範囲ではwave数を1から増やして全割当を決定的に探索し、conflictは異wave、precedenceは厳密な前wave、各waveは
  capacity以下という別々の制約でminimumを求める。同じminimumに複数解があれば、辞書順にsortしたTODOのwave assignmentが
  lexicographically最小のplanを採る。
- 成功は`outcome: compiled`、canonicalなpairwise conflict／precedence verdicts、
  `schema_version: lattice.plan_graph.v2`のwaves、実際に求めた`minimum_feasible_waves`を返す。
- exact schemaに合わない入力、duplicate／dangling relation、self relation、invalid capacity／optionはfail loudlyとし、
  unsupportedやunknownへ丸めない。

### Independent verifier contract

- 検証入口を`src/schedulability-verifier-v2.mjs`のnamed export
  `verifySchedulabilityPlanV2(normalizedGraph, plan, options?)`とする。
- verifierはcompiler moduleをimport／callせず、その探索routineも再利用しない。validityとminimumを保存graphから独立に列挙する。
  producerのwaves数や`minimum_feasible_waves`を検証結果へコピーしない。
- verifierはまずplanのTODO完全被覆、重複／欠落、wave shape、capacity、conflict、precedenceを検査し、その後、提示wave数より
  短いfeasible割当の存在を独立探索する。
- feasibleかつminimumなら`outcome: verified`と再計算した`minimum_feasible_waves`を返す。validだが非最小なら
  `NON_MINIMUM_SCHEDULE`、conflict同居は`CONFLICT_COLOCATED`、hard precedence違反は`PRECEDENCE_VIOLATION`、
  capacity超過は`CAPACITY_EXCEEDED`で`outcome: rejected`にする。
- verifierのnode／search budgetもcompilerと同じbounded claimに従うが、実装と探索stateは独立に持つ。未完了・予算枯渇を
  verifiedへ丸めない。

### Characterization gate

production実装前の受入赤は、v1 2 pass、compiler 11件とverifier 5件の16 failである。16件すべてが予定した二つのmoduleの
`ERR_MODULE_NOT_FOUND`だけを原因とし、syntax／fixture／assertion failureはない。この状態を安全網commitとして固定してから、
source前Codegraph preflightを再実行し、実装を開始する。

## Rejected alternatives

- **v1 validatorを緩める:** immutable RC1 replayの意味を変え、2-TODO契約と3-TODO契約を混在させる。
- **compiler resultを同じmoduleで自己検証する:** producerとverifierに同じ欠陥が入り、minimum claimを識別できない。
- **producerの`minimum_feasible_waves`を信頼する:** characterizationで既に非最小3-wave planがacceptされる反例がある。
- **conflictを有向edgeとしてprecedenceへ統合する:** path graphを不要に3 wavesへし、undirected exclusionとhard needを混同する。
- **汎用最適化solverへ先に拡張する:** RC2の識別対象は8 nodes以下のbounded exact claimであり、外部solver依存は不要である。

## Consequences

- compilerとverifierの一致は同じ実装の再実行ではなく、二つの独立探索が同じminimumへ到達したevidenceになる。
- RC2 artifact verifierはproducer planの自己申告だけでsupportを発行できない。
- 実装重複は意図的である。後から共通scheduler helperへ抽出すると独立性を失うため、性能上の都合だけでは統合しない。
- 8 nodesを越える一般schedule、solver performance、arbitrary repo generalizationはRC2のclaimに含めない。

