# RC1-E2 portable seam transform acceptance evidence

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v3` / RC1-E2
- Control: `lattice-rc1-closed-loop-v3` / `RC1-E2-portable-transform-v3`
- Contract: [portable evidence correction](2026-07-15-rc1-portable-evidence-correction-contract.md)
- Decision: [ADR 0014](../adr/0014-rc1-portable-seam-treatment-accepted.md)
- classification: F。version barrierとactive predecessor chainを親が裁定した。

## Result

control-v2 evidenceだけをadmitするようseam treatmentを変更し、同じcontrol baseからaccepted runを2回、scope rejectionとbehavior
rejectionを各1回実行した。accepted artifactとraw patchは2回で一致し、旧v1 control evidenceとshared-state negative controlは隔離
実行前にrejectされた。

| artifact | status／kind | canonical digest | canonical bytes |
|---|---|---|---:|
| `transform-artifact.json` | accepted | `09ef275af54cf4bc4bbd65e08750be6ab22f7febe4d800b3be16548408a4a30d` | 2237 |
| `scope-rejection-artifact.json` | rejected / `scope_violation` | `9775a4a6f90427e1dc7d29aa6e717696be472afae53e516b5a6e459edd7ff0ed` | 1377 |
| `behavior-rejection-artifact.json` | rejected / `behavior_verification_failed` | `28f6a6fdfd83d0c265f444a3b93b0495e09779ecd2349edb0df9439897609661` | 1818 |
| `execution-evidence.json` | execution receipt | `ad4d47157e1ce7b4bff2d5e8cf6756044e493ea967a5f33e323c02aa0ba67d77` | 2485 |

Machine artifactは`research/campaigns/rc1/artifacts/treatment-v2/transform/`に置いた。表のdigest／bytesはJSON file byteではなく
parsed payloadのLattice canonical serializationを指す。

## Causal binding

- experiment base: `d2d412800492fbed03febe02abc6dca81c09a88b`
- executor implementation: `3ef99c4c4ed1b87bd8833a7492cea5e00993d46d`
- control evidence schema: `lattice.rc1.control_compilation_evidence.v2`
- graph projection: `lattice.codegraph_portable_outcome.v1`
- control compilation evidence: `44cfd470e01e1e115c7f687271520483fbd3295d4b8ca2962a22b21129acb00e`
- boundary manifest: `1aec1c9efc6baa19a6df9f82464ddb8069988f5165f049573811cc3de935a064`
- boundary verdict: `f7e4df5b94ea7f0cb9676670d312d7aaee5ef2881854610c3bb2de41557735bf`
- control plan: `506052d82f68cd1041e7b3398687a2d539053dc55ffd63b5530ed9bdf5102110`
- query set: `c20c16da335826e1b5e692f6628cb83b6173ee30dd1ee60a1bf3b1d71dc69892`

v2 admissionはevidence root、executor／base SHA、artifact meta、2 fresh-index proof、query ID／operation順序、manifest graph evidenceを
照合する。旧v1 evidence、projection drift、portable equality false、outcome digest driftはrunnerを呼ばずfail closedとなる。

## Intervention and rejection controls

- raw patch SHA-256: `acefad450f77906d21e1712c710c1ed91e199d9607d7c6703e8378abeb1f92af`、2815 bytes。
- 旧same-base runのraw patchとbyte-identical。accepted post snapshotも
  `7ce1695afcab0a91949753b4085233b333ecd03d1f5fabf22b1d4db4ff8d5d36`で同一。
- detached cloneのcontrol baseで`git apply --check --whitespace=error-all` passed。
- characterization receipt digestは`893cbf613d0b15a87c3d98638ec371a568dd204a0fe0f8eaf1a17e624d493e7d`。
- accepted repeatは312.125 ms／265.918 ms、scope rejectionは62.233 ms、behavior rejectionは150.011 ms。
- rejected artifactはscopeでpatch `null`、behaviorで返却patch `null`。canonical sourceと開始時worktree集合は各run後に不変。

## Gates

- test-first red: v2 inputを旧v1 validatorへ与え、3 pass / 2 fail。accepted pathはv2 schemaを拒否し、旧v1 pathはrunnerまで抜けた。
- focused: `node --test test/seam-transform.test.mjs` → 5 pass / 0 fail / 0 skip。
- syntax: `src/seam-transform.mjs`、unit test、related integrationの3 fileがpass。
- related: `node test/integration/seam-transform.integration.mjs` → accepted、scope rejection、behavior rejection、source不変、cleanup passed。
- artifact reread: public validator、canonical digest／bytes、patch SHA-256、絶対path不在、worktree集合不変を確認してpass。
- full `npm run ci`: RC1-Gへ集約したため未実行。
- Codegraph reindex: RC1-E2のnon-goal。RC1-Fでaccepted patch適用後のfresh indexとして実行する。

## Source preflight and audit

source編集前のLattice Codegraphで`assertControlCompilationEvidence`のowned symbol、caller `assertCandidateInputs`、artifact／SHA検証
callee、`runRc1SeamTreatment`へのimpact、affected `test/seam-transform.test.mjs`を確認した。新規portable validation helperは
`new_surface_unknown`として記録し、空結果を依存なしへ丸めていない。

diff、focused／related gate、control-v2 digest chain、旧artifact不変更を親が確認した。生成artifactは正規
`runRc1SeamTreatment`の4 runから直接作り、手作業でartifact内容を補正していない。

## Residual unknown and boundary

- isolation runnerの既存ignored file content-only mutation検出は未解決で、RC1-Gの安全性評価へ持ち越す。
- RC1-Fのreindex／plan v2 compile／control比較は未実施であり、本evidence単独では閉ループ成功を主張しない。
- dotagentsとObserver関連repoはread-onlyを維持し、remote作成、push、publishは実施していない。
