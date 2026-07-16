# RC2 version witness source編集前Codegraph preflight

- 観測日: 2026-07-16
- 対象commit: `1f1347f27eb20313387ee0eb7830bbde66cf161c`
- 対象Task: `RC2-H2d-version-witness-codegraph-preflight-v1`
- Decision: [ADR 0042](../adr/0042-rc2-artifact-version-witness-epoch-and-v4.md)

## Index freshness

`codegraph status . --json`と`codegraph files --json`を照合した。新規characterization testは実fileとindexの双方で6,886 bytes、
20 nodesだった。`resealV2AsV3`のexact queryは`test/rc2-artifact-version-witness.test.mjs:67`を返した。明示
`codegraph sync .`は`Already up to date`を返し、sync後の状態は次のとおり。

| field | value |
|---|---:|
| Codegraph | `1.4.1` |
| files | 77 |
| nodes | 1946 |
| edges | 7474 |
| pending changes | added 0／modified 0／removed 0 |
| index state／pending refs | `complete`／0 |
| worktree mismatch | `null` |

`codegraph files --filter research/campaigns/rc2/artifacts`は収載file 0を返した。artifact内のJSON／Markdown／patchはlive source graphではなく、
保存`identity/*.mjs`はtracked `codegraph.json`の除外対象である。この空結果をartifact consumerなしとは解釈しない。

## Owned symbol boundary

| exact symbol | definition | caller／callee | impact |
|---|---|---|---:|
| `artifactContract` | `src/rc2-artifact-set.mjs:256` | caller: `artifactContext`。callees: v1／v2／v3 path、identity、predecessor constants 9 | 3 nodes／2 edges |
| `verifyTransformSemantics` | same file `:573` | caller: `verifyTransform`。callees: expected mutation、oracle receipt、digest、saved identity等13 | 3／2 |
| `verifyTransform` | same file `:670` | caller: pure verifier。callees: semantic verifierとdigest helpers 4 | 7／7 |
| `verifyRc2CampaignArtifactSet` | same file `:1402` | callers: writer、disk reader、campaign test、新version test。callees: context、identity、transform、run、compile、predecessor、version、cost等17 | 7／9 |
| `captureExecutionIdentity` | `src/rc2-campaign.mjs:231` | caller: campaign。callees: source／Codegraph identity、digest等9 | 2／1 |
| `buildVersionBarrier` | same file `:872` | caller: campaign。callee: `digestArtifact` | 2／1 |
| `runRc2Campaign` | same file `:1157` | structural callers 0。callees: input、predecessor、identity、transform、fresh index、compile、barrier等20 | 1／0 |
| `writeRc2CampaignArtifacts` | same file `:1400` | callers: campaign test fixture。callees: exact files、pure verifier、durable write／rename等12 | 3／3 |
| `verifyRc2CampaignArtifactsOnDisk` | same file `:1473` | caller: campaign test。callees: version paths、canonical manifest、pure verifier等6 | 2／1 |
| `compileDeliveryPolicyBoundaryBundleV2` | `src/rc2-delivery-policy-front-end.mjs:1025` | callers: artifact recompute、campaign compile、front-end test。callees: candidate／snapshot／Codegraph validationとcompiler等15 | 12／14 |
| `runRc2DeliveryPolicySeamTransform` | `src/rc2-delivery-policy-transform.mjs:951` | callers: transform test、campaign。callees: candidate、oracle、isolation、matrix等20 | 5／4 |
| `resealV2AsV3` | `test/rc2-artifact-version-witness.test.mjs:67` | caller:同test。callees: payload、canonical JSON、causal refresh、digest等7 | 2／1 |

`verifyTransform` queryはexact definitionに加え`verifyTransformSemantics`を低scoreで返した。表はname／path exact一致の前者だけを採用した。
`runRc2Campaign`のcaller 0もconsumerなしではない。campaign testはmoduleをdynamic importしてexportを呼ぶ。

