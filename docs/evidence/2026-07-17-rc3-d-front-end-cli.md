# RC3-D — generic front-endとplan CLI実装

- 日付: 2026-07-17
- plan: [plan_lattice_rc3_runtime_vertical_slice.md](../archive/plan_lattice_rc3_runtime_vertical_slice.md) RC3-D節
- 契約: ADR 0044 Decision 2（schema fail closed）・8（CLI surface）・10.4/10.5（identity純度・check列挙）・11（RC2 fixture再利用）
- Control: `lattice-rc3-runtime-v1`（task `RC3-D-front-end-and-plan-cli-v1`、review run `RC3-D-implementation-review-run-01-v1`）

## 実装

### `src/runtime-front-end.mjs` — generic front-end

`run_request.v1`＋fresh Codegraph evidenceから、fixture特判なしで`runtime_plan.v1`とTODOごとの
`boundary_manifest.v2`をcompileする。pipeline: witness正規化 → observation set →
`compileBoundaryObservationV2`（normalized graph）→ `compileSchedulabilityGraphV2` → schema検証・binding検証。

- **witness束縛契約**（RC3-Dで固定）: `codegraph_provenance.queries[] = {query_id, expect}`。
  expectはsymbol（name＋path exact一致ちょうど1件）／path（filePath exact一致1件以上）／affected
  （changedFiles=[path]かつaffectedTests＝witness宣言のexact一致）。expect↔query setのoperation/target
  cross-bindを必須にし、別targetのreceiptへの再ラベルをQUERY_DRIFTでreject。
- **typed non-dispatchable**: `NODE_LIMIT_EXCEEDED`（9 TODO+）／`BOUNDARY_UNKNOWN`（witness unknown、
  非ready束縛query、未束縛owns、ownership未解決write交差、stale index）／`SEARCH_BUDGET_EXHAUSTED`／
  `QUERY_DRIFT`（query set外参照・cross-bind不一致・covering query曖昧化・status query非1件）／
  `AFFECTED_TEST_DRIFT`（fresh affected観測とwitness宣言の不一致）。
- **conflict意味論**: 共有owns target→write conflict、state_effects共有→state/effect conflict、
  write→read交差→state conflict（RC2 state overlap規則の継承）、state_effect宣言なしbare shared
  resource→方向不明としてconflict。いずれもserial scheduleへ落ち、安全と推測しない。
- **identity純度**: plan／manifestへはportable outcome projectionのcanonical digestのみ
  （`portableCodegraphOutcome`でprojectPath・lastIndexed・dbSizeBytes等を除去）。raw telemetry依存の
  不変性はfocused testで固定。owns path／expect pathはrepo相対規律（absolute・`..`拒否）。
- producer結果は`verifySchedulabilityPlanV2`と常時一致を要求（成功条件5）。

### `src/runtime-cli.mjs`＋`bin/lattice.mjs` — plan compile/verify CLI

- `lattice plan compile --request <file>`／`lattice plan verify --request <file> --plan <file>`。
- exit契約（Decision 8）: 0=成功（versioned JSON 1行をstdout）、1=typed契約失敗（stderrへ
  `lattice.cli_error.v1` 1行）、2=usage違反。`--version`／`doctor --json`はbyte不変。
- fail closed経路: regular file限定＋8MB上限のread後再検査、`STALE_BASE`（HEAD≠base_sha、観測後の
  再確認でTOCTOU窓も閉鎖）、`INVALID_RUN_REQUEST`、non-dispatchable code直通。
- `plan verify`は保存planを信用しない: `validateRuntimePlan`＋manifests検証＋**compileと同一の固定導出**
  （`plan-<request_id>-e1`・epoch 1）でfresh観測から再コンパイルし、plan／manifest／graphの構造完全一致
  （digestArtifact比較）と独立verifier再計算を要求。relabel改竄・再封印改竄はreject。
- CLI reject経路のexit 1→2は、RC3-B characterizationをDecision 8契約へ意図的に更新した承認済み挙動変更。

### `src/rc3-dogfood-scaffold.mjs` — dogfood scaffold（Decision 11）

- RC2 fixture 3点（fixture entry・oracle・shared test）＋`.codegraph/.gitignore`を**HEAD blobから**
  byte-identicalに同一相対pathへ複製したdisposable git repoをtmpdir配下へ作る。working treeがHEADと
  食い違う場合はdirty bytesのbase誤帰属を防ぐためreject。
- oracle bytesはaccepted candidate witness（epoch `delivery-policy-semantic-v2`、candidate digest
  `4cc5d7bb…`）の`fixed_oracle.source_digest`（`c68a7ff9…`）とbind。不成立はtyped rejection。
- lattice_source／targetの2 namespace分離（Decision 11.2）、exclusive mkdirによるatomic no-overwrite、
  transform対象6 path不在検証。`verifyRc3DogfoodScaffold`はtreatment bindingのLattice sourceからの
  再導出照合・clean tree（untracked含む）・base束縛・byte driftをtyped violationsで返す。

## expected-red先行の記録

`test/integration/rc3-dogfood-scaffold.integration.mjs`を先に置き、`ERR_MODULE_NOT_FOUND`のredを確認してから
`src/rc3-dogfood-scaffold.mjs`を実装してgreenへ反転させた（RC3-B safety net規律の継承）。

## 異provider review（commit前）

codex-sidecar `codex_review`（gpt-5.6-sol×high、read-only）が12 finding（P0×3・P1×6・P2×3）を返した。裁定:

- **採用10件**: P0=affected非ready丸め／reads・bare resourcesのgraph欠落／verify保存plan未検証。
  P1=query cross-bind欠落・absolute path混入・HEAD TOCTOU・dogfood verifier穴・dirty bytes誤帰属。
  P2=8MB TOCTOU（FIFO含む）・mkdir競合窓。全件fail-closed方向へ修正し、敵対test 7件を加算。
- **条件付き採用1件**: CLI envelope schema（`plan_compile_result.v1`／`plan_verify_result.v1`／`cli_error.v1`）は
  Decision 2の所有一覧外。実装は維持し、正式所有はRC3-J最終ADRで裁定する（本文書が暫定契約記述）。
- **棄却1件**: `--request`への絶対path拒否要求。operator指定の入力fileは正規のCLI慣行であり、
  Decision 8の「不正path」はJSON契約内のrepo相対規律を指す。権限境界を越えない。

## 検証

- focused: `test/rc3-front-end.test.mjs` 16、`test/rc3-cli-characterization.test.mjs` 4、
  `test/integration/rc3-plan-cli.integration.mjs` 7、`test/integration/rc3-dogfood-scaffold.integration.mjs` 7。
- related gate（source収束後1回）: RC3対象＋bootstrap＋event-store scope＝75 test green、`npm run check` pass
  （新module 3件を列挙へ追加済み）。
- Phase開始baseline: `npm test` 215/215 green（maintenance commit `355b4cb`後）。

## 未検証・持ち越し

- `run start`以降のCLI surfaceは未実装のままusage rejectで固定（RC3-E以降）。
- CLI envelope schemaの正式所有裁定はRC3-J。
- 第二fixture topology（dispatch-record）の**campaign実走**でのcompileはRC3-Hで実証する
  （adapter一般性はunit topologiesと非分岐検査で固定済み）。
- scripted executor・event store配線はRC3-E所有。
