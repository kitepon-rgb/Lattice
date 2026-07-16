# RC2 semantic binding source編集前Codegraph preflight

- 観測日: 2026-07-16
- 対象commit: `9d0822ba5cf3204d876fe2950a832c848d77d340`
- 対象Task: `RC2-H1c0-semantic-binding-codegraph-preflight-v1`
- Decision: [ADR 0041](../adr/0041-rc2-artifact-semantic-oracle-mutation-binding.md)

## Index freshness

最初の`codegraph status . --json`はCodegraph `1.4.1`、76 files、1907 nodes、7265 edges、state `complete`、pending changes 0を
返した。しかし`codegraph files --json`の`test/rc2-campaign.test.mjs`は22,158 bytes／27 nodesで、actual fileは27,767 bytesだった。
さらにcommit済み`resealSemanticTransformCorruption`のexact queryが`[]`だった。したがってpending 0をfreshness証拠へ丸めなかった。

明示`codegraph sync .`は`Modified: 1 — 31 nodes`を返した。sync後は同testが27,767 bytes／31 nodesになり、helper exact queryも
`test/rc2-campaign.test.mjs:158`を返した。最終状態は次のとおり。

| field | value |
|---|---:|
| Codegraph | `1.4.1` |
| files | 76 |
| nodes | 1911 |
| edges | 7321 |
| pending changes | added 0／modified 0／removed 0 |
| index state／pending refs | `complete`／0 |
| worktree mismatch | `null` |

`codegraph files`でoracle、front-end、transform、artifact verifier、campaign、campaign testのlive path収載を確認した。tracked
`codegraph.json`が除外する`research/campaigns/**/artifacts/**/identity/`はlive sourceではなくimmutable payloadなので、今回も除外を維持する。

## Owned symbol boundary

| exact symbol | definition | caller／callee | impact |
|---|---|---|---:|
| `runRc2DeliveryPolicyOracle` | `src/rc2-delivery-policy-oracle.mjs:88` | callers: fixture test、`observeOracleMismatch`、seam transform、fresh index observer。callees: entrypoint、child process、receipt parser、`CASES`等7 | 12 nodes／13 edges |
| planned `expectedRc2DeliveryPolicyOracleReceipt` | absent (`query=[]`) | caller／calleeは未作成 | planned symbol unknown。依存なしではない |
| `runMutationMatrix` | `src/rc2-delivery-policy-transform.mjs:648` | caller: seam transform。callees: mutation cell／oracle mismatch／snapshot／`TEST_CONTRACTS`／`MUTATIONS`等9 | 5／4 |
| `runRc2DeliveryPolicySeamTransform` | same file `:951` | callers: transform test、campaign `runTransforms`。callees: candidate validation、oracle、isolation、matrix等20 | 5／4 |
| `compileDeliveryPolicyBoundaryBundleV2` | `src/rc2-delivery-policy-front-end.mjs:1020` | callers: front-end test、artifact recompute、campaign compile。callees: candidate／snapshot／Codegraph evidence validation、boundary compiler等15 | 11／13 |
| `verifyTransform` | `src/rc2-artifact-set.mjs:380` | caller: artifact verifierだけ。callees: `stripDigest`、`sha256`、`digestArtifact`だけ | 6／5 |
| `verifyRc2CampaignArtifactSet` | same file `:1074` | callers: writer、disk verifier、campaign test。callees: identity、transform、run、compile、predecessor、version、cost等17 | 6／7 |
| `captureExecutionIdentity` | `src/rc2-campaign.mjs:217` | caller: campaign。callees: source／Codegraph identityとdigest | 2／1 |
| `buildVersionBarrier` | same file `:858` | caller: campaign。callee: `digestArtifact` | 2／1 |
| `runRc2Campaign` | same file `:1143` | structural callersは空。callees: input／predecessor／identity／transform／fresh index／compile／version等20 | 1／0 |
| `writeRc2CampaignArtifacts` | same file `:1386` | caller: campaign test fixture。callees: artifact files、pure verifier、durable write／rename | 3／3 |
| `verifyRc2CampaignArtifactsOnDisk` | same file `:1458` | caller: campaign test。callees: version path、canonical manifest、pure verifier | 2／1 |

