# RC1 v4 correction source-edit preflight

- 実施日: 2026-07-15
- 対象HEAD: `e12fbadfbaf9d7e29c4cb373a3e1f4a93ca32052`
- source scope: `src/`、`test/`、`research/`、`package.json`
- source scope tree listing digest: `fbbb166f20676e6cea635461347d0115762c477af1396c98717cede2fb17f92f`
- git-visible status: clean
- Codegraph: 1.4.1、index complete、25 files、452 nodes、1,820 edges、pending changes 0、
  pending refs 0、worktree mismatchなし、reindex recommendationなし

v3 Phase gateで支持された5 findingを直す前に、予定owned surfaceへ`query`、`callers`、`callees`、`impact`、
owned pathへ`affected`を実行した。CLIは`CODEGRAPH_NO_DAEMON=1`、`CODEGRAPH_NO_WATCH=1`、
`CODEGRAPH_NO_UPDATE_CHECK=1`、`DO_NOT_TRACK=1`、`NO_COLOR=1`で固定した。

## Existing owned symbols

| symbol | exact owner | callers | callees | impact | affected tests |
|---|---|---:|---:|---:|---|
| `compileControlArtifacts` | `src/control-compiler.mjs` | 4 | 14 | 5 | `test/control-compiler.test.mjs` |
| `compileTreatmentArtifacts` | `src/treatment-compiler.mjs` | 3 | 15 | 6 | `test/treatment-compiler.test.mjs`、`test/treatment-runner.test.mjs` |
| `runIsolatedTransform` | `src/isolation-runner.mjs` | 3 | 7 | 6 | `test/isolation-runner.test.mjs`、`test/seam-transform.test.mjs` |
| `runRc1SeamTreatment` | `src/seam-transform.mjs` | 2 | 16 | 3 | `test/seam-transform.test.mjs` |
| `runRc1TreatmentRecompile` | `src/treatment-runner.mjs` | 2 | 14 | 3 | `test/treatment-runner.test.mjs` |
| `buildDispatchRecord` | `research/fixtures/dispatch-record/src/dispatch-record.mjs` | 1 | 2 | 2 | `test/research-dispatch-record.test.mjs` |

`compileTreatmentArtifacts`は`runRc1TreatmentRecompile`から呼ばれ、`runRc1SeamTreatment`は
`runIsolatedTransform`を呼ぶ。したがってcompiler、transform、runnerの補正を独立な「依存なし」へ分割できない。
関連testは上表に加え、impact上でcontrol portability、treatment integration、seam integrationまで伝播する。

`buildDispatchRecord`の唯一のcallerはshared `test/research-dispatch-record.test.mjs`であり、owned sourceの
`affected`も同じtestを返した。v3 compilerがこのtestを実行対象としてだけ保持し、future `channel-policy`と
`label-policy`が互いに異なる期待値へ変更する共同write surfaceとしてmanifestへ載せなかったことを実コードで再確認した。

## Exact test-path sensing

- `query test/research-dispatch-record.test.mjs --json`は、fuzzy matchを含む結果の中にqualified nameが完全一致する
  `file:test/research-dispatch-record.test.mjs`をexactly one返した。
- `query test/research-dispatch-channel.test.mjs --json`と
  `query test/research-dispatch-label.test.mjs --json`はJSON `[]`だった。これは`symbol_absent`であり、
  post-transform independenceではない。
- `affected <未存在test path> --json`は未存在でもchanged path自身を`affectedTests`へ返した。よって
  `affected`の非空をfile存在証明へ使えない。test surfaceの存在はfull pathをtargetにしたexact `query`で判定し、
  `affected`は影響関係だけに使う。
- 自然言語のtest名を`query`すると無関係な定数をfuzzy matchした。非空query結果をexact resolutionへ丸めず、
  `node.name`または`node.qualifiedName`の完全一致を必須にする。

## Planned new surfaces and unknown

