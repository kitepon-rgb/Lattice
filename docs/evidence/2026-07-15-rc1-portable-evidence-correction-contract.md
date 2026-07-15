# RC1-D2／E2 portable evidence correction contract

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v3`
- Decision: [ADR 0012](../adr/0012-portable-codegraph-evidence-and-rc1-v3.md)
- probe: `research/campaigns/rc1/evidence/codegraph-portability-probe.json`
- classification: D2／E2ともF。public artifact digest意味、predecessor chain、version barrierを親が直接裁定する。

## Reproduced defect

control base `d2d4128…`へaccepted patch `acefad45…`を適用した2つのfresh treatment worktreeで、Codegraph 1.4.1は
18 files、214 nodes、845 edges、pending 0、mismatchなしを同じく返した。raw outcome集合digestは不一致、ADR 0012の
portable projectionは一致した。canonical HEAD／statusと既存worktree集合は前後不変、一時indexはcleanup済みである。

## Source boundary preflight

Codegraph 1.4.1、index complete、19 files、302 nodes、1191 edges、pending changes／refs 0、mismatchなしで確認した。

| owned／planned symbol | caller | callee | impact | affected test／unknown |
|---|---|---|---|---|
| `graphRecords` | `compileManifest` | `digestArtifact` | `compileControlArtifacts`まで3 nodes | `test/control-compiler.test.mjs` |
| `collectCodegraphEvidence` | adapter test、control integration | `collectOne` | 同2 testまで3 nodes | `test/codegraph-adapter.test.mjs` |
| `assertControlCompilationEvidence` | `assertCandidateInputs` | exact record／artifact／SHA validators | `runRc1SeamTreatment`まで3 nodes | `test/seam-transform.test.mjs` |
| planned `portableCodegraphOutcome` | 未存在 | 未存在 | 未観測 | `new_surface_unknown` |
| planned `compileTreatmentArtifacts` | 未存在 | 未存在 | 未観測 | `new_surface_unknown` |

`affected src/control-compiler.mjs`、`src/codegraph-adapter.mjs`、`src/seam-transform.mjs`はそれぞれ対応unit testを返した。
空結果は依存なしへ丸めず、planned surface unknownとして保持する。

## RC1-D2

write scopeは`src/codegraph-adapter.mjs`、`test/codegraph-adapter.test.mjs`、`src/control-compiler.mjs`、
`test/control-compiler.test.mjs`、`test/integration/control-portability.integration.mjs`と`artifacts/control-v2/`に限定する。

- raw outcomeを変異させないpure `portableCodegraphOutcome`を実装する。
- statusの4 telemetry fieldとnested node `updatedAt`だけを除き、unknown fieldを保持する。
- `graphRecords`をportable digestへ切り替え、raw telemetry差だけではmanifest digestが変わらないことをunit testする。
- 2 fresh worktreeでcontrol compileを行い、normal／shared-state negative artifactがbyte-identicalになることをrelated testする。
- control compilation evidence v2へprojection ID、raw digest不一致、portable digest一致、input／artifact digestをbindする。

## RC1-E2

write scopeは`src/seam-transform.mjs`、`test/seam-transform.test.mjs`、
`test/integration/seam-transform.integration.mjs`と`artifacts/treatment-v2/`に限定する。

- control compilation evidence v2だけをadmitし、projection IDとcontrol-v2 digest chainを検証する。
- accepted transformを同じcontrol baseで再実行し、旧control digestを持つartifactをrejectする。
- deterministic repeat、scope rejection、behavior rejection、negative admission拒否を既存gateと同じ粒度で再確認する。

## RC1-F handoff

D2／E2が不変ADRでacceptされるまでtreatment compiler／runnerを実装しない。Fはpure compileとisolated index runnerを分け、
source patch／Codegraph sensor state／compiled artifactのsnapshotを混同しない。同じquery set、normal manual evidence、negative manual
evidence、capacity 2を使い、plan v2と`lattice.plan_diff.v1`を生成する。

## Verification and non-goals

- implementation中は変更契約に直結するfocused testだけを実行する。
- D2／E2の各TODO完了候補で関連testを一回、full `npm run ci`はRC1-Gで一回だけ実行する。
- old artifactを削除／上書きしない。schemaを緩めて旧artifactを新predecessorへ昇格させない。
- Codegraph package／global install／`node_modules`、dotagents、Observer関連repoを編集しない。
- remote作成、push、publish、credential／login、external serviceを使わない。
