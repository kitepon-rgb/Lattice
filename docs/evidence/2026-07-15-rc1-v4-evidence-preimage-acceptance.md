# RC1-K evidence preimage＋source invariant acceptance evidence

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v4` / RC1-K
- Control: `lattice-rc1-closed-loop-v3` / `RC1-K-evidence-preimage-invariant-v4`
- predecessor: [ADR 0017](../adr/0017-rc1-v4-identifiability-safety-net.md)、[ADR 0019](../adr/0019-rc1-v4-production-test-seam-accepted.md)
- Decision: [ADR 0020](../adr/0020-rc1-v4-evidence-preimage-accepted.md)
- classification: F。evidence integrityとcanonical source invariantはfalse supportを直接左右する契約境界なので親が直轄した。

## Accepted result

`createRc1EvidenceBundle`は、query set v2とadapterが返した1 fresh runの構造化evidenceから、次を互いに独立したcomponentへ
compileする。

| component | schema | 保存内容 | identityから除外するもの |
|---|---|---|---|
| opaque raw receipt | `lattice.codegraph_raw_opaque_receipt.v1` | canonical adapter evidenceのbase64、byte長、SHA-256 | なし |
| diagnostic | `lattice.codegraph_sanitized_diagnostic.v1` | sanitized payload、実operation manifest、rules／payload digest | cwd置換、statusの4 telemetry field、node `updatedAt` |
| portable | `lattice.codegraph_portable_preimage.v1` | full outcomes、per-query digest、aggregate digest | diagnosticと同じ環境依存telemetry |

raw receiptが保存するのはCodegraph CLI stdout／stderrのoriginal byte streamではなく、`codegraph-adapter.mjs`がquery ID、operation、
target、typed outcome、parsed dataへ構造化したevidenceのcanonical JSON byte列である。rawという語でprocess byte archiveを主張しない。

diagnostic sanitizerは固定allowlistだけを除外し、実際に発火したJSON pointer operationをmanifestへ列挙する。未知fieldは保持する。
sanitized diagnosticまたはportable outcomeへ絶対pathが残れば生成をrejectする。validatorはrawをdecodeして両componentを再生成するため、
manifest外のfield drop、manifest operation drop、portable rewrite、component digestの追随更新ではacceptされない。

`validateRc1EvidenceCampaign`はexactly 4 bundle、unique run ID、同一query-set digest、control 2 run、treatment 2 runを要求し、
condition内のportable aggregateとdiagnostic payloadの一致を検査する。Kのfixture evidenceでは2＋2 bundleが再現した。実Codegraph
fresh indexからの2＋2 bundle発行はRC1-Lのintegration gateであり、まだ実行済みとは扱わない。

`runIsolatedTransform`はcanonical repoの開始／終了状態を次のtyped receiptへする。

- HEAD SHAの一致。
- git-visible status byte列のdigestと一致。
- ignoredを含むpath status byte列のdigestと一致。
- `src/`／`test/`をlstatで再帰走査したentry type、file content、symlink targetのaggregate fingerprintとentry数の一致。

既に存在するignored `test/protected.ignore`の内容だけをtransform closureからcanonical repo側で変えるcharacterizationは、HEAD、visible
status、ignored path集合が全て同じでも`protected_content.equal=false`となり、typed failed receipt付きでrejectされた。成功runも
`lattice.source_invariant_receipt.v1`を返す。

## Codegraph before／after

test-first source実装前はCodegraph 1.4.1、35 files、641 nodes、2,490 edges、pending 0だった。planned bundle exportsはtestの
missing import以外にownerを持たず、affected path空を依存なしへ丸めずunknownとした。`runIsolatedTransform`は6 callers、7
callees、impact 10 nodes、affected tests 4件だった。`assertSourceUnchanged`は`src/isolation-runner.mjs`と
`src/treatment-runner.mjs`に同名symbolがあり、name-only traversalが混線するためunknownを残した。

実装後のfresh indexは36 files、682 nodes、2,665 edges、pending changes／refs 0、worktree mismatchなし、reindex recommendationなし。

| symbol | exact owner | callers | callees | impact nodes | affected tests |
|---|---|---:|---:|---:|---|
| `createRc1EvidenceBundle` | `src/rc1-evidence-bundle.mjs` | 1 | 9 | 2 | bundle unit |
| `validateRc1EvidenceBundle` | `src/rc1-evidence-bundle.mjs` | 2 | 1 | 3 | bundle unit、H characterization |
| `sourceInvariantComparison` | `src/isolation-runner.mjs` | 1 | 2 | 3 | runner経由 |
| `runIsolatedTransform` | `src/isolation-runner.mjs` | 6 | 8 | 10 | runner、H characterization、v4 transform、旧seam transform |

`codegraph affected src/rc1-evidence-bundle.mjs`は2 tests、`src/isolation-runner.mjs`は4 tests／7 traversed dependentsを返した。
exact ownerは解決したが、Codegraph構造証拠だけをbehavior preservationの証明には使っていない。

## Gates

- test-first red: 3 tests、0 pass / 3 fail。accepted resultのsource receipt不在、protected ignored content drift未検出、
  evidence moduleのESM import不在。
- targeted implementation: 6 pass / 0 fail。
- focused converged: bundle＋isolation runner 13 pass / 0 fail / 0 skip。
- related final: 上記13件＋H characterization＋v4 transform＋旧seam transform、29 pass / 0 fail / 0 skip。
- syntax check: 4 changed source／test files pass。
- `git diff --check`: pass。
- full `npm run ci`: source収束後のRC1-Mへ集約したため未実行。

## Accepted identity

| path | SHA-256 |
|---|---|
| `src/rc1-evidence-bundle.mjs` | `294409dfc748c7d493ccf523a230487639d5e3fa808f841c03de7ab46e092e7f` |
| `src/isolation-runner.mjs` | `681fb27a4e6738c87bdd610ac99a5fa2fde0e0ee4a2fcdd4eac5422a0e2e39d2` |
| `test/rc1-evidence-bundle.test.mjs` | `92c2222100ec75eb2138a3156a87909d8beaa7b7512ff543af9be830e27e917d` |
| `test/isolation-runner.test.mjs` | `82e9f4225f1996e34e7b05597d22de05b9fde946434b83ca12b14127b7fbc81e` |

## Parent audit and residual boundary

- portable aggregateはfull outcome preimage、query-set digest、projectionから再計算でき、per-query digestも本文に拘束される。
- diagnosticのunknown fieldはdropせず、path scrubの固定allowlistで扱えない絶対pathはfail closedになる。
- source invariantのcontent fingerprintは意図的に`src/`／`test/`へ限定する。既存ignored fileのcontent-only driftを全repoで
  検出する保証ではない。
- ADR 0019の`lattice.rc1.seam_transform_receipt.v4`は、Kで追加したsource invariant receiptをまだ最終receipt fieldへbindして
  いない。この統合はRC1-Lが`src/rc1-v4-transform.mjs`を明示scopeへ含めて行う。
- actual 2 fresh run／condition、accepted transformの実発行、same-query treatment index、single compiler comparison、complete
  success predicate、H1-v4支持はRC1-L／Mまで未受理。
- canonical worktreeと既存detached 2 worktreeだけが残り、dotagents／Observer関連repoはread-only、remote作成、push、publishは
  行っていない。