| planned symbol | planned path | observed query | callers／callees／impact | affected |
|---|---|---|---|---|
| `compileBoundaryCondition` | `src/boundary-compiler.mjs` | JSON `[]` | exit 0の非JSON `Symbol not found` | tests `[]`、traversed 0 |
| `createRc1EvidenceBundle` | `src/rc1-evidence-bundle.mjs` | JSON `[]` | exit 0の非JSON `Symbol not found` | tests `[]`、traversed 0 |
| `validateRc1EvidenceBundle` | `src/rc1-evidence-bundle.mjs` | JSON `[]` | exit 0のANSI付き非JSON `Symbol not found` | pathは上行と同じunknown |
| `evaluateRc1Hypothesis` | `src/rc1-comparison.mjs` | JSON `[]` | exit 0のANSI付き非JSON `Symbol not found` | tests `[]`、traversed 0 |
| `runRc1BlackBoxOracle` | `src/rc1-black-box-oracle.mjs` | JSON `[]` | exit 0の非JSON `Symbol not found` | tests `[]`、traversed 0 |
| `channelPolicyContract` | `test/research-dispatch-channel.test.mjs` | JSON `[]` | exit 0のANSI付き非JSON `Symbol not found` | planned test pathはself-only affected |
| `labelPolicyContract` | `test/research-dispatch-label.test.mjs` | JSON `[]` | exit 0のANSI付き非JSON `Symbol not found` | planned test pathはself-only affected |

これらは`new_surface_unknown`／`path_not_indexed_unknown`であり、caller、callee、impact、affected testがないとは
結論しない。追加後のfresh indexで同じoperation setを再実行する。

## Source identity and retained worktrees

| path | SHA-256 |
|---|---|
| `src/control-compiler.mjs` | `98bbac348b9eaa23efbac7aeb200778cbaac4dede552c0968509183bb5b55c33` |
| `src/treatment-compiler.mjs` | `b0d6290495e3fd8fd405b192af25e382d2e8a75ec057fb8710c7257f5b87ceba` |
| `src/isolation-runner.mjs` | `e62fd5d9cfffe2590c8208c35cf717b6ab55e120815b4ed118c32b10d91d341d` |
| `src/seam-transform.mjs` | `fda7a4140b0be9b176c962d74d4526b7171cb03a95df11f3952e6c2ac3cfb8ee` |
| `src/treatment-runner.mjs` | `29957343b69df377af470dd375300b57fb4f4161eabf3ad423352079b2f3afd4` |
| `research/fixtures/dispatch-record/src/dispatch-record.mjs` | `fd6d263037ada1dea778f7cd4be9f8303a4b9e4326b8789ef53e1e23c3d18930` |
| `test/research-dispatch-record.test.mjs` | `ab112d02e1d84e6b22eeef6badeb9e40fa6e02428ad6b6a2b7ecbfd11251e24f` |

canonical worktreeに加え、既存の`lattice-rc1-codegraph-adapter`と`lattice-rc1-isolation-runner` detached
worktreeが存在する。どちらもRC1 v4のcleanup対象にせず、開始時のsource invariantへ含めて保持する。

## Parent decision

RC1-Hではversioned candidate spec、query set、transform外behavior oracle、赤いcharacterizationだけを追加する。
production sourceはまだ変更しない。candidate specはfuture TODOのproductionとtest writeを第一級resourceとして持ち、
file存在はCodegraph exact query、TODOがどのtest assertionを書き換えるかはoutcomeと手動provenanceで分ける。
同一compiler、transform、evidence bundleのsource scopeは赤いtestの失敗面を確認してからRC1-I／J／Kへ固定する。

## Characterization red receipt

実行: `node --test test/rc1-v4-characterization.test.mjs`

- focused: 7 tests、1 pass、6 fail、0 skip、0 todo
- green: candidate spec v2、query set v2、behavior oracle v2の固定入力契約
- red: `compileBoundaryCondition`未存在（同一compiler入口とshared test writeの2 test）
- red: `runRc1BlackBoxOracle`未存在
- red: `validateRc1EvidenceBundle`未存在
- red: `evaluateRc1Hypothesis`未存在
- red: 現行`runIsolatedTransform`がtemp repo内の既存ignored protected fileのcontent-only mutationを検出せず、
  `assert.rejects`が`Missing expected rejection`になった

syntax check、3 JSONの`jq empty`、`git diff --check`はgreen。characterization後にtemp repo／temp worktreeは残らず、
canonical worktreeと既存2 detached worktreeの集合は開始時と一致した。このredは実装未完を成功へ丸めず、RC1-I／J／Kの
受入境界として保持する。
