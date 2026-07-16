# ADR 0032: RC2はbounded graph compilerと3-way ownership seamを分離して実証する

- 状態: Accepted
- 日付: 2026-07-16
- 対象plan: `lattice-research-campaign-2-v1`
- predecessor: ADR 0031
- evidence: [RC2 plan reconsideration](../evidence/2026-07-16-rc2-plan-reconsideration.md)

## Context

ADR 0031は、固定2-TODO fixtureで境界観測、typed conflict、隔離seam変換、fresh reindex、negative control、
新plan versionへの全再compileという閉ループをsupportした。一方、現行実装にはRC1の識別範囲を越えると露出する境界がある。

- `compileBoundaryCondition`はTODO数2、writer capacity 2を固定する。
- `boundary_verdict.v1`は一verdictのTODO数をexactly 2に固定する。
- 現schedulerはconflictが一件でも全TODOをsingleton waveへ置く。
- `plan_graph.v1` validatorはconflictとprecedenceを同じ`from < to`で検査し、`minimum_feasible_waves`の最小性を再計算しない。
- candidate specがproposed ownershipを入力として持つため、compilerはownershipを発見したのではなく、明示されたwitnessから
  conflictとscheduleを導出している。
- RC1 v6 verifierはtrusted current RC1 compilerで保存artifactをreplayするため、その入口を汎用化名目で変更すると過去証拠を壊し得る。

K3、空graph、single edgeだけではTODO数やgraph shapeの特判でも期待値を通せる。また、既存2-TODO fixtureと新3-TODO
fixtureはfixture、arity、capacity、transform formが同時に変わるため、seam class一般化や自動ownership発見まで主張できない。

## Decision

### 1. RC1 v6を凍結し、v2を加算する

RC1 v6 artifact、plan、Decision、`boundary-compiler.mjs`、`artifact-contracts.mjs`、RC1 campaign／verifierを変更しない。
RC2は別module、別schema version、別artifact rootを使う。実装前後でv6 disk verifierの12 checksを再生し、同じsupportを保つ。
保存artifact内のcompiler bytesは実行せず、ADR 0030のtrust boundaryを維持する。

### 2. fixture front-endとnormalized graph coreを分ける

fixture front-endはCodegraph evidence、candidate spec、manual state／effect evidenceから、provenance付きnormalized boundary graphを作る。
generic coreはcandidate ID、fixture path、repo path、oracle、transform adapterを受け取らず、bounded node、typed precedence、unordered
conflict、unknown、capacityだけからpairwise verdictとscheduleをcompileする。

candidate specのproposed ownershipはmanual design witnessであり、自動発見結果ではない。artifactへprovenanceを固定し、RC2は
「要求からsemantic ownershipを自動発見した」と主張しない。

### 3. conflict、precedence、minimumを別契約にする

新しいexperimental `boundary_verdict.v2`はN件全体を一つのscalar verdictへ潰さず、pairwiseまたはcomponent単位の判定を保持する。
`plan_graph.v2`はprecedenceを`wave(from) < wave(to)`、conflictを`wave(a) != wave(b)`として別に検証する。

RC2のexact schedulingは最大8 TODOへboundする。producerのscheduleとは独立したenumerating verifierが、capacity、precedence、conflictから
feasibilityと「より少ないwaveが存在しない」を再計算する。上限外や探索budget超過を`minimum`へ丸めず、typed unsupported／unknownにする。

### 4. 3-way registry shardの主張範囲を限定する

Lattice内へ3 TODOが同じproduction symbol／pathとshared testを争うregistry fixtureを作る。fixture固有adapterは3-way shard patch、
allowed paths、black-box oracle、verification command、accepted output snapshotだけを所有する。compiled conflict、expected waves、
proposed ownershipをadapterからcoreへ注入させない。

このtransform formはRC1と異なるadapterを使うが、資源意味論としては同じproduction／test write ownership partitionである。
RC2は「別seam classの一般効果」を主張せず、3-way arityと部分競合topologyへの拡張だけを識別する。

### 5. topology特判をmetamorphic controlで殺す

K3、empty、single edge＋isolated nodeに加え、A-B-C path、capacityだけ3→2、hard need＋conflict、TODO順列、ID／resource rename、
第三TODOだけunknownを同じcoreへ通す。ID、path、arity、capacity、特定graph形状の分岐で二fixtureだけを通す実装を受け入れない。

## Rejected alternatives

- **v1 validatorを緩めて3 TODOへ流用する:** 過去artifactの意味論とdigest replayを可変にする。
- **K3→emptyとsingle-edgeだけでgeneric compilerを主張する:** shape特判を識別できない。
- **candidate specをownership discoveryの証拠にする:** input witnessへ答えを埋め込んだ自己成就になる。
- **registry shardを別seam classと呼ぶ:** current/proposedで変わるのは同じproduction／test ownership classである。
- **fixture adapterへexpected scheduleを持たせる:** compilerの結果をfixture scriptが決める。
- **大規模graphの最適性まで一度に扱う:** bounded exact claimと大規模heuristicを混同する。後者は別versionで扱う。
- **Observerを二つ目のfixtureにする:** 並行writerと外部変動を実験へ混入する。

## Consequences

- RC2がsupportできるのは、二つのbounded exemplarと複数metamorphic topologyを同一normalized graph coreがcompileし、
  新3-TODO fixtureでseam有無の因果差を閉ループ再現した、という限定主張である。
- ownership discovery、state／effect seam class、任意repo成功率、large-N optimizer、actual multi-agent速度改善は後続研究になる。
- experimental v2 schemaを公開契約へ昇格するかはRC2 Phase gate後の新しい不変Decisionで裁定する。
- RC1 v6のsource入口とimmutable evidenceを保つため、RC2中のlegacy consolidation／renameは行わない。
