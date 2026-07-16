# RC3-I — actual multi-agent dogfood

- 日付: 2026-07-17
- plan: [plan_lattice_rc3_runtime_vertical_slice.md](../plan_lattice_rc3_runtime_vertical_slice.md) RC3-I節
- 契約: ADR 0044 Decision 9.5（H gate・disposable dogfood target・opaque handle・重複dispatch禁止）
- Control: `lattice-rc3-runtime-v1`（H task `RC3-I-actual-dogfood-v1`、approval snapshot付き、rev 71）
- 正典artifact: `research/campaigns/rc3/artifacts/v2`

## H gate

オーナー承認（2026-07-17チャット「全部承認」）をH taskのapproval snapshot
（purpose／impact／rollback／operation digest）としてControlへ記録してからdispatchした。
provider=Claude implementer subagent（sonnet）、書込はtmpdir配下のdisposable worktreeと
Lattice内artifact/evidence/docsに限定、canonical worktree・remote・credentialへの接触なし。

## 実行記録（一回性の実観測）

driver（`src/rc3-actual-dogfood.mjs`）は状態fileベースのstep関数で、runtime stateを
event列だけから再構成する。実行系列:

1. dogfood scaffold＋plan compile（epoch 1、TA=fixture entry／TB=oracle／TC=shared test、
   fresh Codegraph観測から）→ worktree 3面provision → dispatch（frontier=verifier再計算と一致）。
2. **actual executor 3体**を各worktreeへdispatch（opaque provider handleはprovider ledgerのみに保存。
   core eventsへのprovider handle混入なしはartifact verifierが検査）。TAには**既知注入**として
   scope外のoracle writeをtask packetに含めた。
3. dispatch直後のin-flight観測を`unknown_in_flight`として記録し、回収は**同一provider handle**の
   完了通知だけで行った（新handleの重複起動なし）。
4. TC: 実diffからcleanなcheckpoint。**重複dispatch probe**: TA稼働中の再dispatchをtyped拒否。
5. TA: 実diffが`scope_violation`（oracle rogue write）と`observed_write_conflict`（TA×TB）を露呈
   → conflict_found＋intake_frozen。
6. hold裁定: **exact hold {TA,TB}・continue {TC}**（witness実証付き、verifier再計算と一致）→
   intentional serial lane → plan vN+1（epoch 2、late conflict edge追加）→ 全context失効＋TC rebind。
7. TC: rebind後のepoch 2 receiptで**carry-over受理**（実executor出力のvN+1へのdigest bind完走）。
8. **stale receipt probe**: TB旧epoch receiptをvN+1へ提出→typed reject（epoch_mismatch）・
   stale由来のaccepted 0。
9. redispatch: TA（attempt 2、新context packet）→受理→TB（attempt 2）→受理。conflict edgeにより
   **serial実行**（TB epoch 2 dispatchはTA epoch 2受理の後、event sequenceで証明）。
10. run close（accepted {TA,TB,TC}）、worktree残存0、artifact v2をatomic発行。

## provider観測の分離

- `provider-runs.json`: dispatch/terminal/unknown/retry系譜と**実測duration_ms・tool_uses**
  （epoch1: TA 35791ms/6・TB 29970ms/4・TC 26969ms/3、epoch2: TA 28087ms/5・TB 27395ms/4）。
- `probes.json`: 重複dispatch拒否・stale receipt reject・残存worktree（0件）。
- scripted campaign（artifact v1）との差: actualはexecutor実行が非決定論的wall-clockを持つが、
  core event chainの裁定（hold/continue/receipt/frontier）はscriptedと同一規則で再計算一致した。
  provider差はledger側にのみ現れる（成功条件の分離要求どおり）。

## 検証

- artifact-only: `verifyActualArtifactOnDisk` 16 check green（document digest・event chain・
  epoch別dispatch replay・hold replay・receipt replay・provider handle非混入）。
- integration: `test/integration/rc3-actual-dogfood.integration.mjs` 3 green（commit済みbytesの再検証）。
- `npm run check` pass（driver module追加済み）。

## 監査の扱い

RC3-I driverはRC3-D〜Hでreview済みのruntime primitivesの薄いorchestrationであるため、
条項「重い監査はPhase完了時に1回」に従い、独立反証はRC3-JのPhase反証（H1-RC3＋全成功条件）へ
集約する（監査増殖の防止。この判断自体を本記録に残す）。

## 未検証・持ち越し

- Control台帳への実行記録は、5 dispatchを個別Worker Runとせず、H taskのfinalizeと
  artifact digestで代表させた（dispatch粒度の一次記録はartifact v2のprovider ledgerが正）。
  この粒度選択はRC3-J Phase反証の確認対象に含める。
- 異provider actual executor（Codex等）の混成dogfoodは非目標のまま（provider多様性はRC3の
  claim対象外）。
