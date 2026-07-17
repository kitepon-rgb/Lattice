# RC3 baseline evidence

- 観測日: 2026-07-16
- 対象plan: [RC3 runtime vertical slice計画](../archive/plan_lattice_rc3_runtime_vertical_slice.md)（`lattice-runtime-rc3-v1`）
- 対象Control: `lattice-rc3-runtime-v1`
- Decision: [ADR 0044](../adr/0044-rc3-runtime-contract.md)

## Current git

| 項目 | 実測 |
|---|---|
| HEAD | `003426c37bf62e0ceca6af3e6830687d685bf750`（`RC3 runtime vertical slice計画を固定する`） |
| worktree | clean（porcelain v2 status digest `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`＝空bytes） |
| stash | 0件 |
| remote | 0件（remote作成・push・publishは禁止のまま） |
| RC2最終full gate HEAD | `dc14a473575795ee4e13911faf52710c3b6a1d10` |
| `dc14a47..HEAD`のdocs外差分 | 0 file（`git diff --name-only dc14a47..HEAD -- . ':(exclude)docs'`が空。差分はdocs配下6 fileのみ） |

## Full baseline greenの再利用根拠

Phase開始時のfull baselineは、[RC2 version witness full CI](2026-07-16-rc2-version-witness-full-ci.md)の最終full gate
（`npm run ci`、174 pass／0 fail／0 skip、`npm run check`成功、HEAD `dc14a47`）を再利用する。

- `dc14a47`から現HEAD `003426c`までの差分は`docs/`配下のみで、`npm test`／`npm run check`が読むsource・test・bin・
  package定義は1 byteも変わっていない（上表のdocs外差分0で確認）。
- 当該full gateはRC1 v6 disk replay 12/12、RC2 artifact v1〜v4 replay（14／15／15／15 checks、
  [canonical artifact v4証拠](2026-07-16-rc2-canonical-artifact-v4.md)）、isolated worktree、fresh Codegraph整合を含む。
- したがって本引継ぎでfull suiteは再実行していない（テスト頻度規約: 同一source digestの直近green再利用）。RC3-Bで
  RC1／RC2 replayを互換baselineとして一回独立に固定する契約は変更しない。

## RC1／RC2 replay receipt（保存済み）

| 対象 | checks | 出典 |
|---|---|---|
| RC1 v6 disk verifier | 12/12 | 最終full gateに包含（[RC2 v4 Phase反証](2026-07-16-rc2-v4-phase-refutation.md) 成功条件1） |
| RC2 artifact v1 | 14/14 valid | [canonical artifact v4証拠](2026-07-16-rc2-canonical-artifact-v4.md) |
| RC2 artifact v2 | 15/15 valid | 同上 |
| RC2 artifact v3 | 15/15 valid | 同上 |
| RC2 artifact v4 | 15/15 valid | 同上 |

canonical artifact v4（manifest SHA-256 `3919276bdb98676259195f4fda709eba37dffc3632479f729d2c4be1a10186b6`）、
plan v5（SHA-256 `cbb9be9b0db4168396de12d9db1e041362b2e4da7200d38307da897512b2093b`）、ADR 0041〜0043は
不変predecessorであり、本baselineで再生成・変更していない。

## Codegraph coverage

| 項目 | 実測 |
|---|---|
| Codegraph version | 1.4.1 |
| index状態 | up to date（pending 0） |
| files／nodes／edges | 77／1,955／7,522 |
| file分布 | src 33、test 39、bin 1、research/fixtures 2（`delivery-policy-registry`・`dispatch-record`）、yaml 2 |
| file一覧SHA-256 | `d58c9a3fa7422223e4bd372da726cc9e9dfa13e2831bdd2a7ab23f53f42589cc`（sorted path list） |
| exclude設定 | `codegraph.json`＝`research/campaigns/**/artifacts/**/identity/`（SHA-256 `47f04b1f8d9a5e489ffac0295a2630000e34ac5179d8707e7ba878b9d606d388`） |

v4発行後観測（77 files／1,955 nodes／7,522 edges、[canonical artifact v4証拠](2026-07-16-rc2-canonical-artifact-v4.md)）と
完全一致し、artifact identity sourceのlive graph混入は0のままである。`research/campaigns/`配下のJSON artifactは
language index対象外だが、RC3 event storeの非混入はこの暗黙挙動に依存せず、RC3-Bのtracked exclusionと
coverage integration testで明示的に固定する（ADR 0044）。

## 現CLI surface

`bin/lattice.mjs`（SHA-256 `c2969538dd5262e29620b54b431f4233f3ff7db997885295973371452313d15b`）の実測。

| 入力 | stdout | exit |
|---|---|---|
| `--version` | `0.1.0` | 0 |
| `doctor --json` | `lattice.bootstrap_diagnostics.v1`／`bootstrap_ready`（`boundary_compile:false, recompile:false, transform:false`） | 0 |
| `plan compile` | （stderr: `lattice: unsupported command or arguments: plan compile`） | 1 |

RC3公開予定のCLI surface（`plan compile`／`plan verify`／`run start`／`run observe`／`run status`／`event verify`）は
未実装であり、現CLIは`--version`と`doctor --json`以外をfail closedで拒否する。この現挙動はRC3-Bで
characterizationとして固定する。

## RC3 Control初期化

| 項目 | 値 |
|---|---|
| control_id | `lattice-rc3-runtime-v1`（新規root、RC2 archived Controlの継続ではない） |
| objective_ref | `docs/plan_lattice_rc3_runtime_vertical_slice.md` |
| base_sha | `003426c37bf62e0ceca6af3e6830687d685bf750`（initial dirty false） |
| initial workspace digest | `52742a2b81f9320e9c5c8336108e7053aeef865f47e8a569c8379ebd85939cc3` |
| phase gate | risk `high`／behavior lane `behavior-preserving`（最初のTask記録前に固定） |
| budget | worker 16／consultation 4／external 8／wall 172,800 s／cost 100 USD／approach family 6／retry 2／integration 4 |

予算根拠: RC2はworker 8／consultation 2で上限へ到達し、Phase反証時に独立実行者を追加できなかった
（[RC2 v4 Phase反証](2026-07-16-rc2-v4-phase-refutation.md)）。RC3はactual multi-agent dogfood（RC3-I、external
executor 2以上＋timeout recovery）と異provider read-only refuter（契約収束・Phase反証）をControl予算内で
賄うため、external 8を含む上記上限をinit時に固定した。sidecar等による予算迂回は行わない。

## 本baselineでスキップしたこと

- full suite再実行: 上記のとおり同一source digestの直近greenを再利用したため実行しない。
- campaign／canonical artifact再生成: 不変predecessorのため実行しない。
- RC3実装・Codegraph再index・actual dispatch: RC3-B以降の契約であり未着手のまま。
