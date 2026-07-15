# RC1 v6 immutable closed-loop evidence

- 日付: 2026-07-16
- plan version: `lattice-research-campaign-1-v6`
- TODO: RC1-X
- base SHA: `724d2fee8abb6219c4c5d3979c494ab1ca46b163`
- Decision: [ADR 0030](../adr/0030-rc1-v6-artifact-chain-trust-boundary.md)
- artifact root: `research/campaigns/rc1/artifacts/v6`

## 実行条件

- canonical workspaceは実行前clean、stash 0、`artifacts/v6` absent。
- 既存worktreeはcanonical、`/private/tmp/lattice-rc1-codegraph-adapter`、
  `/private/tmp/lattice-rc1-isolation-runner`の3件。実行後も同じ3件である。
- Codegraph 1.4.1、resolved executable digest
  `2195336610e4d5a571767e066f4224d3f0f6f81bf7e34b3be18e45e87b699ef7`。
- Node `v26.5.0`、Worker `exec_argv: []`、environment `{}`、oracle executor digest
  `4818dae903f85a1e53dc99893bb61745afb1201804d27c5168997866f2150220`。
- source変更は隔離worktreeだけで行い、control／treatmentのsource invariantはともにtrue。

最初の発行候補はmedia type契約欠陥により受入監査でrejectした。manifestの手補正やpayload流用は行わず、
[RC1-X0 correction](2026-07-16-rc1-v6-media-type-correction.md)を独立commitした後、候補全体を削除して新baseから4 runを再実行した。

## 2+2 reindexとcompile結果

| condition | normal verdict | write conflicts | test conflicts | state conflicts | unknowns | minimum waves |
|---|---|---:|---:|---:|---:|---:|
| control | `seam_candidate` | 3 | 1 | 0 | 0 | 2 |
| treatment | `parallel_ready` | 0 | 0 | 0 | 0 | 1 |
| control negative | `intentional_serial` | 3 | 1 | 1 | 0 | 2 |
| treatment negative | `intentional_serial` | 0 | 0 | 1 | 0 | 2 |

run descriptor digest:

- control-1: `b49d90ee574c896eb0549e1cc380d8fb93bb79dc7c1d261d7430e8590f1b840c`
- control-2: `95032daac2f7e97648f289a5ecb54457a8c452937438c272041a9c1b0a6f76ba`
- treatment-1: `8287cb797aa652282e0f4df63acd74839c777a8880212b36b2d7e64c05e9012a`
- treatment-2: `a698ccfa64d345149952a70233dc94f076b727f75684559c7669362119146d95`

control snapshotは`65a2831ec91fa761f4d063ace8a7f7e396cb21fb2e50bfce563d83ff0d6574bd`、treatment snapshotは
`72b48b2c919c3f3f855eeb44d6341e07b1568b6fc96c52bcc07d668b6d41c9d2`。条件間の差はaccepted production＋test seamだけである。

## Version barrierとimmutable artifact

- accepted transform: `4d686266917ae913db8e050da3113c3d28c705f950decb7717364fcc09254361`
- behavior envelope: `0933e897bf9261d7381fbe4c90977887f23b58bdcdff7cc3f755c65d877580a5`
- plan diff v3: `74bce5b5b8958ec7564001e93df68021a76ae4a9a4fd889901c3cb2e0190d34e`
- comparison v4: `4bdd010aaa28649aa7a0c5a87905e77453d4dc1f100d5ec970013251fe84b730`
- hypothesis evaluation v4／manifest result:
  `dd2a99ce959349de5087648780cbe829898de9246e0d53cd4b3a1fc9d9282b96`

plan diffはv5 rejected archive、ADR 0028、accepted transform、behavior envelope、4 evidence bundle descriptorのordered 8
predecessorを持つ。old plan `rc1-v6-control`は2 waves、新plan `rc1-v6-treatment`は1 waveであり、旧plan／agent context／partial patchを失効した。

artifact manifestは43 payloadを列挙する。v5 directoryは変更せず、v6を別directoryへatomic renameした。

## Disk verifier

canonical diskからmanifestとcompile-time exact path setを再読込し、次の12 checksが全てpassした。

```text
exact_artifact_set
identity_source_binding
input_identity
behavior_artifact_set
evidence_campaign
compiler_replay
transform_binding
plan_diff_binding
comparison_binding
hypothesis_evaluation
execution_evidence
result_binding
```

resultはvalid、failed conditions 0、hypothesis supported true。full `npm run ci`とPhase反証はRC1-Yで一回だけ行う。