`validateCandidateSpec`はdelivery-policyとRC1 transferの2 definitionを同じquery／caller／callee／impactへ混合したため、delivery-policy exact証拠には
使わない。`compileDeliveryPolicyBoundaryBundleV2`のcalleeと実fileから対象を
`src/rc2-delivery-policy-front-end.mjs:229`と確認した。front-endはlegacy candidate／oracle pairとsemantic pairの双方をread-compatibleにし、
transform producerはsemantic candidate digestだけを受理する。この分離は変更しない。

## Planned source boundary

### `src/rc2-artifact-set.mjs`

- artifact versionからpath／identity／predecessorだけでなくexact candidate／oracle witness epochを選ぶ。
- v1／v2はlegacy pair、v3／v4はsemantic pairを要求し、front-endのread compatibilityとは分離する。
- accepted／rejected transformのcandidate、oracle、adapter、control snapshot、`source.base_sha`を相互およびmanifestへcross-bindする。
- v4 exact path set、v3 predecessor pair、plan v5 barrierを追加し、v1／v2／v3 verifier契約を残す。

### `src/rc2-campaign.mjs`

- writer targetをv4、execution identity／manifest schemaをv4、planをv5へ進める。
- v3 manifest／plan、本ADR、version-contract evidenceの4 predecessorを追加し、39 predecessorへ再compileする。
- v3 planをpredecessorとしてexact検査し、disk readerをv1〜v4へ加算する。
- atomic no-overwrite writerは新rootだけを対象にし、v1／v2／v3を変更しない。

front-end、oracle、transform、candidate inputはsource変更対象外。semantic candidate／oracle bytesはv3とv4で同じepochを使う。

## Affected testsとmanual consumer

| planned／observed path | Codegraph affected tests | disposition |
|---|---|---|
| `src/rc2-artifact-set.mjs` | version witness、campaign／traversed 3 | witness acceptance owner |
| `src/rc2-campaign.mjs` | campaign／traversed 1 | v4 writer／plan v5 owner |
| `src/rc2-delivery-policy-front-end.mjs` | version witness、campaign、front-end／traversed 5 | read-only boundary確認。変更しない |
| `src/rc2-delivery-policy-transform.mjs` | campaign、transform／traversed 4 | semantic producer確認。変更しない |
| `test/rc2-artifact-version-witness.test.mjs` | self／traversed 0 | focused acceptance test |

`research/campaigns/rc2/inputs/candidate-spec-v1.json`はCodegraph symbol graphの対象外だが、campaign `PRIMARY_INPUT_FILES`、front-end validator、
transform test loaderがdynamic consumerである。空結果を依存なしへ丸めない。H2e focused gateはversion witness testとcampaign test、H2f related gateは
fixture、front-end、transform testも含める。

## Unknown／absent

- planned `V4_PREDECESSOR_PATHS` queryはv1／v2／v3 constantsへfuzzy解決した。exact v4 symbolはabsent。
- planned `loadV3PlanPredecessor` queryは`loadV2PlanPredecessor`へfuzzy解決した。exact symbolはabsent。
- planned epoch label `delivery-policy-semantic-v2` queryは`[]`。artifact contractへの追加前なのでabsent。
- Codegraphはbase SHA、base64 canonicality、saved source bytes、JSON digest relation、atomic filesystem behaviorを証明しない。
- campaign structural caller空、dynamic JSON consumer、unsupported artifact file 0はいずれもno dependencyへ変換しない。

## Gate

- source／test変更: 0。preflight evidenceとplanだけを次commitへ含める。
- test: 未実行。H2c focused expected-red commit `1f1347f`を再利用した。
- related／full CI: 未実行。sourceとartifact v4収束後のgateへ集約する。
- git worktree: preflight開始時clean、stash 0。
- dotagents／Observer関連repo write、remote作成、push、publish: 0。
