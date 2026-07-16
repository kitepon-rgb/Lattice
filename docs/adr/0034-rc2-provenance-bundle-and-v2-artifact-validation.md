# ADR 0034: RC2 provenance bundleとv2 artifact validationをnormalized graph coreから分離する

- 状態: Accepted
- 日付: 2026-07-16
- 対象plan: `lattice-research-campaign-2-v1` / RC2-C
- 対象Control: `lattice-rc2-bounded-graph-v1` revision 31
- predecessor: ADR 0033
- evidence: [RC2 artifact／front-end characterization](../evidence/2026-07-16-rc2-artifact-front-end-characterization.md)

## Context

ADR 0033で固定した`lattice.normalized_boundary_graph.v2`は、fixture、candidate、repo path、oracleを見ずにscheduleを
compileするため、provenanceを意図的に持たない。しかしRC2のfront-endには、Codegraphの構造観測とmanual ownership witnessを
混同せず、空／失敗をindependenceへ丸めず、保存bundleからgraphを再導出できる契約が要る。

Codegraphはsymbol／pathの存在と構造関係を観測できるが、future TODOがそのsurfaceを所有するというsemantic ownershipを単独では
証明しない。candidate specはそのownershipを人手で設計したwitnessであり、自動発見結果ではない。両者を一つの無型resourceへ
潰すと、candidate specに答えを書いた自己成就と、Codegraphによる自動ownership discoveryを区別できなくなる。

RC2-Cのtest-first characterizationは、observed K3、input permutation、Codegraph empty、manual state partial conflictと、bundle、
verdict、planのcorruption rejectionをproduction実装前の8 expected-redとして固定した。

## Decision

### Observation inputとprovenance

- 新入口を`src/boundary-observation-compiler-v2.mjs`のnamed export
  `compileBoundaryObservationV2(observationSet)`とする。入力schemaは
  `lattice.boundary_observation_set.v2`で、snapshot、candidate witness、query set、manual evidenceのSHA-256 digest、capacity、
  TODO、resource、hard precedenceをexact shapeで受ける。
- resource kindは`symbol | path | state | effect | dynamic`とする。全resourceは`resource_id`、`target`、owner TODO集合、
  provenance集合を持つ。
- `symbol`／`path` ownershipをobservedとするには、`codegraph: ready`と
  `manual_candidate_spec: asserted`の両方を必須にする。Codegraphはsurfaceの構造証拠、manual candidate specはfuture ownership仮説の
  witnessであり、artifact上でも別provenanceとして保持する。
- `state`／`effect`をobservedとするには`manual_state_effect: asserted`を必須にする。hard precedenceは
  `manual_candidate_spec: asserted`を必須にする。必要なprovenanceの欠落、余分なshape、unknown source／statusはfail loudlyにする。
- `dynamic`は`manual_state_effect: asserted`を必須にするがobserved conflictへは変換せず、全owner TODOのtyped unknownを必ず導出する。
  動的境界の存在を知っていることと、write targetを解決できたことを同一視しない。
- Codegraph statusは`ready | symbol_absent | empty | unresolved | command_failure | invalid_json | stale | unsupported`を型として保存する。
  `ready`以外のresourceは削除せず`unknown` resourceとして保持し、その全owner TODOへtyped unknownを導出する。conflict 0や
  independenceへ変換しない。

### Normalizationとbundle

- observed resourceは、そのowner TODO集合の全unordered pairをresource単位のconflictへ導出する。一つのTODO pairが複数resourceを
  共有すればconflict recordも複数になり得る。campaign metricは`conflict_records`と`distinct_conflict_pairs`を別々に報告する。
- normalized resourceは入力のidentity／ownership／provenanceにderived `status: observed | unknown`だけを加える。
- outputは`lattice.normalized_boundary_bundle.v2`とし、canonicalな`source`、normalized `resources`、normalized
  `precedences`、exact 6-fieldの`graph`、`graph_digest`を持つ。graphはADR 0033のschemaからprovenance、candidate、path、oracle、
  expected wavesを増やさない。
- TODO、resource、owner TODO、provenance、precedence、conflict、unknownの入力順を正規化し、同じ意味の順列入力はbyte-equivalentな
  objectとdigestを返す。`graph_digest`はcanonical graph bytesのlowercase SHA-256とする。

### Artifact validation

- `src/artifact-contracts-v2.mjs`へ次のnamed exportを置き、v1 validatorを変更しない。
  - `validateNormalizedBoundaryGraphV2(graph)`
  - `validateNormalizedBoundaryBundleV2(bundle)`
  - `validateBoundaryVerdictV2(verdict, graph)`
  - `validatePlanGraphV2(plan, graph, options?)`
- bundle validatorは保存`graph_digest`の一致だけを信じない。resource／provenance／precedenceからcanonical graphを再導出し、保存graphとの
  exact一致と再計算digestを検査する。provenance corruption、graph corruption、digest corruptionのどれもrejectする。
- `lattice.boundary_verdict.v2`は`normalized_graph_digest`とcanonical pairwise verdict集合を持つ。validatorは保存graphからexpected
  conflict／precedence verdictを再導出し、欠落、余分、変更、wrong digestをrejectする。
- plan validatorはproducerの`minimum_feasible_waves`自己申告を信じず、ADR 0033の独立
  `verifySchedulabilityPlanV2`へ保存graphとplanを渡す。`outcome: verified`かつ独立再計算minimumが一致する時だけ`true`にする。
- validatorはuntrusted artifactに対してbooleanを返す。front-end compilerはinvalid observation inputを例外でfail loudlyにし、
  unknown／unsupportedをobservedやvalidへ丸めない。

## Rejected alternatives

- **provenanceをnormalized graphへ埋める:** generic schedulerへfixture／evidence関心を逆流させ、同型graphの再利用性を壊す。
- **candidate specをCodegraph evidenceと呼ぶ:** semantic ownershipのmanual witnessをmachine discoveryへ誤表示し、H0-cを識別不能にする。
- **Codegraphの空結果をresourceなしと扱う:** index不備、query失敗、未対応surfaceを偽のindependenceへ変える。
- **保存graphとdigestだけを照合する:** producerがgraphとdigestを同時に改変したcorruptionを検出できない。
- **plan schemaの自己整合だけを検査する:** non-minimum scheduleをproducerの自己申告でacceptするRC1 v1の欠陥を再導入する。

## Consequences

- provenance envelopeとschedule coreの責務が分かれ、同じgraph coreをRC1 transferとRC2 fixtureへ適用できる。
- RC2はmanual ownership witnessからcompileしたことを主張できるが、requirementsからownershipを自動発見したとは主張しない。
- Codegraph failureはplan発行を止めるtyped unknownとして残り、空結果による偽parallelizationを防ぐ。
- bundle、verdict、planの各validatorは保存summary booleanではなくunderlying relationを再計算する。
- このADRを参照してC2 characterizationをfinalizeした後は、本pathを可変台帳として更新しない。
