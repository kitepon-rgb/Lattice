# RC2 canonical artifact v4／plan v5 closed loop

- 実行日: 2026-07-16
- corrected source commit: `fe75df08d469375703b183ec252955f2854774e7`
- artifact commit: `bf4ba1d4d446ce89d571c05dd5981c49ed90f923`
- Decision: [ADR 0042](../adr/0042-rc2-artifact-version-witness-epoch-and-v4.md)
- canonical root: `research/campaigns/rc2/artifacts/v4`

## Atomic publication

artifact v4はsemantic-v2 witness epochを使うclean source commitから一度だけ正規発行された。immutable v3をpredecessorにし、
version固有candidate／oracle witness、manifest baseと全transform outcome source、plan barrierを検査した後、no-overwriteかつatomicに
canonical rootへ発行した。本引継ぎではcampaignを再実行せず、canonical artifact v4も再生成していない。

| artifact field | value |
|---|---|
| manifest schema／payload | `lattice.rc2.artifact_manifest.v4`／79 unique paths |
| disk files | 80（manifestを含む） |
| manifest SHA-256 | `3919276bdb98676259195f4fda709eba37dffc3632479f729d2c4be1a10186b6` |
| result digest | `4e9c7d3b076da1a041cac9b2ccd2a668bedac8de58ff7c86c2b80ddbf306ab2a` |
| source base commit | `fe75df08d469375703b183ec252955f2854774e7` |
| artifact commit | `bf4ba1d4d446ce89d571c05dd5981c49ed90f923` |

manifest、disk file集合、source base、result digestは発行後のread-only照合でも一致した。v1／v2／v3 artifactとADR 0041／0042は
変更していない。

## Active witnessとtransform source

artifact v4はversion contractにより、v3／v4のactive witnessを次のsemantic-v2 pairへ固定する。

- epoch: `delivery-policy-semantic-v2`
- candidate digest: `4cc5d7bb428a8899353d18524c25105742fa90f89ee55d36064c4be3c52e2907`
- oracle source digest: `c68a7ff9a7c9c4a181ceda6396d5fcbf27084de18680018d244a27998041652c`

accepted transform、rejected incomplete transform、rejected scope transformのsource baseはmanifest baseへbindされ、candidate、oracle、adapter
identityも同じversion witnessへbindされた。v1／v2のlegacy pairはread compatibility用に保持するが、v3／v4としては受理しない。

## Plan version barrier

plan `rc2-delivery-policy-v5`はimmutable v3 artifact内の`rc2-delivery-policy-v4`をpredecessorにし、email／sms／pushの3 TODOを
fresh treatment evidenceから再compileした。

| plan field | value |
|---|---|
| plan file SHA-256 | `cbb9be9b0db4168396de12d9db1e041362b2e4da7200d38307da897512b2093b` |
| plan version | `rc2-delivery-policy-v5` |
| predecessor | `rc2-delivery-policy-v4` |
| causal predecessors | 39、exactly once |
| affected TODOs | `email-policy`／`sms-policy`／`push-policy` |
| invalidated contexts | 5 |

失効した保存集合は旧plan、旧agent context、旧partial patch、旧interface assumption、旧boundary evidenceである。旧planへ追記せず、
v4 refsを持つ新versionとしてbarrierを越えた。

## Disk replayとpost-publication index

canonical commit後にin-memory resultを使わず、保存artifactをversion-aware verifierで再生した。

| version | checks | result |
|---|---:|---|
| v1 | 14 | valid、failed 0 |
| v2 | 15 | valid、failed 0 |
| v3 | 15 | valid、failed 0 |
| v4 | 15 | valid、failed 0 |

発行後に明示したfresh Codegraph再indexと`codegraph files` coverage照合を行った。最終状態はCodegraph 1.4.1、77 files、1,955 nodes、
7,522 edges、pending added／modified／removed 0、state `complete`、pending refs 0、worktree mismatch `null`だった。
`V4_PREDECESSOR_PATHS`と`loadV3PlanPredecessor`は返却symbol名とpathのexact一致を確認し、artifact v4 identity sourceの収載は0だった。

## Related gate

source／artifact収束後、次の5 test fileを一回だけ実行した。

```text
test/rc2-artifact-version-witness.test.mjs
test/rc2-campaign.test.mjs
test/rc2-delivery-policy-fixture.test.mjs
test/rc2-delivery-policy-front-end.test.mjs
test/rc2-delivery-policy-transform.test.mjs
```

結果は40 pass／0 fail、約53.17秒。世代不整合の負例、v1〜v4 compatibility、canonical writer、oracle、front-end、isolated
transformを含む。related gateは再実行していない。full gateと最初の期待値差分は
[version witness full CI](2026-07-16-rc2-version-witness-full-ci.md)へ分離した。

dotagents／Observer関連repo write、remote作成、push、publishは0。
