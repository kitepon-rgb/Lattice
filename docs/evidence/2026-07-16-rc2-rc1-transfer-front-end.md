# RC2 RC1 v6 evidence transfer front-end

- 日付: 2026-07-16
- Control: `lattice-rc2-bounded-graph-v1` revisions 50〜52
- Task: `RC2-D2-rc1-transfer-front-end-implementation-v1`
- characterization commit: `e9820a9c2a0b5be3ae88fe6345f8455572495804`
- Codegraph preflight commit: `cc75998`
- source commit: `a7f58c8`
- governing Decision: ADR 0035

## Implemented boundary

`src/rc2-rc1-transfer-front-end.mjs`はimmutable RC1 v6のplan input、candidate spec、query set、manual evidence、
boundary manifestだけをexact入力にし、次を行う。

- plan／candidate／manual／manifestのTODO集合、plan anchor、outcomeをcross-bindする。
- plan、query set、manual evidenceをmanifestのSHA-256へbindし、candidate specをaccepted v6 witness digestへbindする。
- query setとmanifest graph evidenceのID／operation集合をexact一致させ、resource provenanceへ実result digest／statusを残す。
- manifestのsymbol／path write集合がcandidateの`current`または`proposed` surfaceの一方へ完全一致することからmodeを推定する。
  condition selector、保存済みconflict数、保存済みwave数は入力しない。
- structural resourceは`codegraph`と`manual_candidate_spec`、state／effectは`manual_state_effect`として別provenanceを持つ。
- source不明のglobal unknown、read/write区別を失うstate read、candidate witnessにないhard need、未対応write kindはfail-loudにする。
- `compileBoundaryObservationV2`と`compileSchedulabilityGraphV2`でbundle／pairwise verdict／minimum planを新規compileし、
  3つのv2 validatorを通した結果だけを返す。

source SHA-256:

```text
cf44bd9378039133f092466df3585e5d53bee83804fda45b1d142179a2048de0  src/rc2-rc1-transfer-front-end.mjs
```

## RC1 v6 transfer result

| condition | graph digest | resources | conflicts | distinct pairs | state conflicts | minimum waves |
|---|---|---:|---:|---:|---:|---:|
| control-normal | `739c0f47ae8b50957ff7d03929aef489907010dcd0560f015ee103e76458eeae` | 3 | 3 | 1 | 0 | 2 |
| treatment-normal | `0326f7e43d4b57c78c64fcafd7a50fb11ed9b3f189451ab9170ce584d89ae513` | 8 | 0 | 0 | 0 | 1 |
| control-negative | `2be183768ec2a1340ff7b7e919595ea01cd8a5961e63e28c971a2dd2fea29cff` | 4 | 4 | 1 | 1 | 2 |
| treatment-negative | `ea0f3d97a113df42bbb946c6e5ebf5ab5a6a5729506ed4d0b46a7b59f93e1831` | 9 | 1 | 1 | 1 | 2 |

normal treatmentだけが2 wavesから1 waveへ変わり、manual shared-state negativeはtreatment後にも1 conflict／2 wavesを保持した。
したがってv1のresource record数とdistinct TODO pair数を混同せず、RC1 v6の4条件とisomorphicである。source commitの変更pathは
新front-end 1 fileだけで、RC1 sourceと`research/campaigns/rc1/artifacts/v6`の変更は0だった。

## Codegraph boundary

source前preflightでは予定path／exportは不在で、caller／callee／impact／affectedの空を依存なしへ丸めずunknownとして固定した。
source後に明示syncし、次を確認した。

```text
files: 67
nodes: 1571
edges: 6048
pending changes: 0
```

- `compileRc1TransferBundleV2`はrequested nameと`src/rc2-rc1-transfer-front-end.mjs:423`へexact一致し、export済み。
- direct callerは`assertTransferredCondition`とcharacterization test file。
- direct calleeは19 functionsと`INPUT_KEYS` 1 constant。v1 validator、v2 observation compiler、bounded scheduler、3 validatorを含む。
- impact depth 2はexport、caller、test fileの3 nodes／3 edges。
- affected testは`test/rc2-rc1-transfer-front-end.test.mjs` 1件、traversed 1。
- post-source unknown: 0。

## Verification

```text
node --test test/rc2-rc1-transfer-front-end.test.mjs: 7 pass / 0 fail / 0 skip
git diff --check -- src/rc2-rc1-transfer-front-end.mjs: pass
```

- `focused`: 7 pass／0 fail／0 skip。4 conditionとcandidate／query／manual corruption rejectionを含む。
- `related`: Codegraph affected testはfocusedと同じ1 fileなので上記greenを再利用した。
- `full`: 未実行。RC2 Phase gateへ集約する。
- Control初回finalization入力はobject型を`INVALID_SCHEMA`で拒否し、revision不変だった。path文字列へ修正後revision 52でfinalizeした。
- dotagents／Observer関連repo write、remote、push、publish: 0。
