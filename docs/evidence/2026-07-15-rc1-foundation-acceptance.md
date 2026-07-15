# RC1 foundation acceptance evidence

- 実施日: 2026-07-15
- plan version: `lattice-research-campaign-1-v2`
- Control: `lattice-rc1-closed-loop-v3` revision 30
- 親Decision: [ADR 0006](../adr/0006-rc1-foundation-contracts-accepted.md)
- source commits: RC1-A `c49a4bc`、RC1-B `24c9541`、RC1-C `3fd1856`

## Scope and placement

- RC1-AはF。後続artifact全体がbyte互換と論理不変条件へ依存するため親直轄とした。
- RC1-B／CはA。execution-verified native implementerを専用worktreeへ配置し、非交差の各2fileだけを書かせた。
- dotagentsはControl CLI／manifestのread-only利用だけ、Observer関連repoは未参照・未編集である。
- remote作成、push、publishは実施していない。

## Source boundary evidence

preflightでは`canonicalizeArtifact`、`collectCodegraphEvidence`、`runIsolatedTransform`が未存在だった。queryはJSON `[]`、
caller／callee／impactはtyped `symbol_absent`、planned sourceのaffected testは`empty`であり、依存なしではなく
`new_surface_unknown`として保持した。

integration後に同じowned symbol群を再index／queryした結果は次のとおり。

| observation | result |
|---|---|
| Codegraph | 1.4.1、13 files、154 nodes、603 edges |
| index | complete、pending changes／refs 0、worktree mismatchなし |
| 3 public symbols | query／caller／callee／impactが全て`ready` |
| affected tests | 各sourceから対応するfocused testを1件ずつ取得 |

raw typed payloadは
[foundation-post-index.json](../../research/campaigns/rc1/evidence/foundation-post-index.json)へ保存した。

- canonical payload digest: `4f8e5ff00cdb35f84be1330a4d8ef0396881427b19156e7c0286993fce9bf5fd`
- canonical bytes: 11,579
- pretty JSON file SHA-256: `4198a16a7c10de19616acc878442fdfafdd7da97501e10f1a5d76e11df2b98b7`

このfoundation query setは基盤API検収専用であり、RC1のcontrol／treatmentに固定した
`research/campaigns/rc1/inputs/query-set.json`を変更していない。

## Verification

| TODO | gate | result | parent audit |
|---|---|---|---|
| RC1-A | focused unit＋schema rejection | 6 pass／0 fail／0 skip | conflict resource、seam ownership、wave順、old-plan失効の矛盾rejectを追加 |
| RC1-B | focused fake＋実Codegraph | 6 pass／0 fail／0 skip | status実shape、ANSI不在文、固定query setをlive確認 |
| RC1-C | focused temp-repo integration | 7 pass／0 fail／0 skip | ignored write、verifier mutation、source leak複合failureをadversarial再現 |

全moduleとtestの`node --check`、各diff checkは成功した。full `npm run ci`は未実行をgreenへ丸めず、RC1-Gの
Phase gateで1回だけ実行する。

## Rework and Control receipts

- RC1-A: Control Taskはtest-first開始後のrevision 23で登録した。事後登録をWorker実行証拠には使わず、親diff、focused
  gate、source commit、ADRだけを受入根拠にした。revision 28でTask finalizationを記録した。
- RC1-B: 実装を2回差し戻した。最終claims digest
  `194b01dc1f5983bf922926539103d022c2c50cc9387a986c887add136c3fd583`を親が再計算し、revision 24でstrict import、
  revision 26でaccept、revision 29でTask finalizationを記録した。
- RC1-C: 実装を2回、claims digest不一致を1回差し戻した。親はReportをsilent normalizeしなかった。最終claims digest
  `a9484281f0e45c117f09e39569a7aa11b856c4aa41a61bf7c4c905c6c343b5ca`を再計算し、revision 25でstrict import、
  revision 27でaccept、revision 30でTask finalizationを記録した。
- revision 30時点で3 Worker Runはcompleted＋accepted、RC1-X／A／B／Cの4 Taskはfinalizedである。

## Residual unknowns

- canonical JSONはRC1固有で、RFC 8785や他言語byte互換をまだ検証していない。
- Codegraph 1.4.1の公開shape変更はfail closedに`unresolved`となる。version横断互換は未実装である。
- isolation runnerのcleanup強制失敗、symlink／submodule／特殊fileの個別integration、process timeout／output上限は未検証。
  RC1-Eの固定fixtureで必要な実変換gateと、一般transform基盤の完成を混同しない。
