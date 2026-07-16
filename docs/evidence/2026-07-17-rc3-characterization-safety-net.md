# RC3 characterization safety net

- 日付: 2026-07-17
- Control: `lattice-rc3-runtime-v1`（Task `RC3-B-characterization-safety-net-v1`、revision 14で記録）
- 対象plan: [RC3 runtime vertical slice計画](../plan_lattice_rc3_runtime_vertical_slice.md) RC3-B
- 契約: [ADR 0044](../adr/0044-rc3-runtime-contract.md)
- production source（`src/`・`bin/`）変更: 0。RC1／RC2のtest・fixture・canonical artifact変更: 0。
- 実装形態: F受入を親が直接実施（Worker委譲なし。物量が受入コストを下回るため）。

## Fixed characterization（green 7）

### `test/rc3-compatibility.test.mjs` — 互換baseline replay

RC1 v6とRC2 v1〜v4のcanonical artifactを、RC3実装開始前のdisk replayとして一回固定した。

| 対象 | verifier | checks |
|---|---|---|
| RC1 v6 | `verifyRc1V6ArtifactsOnDisk` | 12/12 |
| RC2 v1 | `verifyRc2CampaignArtifactsOnDisk` | 14/14 |
| RC2 v2 | 同上 | 15/15 |
| RC2 v3 | 同上 | 15/15 |
| RC2 v4 | 同上 | 15/15 |

checks件数はRC2最終full gateの保存receipt（[RC3 baseline](2026-07-16-rc3-baseline.md)）と完全一致する。

### `test/rc3-cli-characterization.test.mjs` — 現CLI surface

`bin/lattice.mjs`の現挙動を固定した（ADR 0044 Decision 8はこの2挙動を変更せず加算する契約）。

- `--version`: package versionのみをstdout、exit 0。
- `doctor --json`: `lattice.bootstrap_diagnostics.v1`の1行JSON（`validateBootstrapDiagnostics`でstrict検証、
  `implementation`全false）、exit 0。
- RC3予定surface全6 command（`plan compile`／`plan verify`／`run start`／`run observe`／`run status`／
  `event verify`）、引数なし、未知command、過剰引数、引数順不正: stdout空、
  stderr `lattice: unsupported command or arguments: <received>`の1行、exit 1のfail closed。

### `test/integration/rc3-event-store-scope.integration.mjs` — event store非混入

ADR 0044 Decision 10.3のtracked exclusionを先行実装し、integrationで固定した。

- `codegraph.json`のexcludeへ`research/runs/`を追加（
  旧SHA-256 `47f04b1f8d9a5e489ffac0295a2630000e34ac5179d8707e7ba878b9d606d388` →
  新SHA-256 `2d5b6b083859861ff8adb5bbf8219b86096d29ec9600bfccf4f51b3817ef5124`＝commit対象bytes）。
- disposable clone上で、event store側`.mjs` probe（`research/runs/rc3/it-run-01/state/`）と
  fixture側control probe（`research/fixtures/rc3-scope-probe/`）を同時にcommitし、`codegraph init`後の
  `codegraph files`でevent store側0件・fixture側収載を照合した。JSON非index挙動への暗黙依存はない。
- exact名一致queryでexcluded probeのnode不在も確認した（fuzzy解決対策）。

## Expected-red result（intentional 17）

親のfocused再実行結果:

```text
tests: 17
pass: 0
fail: 17
```

- `test/rc3-runtime-characterization.test.mjs` 9件: `src/runtime-decision-verifier.mjs`の
  `ERR_MODULE_NOT_FOUND`だけ。ready frontier unlock／capacity block（ADR 0044 Decision 4）、
  scope violation×observed write conflictの別finding保存とsemantic conflict unknown（Decision 5）、
  carry-over witness欠落hold・witness付きcontinue（Decision 6.4／7.2）、freeze後stale receiptの
  typed rejectとfrozen prefix内witness binding受理（Decision 7.4／7.5）、witness単一field破壊の
  `carry_over_unprovable`（Decision 7.5）を固定した。
- `test/rc3-event-chain-characterization.test.mjs` 8件: `src/runtime-event-store.mjs`の
  `ERR_MODULE_NOT_FOUND`だけ。正規chain受理、closed kind set全19種の受理、sequence gap／重複append／
  同一sequence fork／previous digest不一致／event digest改竄／未知kindのtyped reject（Decision 3）を固定した。
- syntax、fixture構築、assertion由来のfailure: 0。
- 判定はすべてevent `sequence`ベースで記述し、生成時刻・到着時刻を根拠にしていない（Decision 7.4）。
- expected-redが固定する予定moduleは`src/runtime-event-store.mjs`（`digestRunEvent`／`verifyRunEventChain`）と
  `src/runtime-decision-verifier.mjs`（`computeReadyFrontier`／`classifyObservedDiff`／`recomputeHoldDecision`／
  `recomputeReceiptDecisions`／`verifyCarryOverWitness`）。schema envelope／digestの完全検証はRC3-Cの
  validator契約で固定し、本safety netはproducer非依存のruntime意味論だけを固定する。

## Codegraph coverage照合

- 新規5 test fileはlive coverageへ収載済み: 77→82 files、pending 0、
  sorted path list SHA-256 `10ba5785d5ed6768ca0b6b698bb63b40e9480d3f2992bf70ecb1e7a497ad2923`。
- `research/runs/`はcanonical worktreeに未作成のまま（event store書込はRC3-E以降）。

## Verification classification

- `focused`: green 7 pass／0 fail（compatibility 2、CLI 4、integration 1）、expected-red 17 intentional。
- `related`: 対象production sourceがまだ存在しないため未実行。
- `full`: 未実行。RC3-J Phase gateへ集約する（expected-redはRC3-C／E／Gのmodule実装で解消される）。
- `git diff --check`: pass。remote、push、publish、Lattice外write: 0。
