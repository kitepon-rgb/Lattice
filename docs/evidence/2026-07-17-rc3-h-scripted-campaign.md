# RC3-H — scripted closed-loop campaign

- 日付: 2026-07-17
- plan: [plan_lattice_rc3_runtime_vertical_slice.md](../plan_lattice_rc3_runtime_vertical_slice.md) RC3-H節・条件表
- 契約: ADR 0044 Decision 10（artifact root・atomic no-overwrite・identity純度）・11（RC2再利用とseam binding）
- Control: `lattice-rc3-runtime-v1`（task `RC3-H-scripted-campaign-v1`、review run `RC3-H-implementation-review-run-01-v1`）
- 正典artifact: `research/campaigns/rc3/artifacts/v1`（atomic発行済み・disk再検証54 check green）

## 実行構成

dogfood scaffold（RC2 fixture 3点のHEAD blob複製、oracle digest binding済み）上で8条件を実行した。
scaffold上の6条件は**同一base sha・同一TODO集合（TA/TB/TC）・同一capacity・同一query構造のrequest
template**を使い、条件の注入（実write・unknown宣言・state witness・stale提出）だけを可変にした。

> 解釈の記録: plan「同一request」の字義どおりの単一request bytesは、条件表が注入
>（unknown追加・shared state witness追加等）をrequest内容の差として定義しているため両立しない。
> 「同一base・同一template・注入のみ可変」を運用解釈として採り、accepted_seam（predeclared
> treatment topology）とevent_corruption（clean条件のevent列を対象とするmeta条件）は条件表の
> 定義どおり独自形とした。字義解釈の再裁定はRC3-J ADRの評価残に含める。

| condition | 実測結果 | 保存物 |
|---|---|---|
| clean_parallel | hold 0・全TODO受理・run_closed | events/plan/request/record |
| late_path_conflict | exact hold {TA,TB}・TC continue（witness）・TCのvN+1受理まで完走 | +manifests/hold-decision/plan-diff/new-plan |
| scope_violation | offender closure {TA} hold・TB continue | +manifests/hold-decision |
| semantic_unknown | BOUNDARY_UNKNOWN非発行＋**drift対照**（固定誤宣言→AFFECTED_TEST_DRIFT） | request/record |
| stale_receipt | 旧epoch receipt typed reject・stale由来accepted 0 | events/plan(new)/manifests |
| irreducible_conflict | 実行中発見→hold {TA,TB}→recompile（conflict保持・precedence偽装なし）→vN+1 serial完走 | +hold-decision/plan-diff/new-plan |
| accepted_seam | RC2無改変adapterでaccepted→patch commit→`codegraph sync`→conflict/wave減少・epoch 2 plan（predecessor=pre plan+transform digest） | +transform-artifact/pre-plan/post-plan、patchはidentity/ |
| event_corruption | tamper/gap/fork/duplicate/unknown kindを**typed** failed conditionsでreject | +corruption-variants（変異bytes保存） |

cost観測（実wall-clock）はcampaign-manifestの`cost_observations`に保存（捏造・丸めなし）。

## artifact-only verifier

`verifyRc3CampaignArtifactsOnDisk`は保存bytesだけから再計算する:
8条件の固定順完全性、record digest、**期待/実測の再比較**（保存matchedを信じない）、
**record.actual主張（hold/accepted/closed/carried_over）のevents再計算**（coordinated改竄遮断）、
event chain、dispatch replay（epoch-scoped）、receipt裁定再計算、hold裁定再計算（hold_decided直前prefix）、
corruption変異bytesのtyped再判定、path containment。integration testはmanifest空化・coordinated再封印・
無調整改竄・上書き発行の各否定ケースを固定した。

## 異provider review（commit前）

codex-sidecar `codex_review`（gpt-5.6-sol×high）が8 finding（P0×1・P1×6・P2×1）を返した。裁定:

- **P0採用**: verifier偽装可能（空manifest・意味再検証なし）→上記の硬化一式。
- **P1採用**: receipt replay片側包含→双方向・hold replay強化＋scope条件の保存拡充、
  request template統一（6条件）＋解釈のevidence記録、seamのepoch 2 predecessor binding＋
  transform artifact/pre/post plan/patchの保存（2 namespace記録付き）、late/serialの閉ループ完走
  （vN+1受理・intentional serial redispatch）、drift対照（probe由来宣言のtautology反証）、
  corruptionのartifact-backed化＋duplicate/unknown kind＋typed比較。
- **P2採用**: atomic発行を同一filesystem staging＋exclusive mkdir＋不在確認＋失敗時cleanupへ。
- **評価残（RC3-J）**: 同一requestの字義解釈の再裁定、fsync耐久性、seamのCodegraph coverage完全replay、
  並行発行の競合test、freeze保留executorのworktree残存の掃除方針。

## 検証

- integration: `test/integration/rc3-scripted-campaign.integration.mjs` 7 green（campaign 2回実走を含む）。
- 正典artifact: `research/campaigns/rc3/artifacts/v1`をdisk再検証54 check green、identity payloadの
  Codegraph index非混入を確認（`codegraph files`照合）。
- related gate: RC3対象＋worktree/rc2-scope integration＝39 test green、`npm run check` pass。