`validateCandidateSpec`はdelivery-policy front-endとRC1 transfer front-endに同名symbolがあり、query／caller／callee／impactが2 definitionを
混合した。これをdelivery-policy exact証拠には使わない。exact `compileDeliveryPolicyBoundaryBundleV2`のcalleeと実file読解により、対象owned
functionは`src/rc2-delivery-policy-front-end.mjs:225`、candidate／oracle anchorは同file `:17`／`:19`と確認した。

`runRc2Campaign`のcaller空も「consumerなし」ではない。campaign testはmoduleをdynamic importしてexportを呼ぶため、path-level affectedと実importを
優先する。

## Affected testsとmanual consumer

| planned changed path | Codegraph affected tests | disposition |
|---|---|---|
| `src/rc2-delivery-policy-oracle.mjs` | campaign、fixture、transform tests／traversed 6 | oracle export／source digest gate |
| `src/rc2-delivery-policy-front-end.mjs` | campaign、front-end tests／traversed 4 | candidate／oracle digest anchor |
| `src/rc2-delivery-policy-transform.mjs` | campaign、transform tests／traversed 4 | accepted candidate anchor |
| `src/rc2-artifact-set.mjs` | campaign test／traversed 2 | semantic verifier owner |
| `src/rc2-campaign.mjs` | campaign test／traversed 1 | artifact v3／plan v4 owner |
| `research/campaigns/rc2/inputs/candidate-spec-v1.json` | 0／0 | JSON非収載。dynamic file consumer unknownをmanual確認 |

candidate JSONのaffected 0は依存なしではない。`rg`でcampaignの`PRIMARY_INPUT_FILES`、front-end／transform sourceのexpected digest、
front-end testのinput loader、transform testの`candidateSpec()`が直接consumerだと確認した。したがってfocused／related setは
`test/rc2-campaign.test.mjs`、`test/rc2-delivery-policy-fixture.test.mjs`、`test/rc2-delivery-policy-front-end.test.mjs`、
`test/rc2-delivery-policy-transform.test.mjs`とする。

## State／effectとunknown

- oracleのpure expected-receipt export追加はbehavior期待値を変えないが、source bytes／digestとCodegraph caller topologyを変える。
- fixed oracleはtransform allowlist外であり、seam writerが変更してはならない。candidate source digest、control／output snapshot、saved identityだけを
  new bytesへ同期する。
- front-endはcandidate、source snapshot、Codegraph evidenceをfail-closedで検査する。digest anchor更新を省くとfresh campaignはcompile前にrejectする。
- artifact verifierはpureでcampaign commandを実行しないが、writerとdisk replayのacceptance gateである。
- campaignは後続H1dでdisposable worktree、fresh Codegraph index、atomic no-overwrite artifact rootをeffectとして持つ。H1cのsource実装では
  canonical artifactを発行しない。
- CodegraphはJSON dynamic reads、base64 canonicality、oracle receipt semantics、mutation owner-only sensitivity、saved process outputの真実性、
  atomic filesystem behaviorを証明しない。これらはfocused test、disk replay、fresh campaign evidenceで閉じる。
- planned oracle exportはabsent、duplicate function nameはambiguous、campaign structural callerはemptyである。いずれもunknown／plannedとして保持し、
  source追加後にsyncしてexact queryを取り直す。

## Gate

- source／test変更: 0。preflight evidenceとplanだけを次commitへ含める。
- test: 未実行。preflightのためであり、focused expected-redはcommit `2094c83`の既存証拠を再利用する。
- full CI: 未実行。semantic correctionとartifact v3収束後のPhase gateへ集約する。
- git worktree: clean、stash 0。
- dotagents／Observer関連repo write、remote作成、push、publish: 0。
