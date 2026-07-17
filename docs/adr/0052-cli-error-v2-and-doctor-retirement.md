# ADR 0052: cli_error v2（detail導入）とbootstrap doctor面の退役

- Status: accepted
- Date: 2026-07-18
- 位置づけ: L6 maintenance wave裁定。RC4 queue「`cli_error.v1`がcompile失敗の`detail`を落とす」と
  L6 queue「`doctor --json`の化石化」を同時に閉じる
- 前提: [ADR 0044 Decision 8](0044-rc3-runtime-contract.md)（CLI surface・「既存`--version`／
  `doctor --json`の挙動を変更しない」）、[ADR 0045 Decision 4](0045-rc3-phase-gate-support.md)
  （CLI envelope schemaのLattice所有裁定）、[ADR 0049](0049-lattice-mcp-surface-contract.md)
  Decision 8（MCP startup失敗＝exit 1＋`lattice.cli_error.v1` 1行——**本ADRがv2へ上書きする**）
- 反証: `fable`×high refuter 1回済み（条件付き通し・5条件を本文へ反映済み）

## Context

1. `lattice plan compile`等のtyped失敗はstderrへ`lattice.cli_error.v1`（`code`/`message`のみ）を出し、
   throw側が渡しているdetail（`BOUNDARY_UNKNOWN`のunknown内訳・`AFFECTED_TEST_DRIFT`のmismatches等）を
   落とす。**実因は`CliContractError` constructorが`(code, message)`のみでdetail引数を握り潰す未配線**
   （refuter実読）。だがconstructorだけ直すとv1へのin-place拡張（ADR 0044 Decision 2で禁止）に
   なるため、versionを上げる。なおdetailの実体はversioned result schemaの一部ではなく
   producer内部outcomeである＝v2が自前でdetail契約を裁定する必要がある。
2. `doctor --json`（`lattice.bootstrap_diagnostics.v1`）はbootstrap期の遺物で、現在は**虚偽を返す**——
   `references.plan`が消滅済み`docs/plan_lattice.md`を指し、`implementation`の3 flagが実装済みの現状に
   反して`false`固定。健全性の正本は`factory-diagnostics --json`（L6実装）へ移った。
   ADR 0044 Decision 8の「挙動を変更しない」はRC3期の凍結であり、虚偽面の恒久維持を意図していない。

## Decision

### 1. `lattice.cli_error.v2` — typed失敗envelopeへoptional `detail`を導入する

- exact keys: `schema` `code` `message`＋**optional `detail`**。`detail`はthrow側が渡した
  plain objectを運ぶ。**契約はv2が自前で裁定する**: bounded規律はproducer側の既存上限
  （repo相対path強制・`MAX_PATH_BYTES` 1024・`MAX_COLLECTION` 256・入力8MB）を根拠とし、
  env・credential・絶対pathを含む値をdetailへ入れてはならない。stderr 1行（`JSON.stringify`）は不変。
- **detailの発行規則**: 非空plain objectの場合のみ`detail` keyを出す。null・非object・
  **空object（`SEARCH_BUDGET_EXHAUSTED`の現行`{}`が該当）は省略**する。
  `EVENT_VERIFICATION_FAILED`はstdoutへ`event_verification.v1`（failed_conditions入り）を発行済みのため
  **detailを付けない**（同一情報の二重化を作らない）。`EVENT_CHAIN_INVALID`は対応するresult schemaに
  detail相当fieldが無いが、chainの`failed_conditions`をdetailとして持つことを本Decisionで認める。
- `bin/lattice.mjs`のCLI 6面・runtime-errors面・INTERNAL_FAILURE・`bin/lattice-mcp.mjs`のstartup失敗は、
  今後**v2のみ**を出す（v1/v2の混在を作らない）。exit契約（0/1/2）は不変。
- 実装形: `CliContractError`へ第3引数`detail`を配線し、envelope書き出しで上記規則を適用する。

### 2. `doctor --json`を退役する（usage違反へ）

- `doctor --json`分岐と`src/bootstrap.mjs`を削除し、以後は未知commandとして**exit 2**で拒否する。
  `package.json`の`check` scriptから`src/bootstrap.mjs`／`test/bootstrap.test.mjs`の2項を同waveで除去する
  （残すと`npm run check`が即死する）。docs同期（`docs/01_integration-package.md`のdoctor言及・
  `src/runtime-cli.mjs` docstring・`src/factory-diagnostics.mjs`コメント・dotagents編入plan）も
  同waveの完了条件に含める。
- 根拠: 虚偽を返す診断面は「無い」より悪い（自己保身の禁止と同型）。後継は
  `factory-diagnostics --json`が正本。`--version`は不変。
- ADR 0044 Decision 8の当該文言はこのDecisionで上書きする。characterization／bootstrap testは
  同一waveで退役へ追従する。

### 3. 配布への反映

- 本waveはrepo着地とfull gateまで。**npm publish（v0.2.0）は別途H承認**を得てから行う
  （公開済みv0.1.0はdoctor面を含むが、虚偽内容の露出はfactory-diagnostics併存下の残存期間として許容し、
  unpublish・上書きをしない＝README変更管理の作法）。

## Consequences

- stderr envelopeのschema値が`lattice.cli_error.v1`→`v2`へ変わる。既知の外部消費者は無し
  （dotagents側grepで依存0・Lattice自testのみ＝同waveで更新）。
- `doctor --json`を叩く旧習慣はexit 2で即時に見える形で壊れる（silent lieからloud failへ）。
