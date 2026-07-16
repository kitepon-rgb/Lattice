# RC2 provenance front-end／artifact validator core

- 日付: 2026-07-16
- Control: `lattice-rc2-bounded-graph-v1` revisions 32〜33
- Task: `RC2-C3-v2-artifact-front-end-implementation-v1`
- characterization commit: `16d09f5044f39b4fa31a4f386715f3f6bfd8a22f`
- source commit: `2044d8175ca4f7ff759c6cefbb32630be17358d5`
- Decision: ADR 0034

## Implemented contract

`src/boundary-observation-compiler-v2.mjs`は`lattice.boundary_observation_set.v2`をexact validationし、次を
`lattice.normalized_boundary_bundle.v2`へcanonicalizeする。

- Codegraphの構造観測とmanual candidate ownership witnessを別provenanceとして保持する。
- symbol／pathは`codegraph: ready`と`manual_candidate_spec: asserted`の両方がある時だけobservedにする。
- Codegraphの`symbol_absent | empty | unresolved | command_failure | invalid_json | stale | unsupported`をresource削除や
  independenceへ変えず、全owner TODOのtyped unknownへする。
- state／effectは`manual_state_effect: asserted`からobserved conflictを作り、dynamicは必ずtyped unknownにする。
- observed resourceの全unordered owner pairをresource単位のconflictへ展開する。`conflict_records`と
  `distinct_conflict_pairs`は後続campaignで別metricとして扱う。
- provenance envelopeをbundleに残し、schedulerへ渡すexact 6-field graphからはcandidate、fixture、path、oracle、expected wavesを除く。

`src/artifact-contracts-v2.mjs`はv1 validatorを変更せず、次を追加した。

- normalized graphのexact／canonical validation。
- resource／provenance／precedenceからbundleを再compileし、保存graphとdigestをexact比較するvalidation。
- 保存graphからpairwise conflict／precedence verdictを再導出する`boundary_verdict.v2` validation。
- `verifySchedulabilityPlanV2`へdirect planを渡し、独立minimum verificationが`verified`の時だけacceptする
  `plan_graph.v2` validation。

source SHA-256:

- `src/boundary-observation-compiler-v2.mjs`: `19c70ddc5d83d1a6f7773f86038ceb53fef1772f1e841a9d87f53fa4fdb2918e`
- `src/artifact-contracts-v2.mjs`: `90da08908bc5a643f1ffd392f2bdedda92cd59b784e2f78e061e0d713603786d`

## Codegraph boundary

source前に明示syncし、characterization fileの収載を`codegraph files`で確認した。planned 2 pathsは未収載、planned
5 exportsは未存在だった。planned pathsの`affectedTests: []`／`totalDependentsTraversed: 0`は依存なしではなくunknownとし、
`test/rc2-artifact-contracts-v2.test.mjs`のdynamic import constantsをmanual affected-test witnessにした。

source前lookupでは、未存在の`validateBoundaryVerdictV2`／`validatePlanGraphV2`がv1の近似名へfuzzy解決された。返却名とpathが
exact不一致のため全caller／callee／impact結果を棄却し、再発防止規則をAGENTS commit
`e5a7efc3be61ba826541857e864e9c3473d48445`へ固定した。

source後の明示sync結果:

```text
files: 64
nodes: 1522
edges: 5858
pending changes: 0
pending refs: 0
```

- 2 source pathsをexact収載し、5 exports全件がrequested nameとpathへexact一致した。
- `compileBoundaryObservationV2` callers: bundle validator、RC2 artifact characterization test。
- `validateNormalizedBoundaryBundleV2` callee: `compileBoundaryObservationV2`。
- `validatePlanGraphV2` callee: `verifySchedulabilityPlanV2`。
- affected test: `test/rc2-artifact-contracts-v2.test.mjs` 1件。
- post-source unknown: 0。

## Verification

```text
node --check src/boundary-observation-compiler-v2.mjs: pass
node --check src/artifact-contracts-v2.mjs: pass
node --test test/rc2-artifact-contracts-v2.test.mjs: 8 pass / 0 fail / 0 skip
git diff --check: pass
```

- `focused`: 8 pass／0 fail／0 skip。
- `related`: Codegraph affected testはfocusedと同じ1 fileだけなので、上記greenをTODO完了候補のrelated gateとして再利用した。
- `full`: 未実行。RC2 Phase gateへ集約する。
- RC1 v1／v6 source、artifact、ADR 0032〜0034の変更: 0。
- dotagents／Observer関連repo write、remote、push、publish: 0。
