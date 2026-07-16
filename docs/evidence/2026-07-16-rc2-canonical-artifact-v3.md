# RC2 canonical artifact v3／plan v4 closed loop

- 実行日: 2026-07-16
- corrected source commit: `68b23ee292546ddd7db12ec7c0fd3bc871849469`
- artifact commit: `3c3b34b12b8d22fa0a5f8208aadc2eb3e7561e48`
- Decision: [ADR 0041](../adr/0041-rc2-artifact-semantic-oracle-mutation-binding.md)
- canonical root: `research/campaigns/rc2/artifacts/v3`

## Atomic publication

clean source commitを`baseRef=HEAD`、`artifactVersion=v3`として正規campaignを一度だけ実行した。accepted transaction、6 fresh
Codegraph worktree runs、全condition compile、plan barrier、pure artifact verificationが成功した後だけ、writerは`.v3-write-*`から
canonical rootへatomic renameした。発行後にtemporary rootは0、canonical rootはmanifestを含む76 filesだった。v1／v2 rootのtracked
diffは0である。

| artifact field | value |
|---|---|
| manifest schema／payload | `lattice.rc2.artifact_manifest.v3`／75 unique paths |
| manifest SHA-256 | `31bb32689722c453ef99a893af9a33406529687c359a3a1a35552d6cb29af858` |
| result digest | `4e9c7d3b076da1a041cac9b2ccd2a668bedac8de58ff7c86c2b80ddbf306ab2a` |
| execution identity digest | `0f68976e99b06bdc9ae46518954f1ea4a457f81a8aea9d633bf1dc1e99314ae4` |
| accepted transform digest | `4c74044ed7820cd6a7135ac50204fafbff498e90ae128122f2f0fae9058f7257` |
| patch | 8 files／11,307 bytes／203 review lines／`51f772a408ec397e297e2e0999592374ce3bb3ff3de4e830bd63de1e2c81a5cc` |
| measured cost | 50 stages／43,771.214 ms、not measured 0 |
| rework | rejected 2／retry 0／rollback 0 |

ADR 0041、本P1 characterization、v2 manifest、v2 planを保存predecessorと`cmp`した結果は全件byte-exactだった。

## Semantic transform evidence

- candidate digest: `4cc5d7bb428a8899353d18524c25105742fa90f89ee55d36064c4be3c52e2907`
- fixed case-set digest: `2282f604528e9ff356290a1e26114f1d0478c822c29f64ca91d3e057db8a936c`
- pre／post oracle digest: 両方`c47d80c1c08243722f3b73d264b6548214f7c7d9ca435e2a514f5d23f3d653e7`
- mutation matrix: exact 6 rows／24 cells、matrix digest
  `e3c64c3deac7c3473d0827d4b9aafb77452585c17bbd1bd7a6a47d65132e9743`
- behavior evidence digest: `3154b68af40951dfda0a644678f5db1ca0a8b0c6968443d73bb55eed84e31f1c`
- mutation evidence digest: `eb3febc813a8554b83d77957009579d295539738b12ce7e4a9cb0fcfea6d1d02`

transformは8 exact allowlisted pathsだけを変更した。oracle sourceはallowlist外で、candidate、control／output snapshot、保存identity、decoded
source bytesへcross-bindされた。incomplete transformとscope violationの2 controlはtyped rejected artifactになり、accepted predecessorへ
混入していない。

## Control／treatmentとtransfer

全6 runは`fresh_index=true`、異なるisolation identity、同じCodegraph identity／query setを持つ。

| condition | conflict records | distinct pairs | minimum waves |
|---|---:|---:|---:|
| primary control | 12 | 3 | 3 |
| primary treatment | 0 | 0 | 1 |
| primary treatment＋partial state | 1 | 1 | 2 |
| primary treatment＋capacity 2 | 0 | 0 | 2 |
| RC1 transfer control normal | 3 | 1 | 2 |
| RC1 transfer treatment normal | 0 | 0 | 1 |
| RC1 transfer control negative | 4 | 1 | 2 |
| RC1 transfer treatment negative | 1 | 1 | 2 |

third-only unknownはplanを発行せずtyped unknownを維持した。hypothesis evaluationは9／9 passed、failed conditions 0だった。

## Plan version barrier

plan `rc2-delivery-policy-v4`はimmutable v2 artifact内の`rc2-delivery-policy-v3`をpredecessorにし、3 TODO全件を同じtreatment
bundleから再compileした。plan file SHA-256は`a4a9753c940a93453cfd2eb2b77fd4ecd47b39ac1a0029749a4c397fdbeb23c4`、
plan digestは`716c65de072520b6cfe229345ff3d4e8be0d2a016a9b0439c0e73e3114b4a05d`、causal predecessorsは35である。

旧plan、agent context、partial patch、interface assumption、boundary evidenceの5種をすべてv3 refで失効した。v3 planへの追記で
v4を作っていない。

## Disk replayとpost-publication index

canonical commit後にin-memory resultを使わずdisk-only verifierを再実行した。

| version | checks | result |
|---|---:|---|
| v1 | 14 | valid、failed 0 |
| v2 | 15 | valid、failed 0 |
| v3 | 15 | valid、failed 0 |

main Codegraphは発行直後からpending 0だったが、それだけでcoverageを仮定せず明示`codegraph sync .`を実行した。結果は`Already up to
date`。最終状態はCodegraph 1.4.1、76 files、1,926 nodes、7,405 edges、pending added／modified／removed 0、index complete、pending
refs 0、worktree mismatch `null`だった。`codegraph files`でlive oracle／artifact verifier／campaign／campaign testを確認し、tracked
`codegraph.json`が除外する`artifacts/v3/identity/`収載は0だった。

## Related gate

source／artifact収束後に次を一回実行した。

```text
node --test test/rc2-campaign.test.mjs test/rc2-delivery-policy-fixture.test.mjs \
  test/rc2-delivery-policy-front-end.test.mjs test/rc2-delivery-policy-transform.test.mjs
```

結果は38 pass／0 fail／0 cancelled／0 skipped／0 todo、47.643秒。3 semantic reseal corruption、v1／v2 compatibility、v3 writer、
oracle、front-end、isolated transformを含む。

full gateは[semantic binding full CI](2026-07-16-rc2-semantic-binding-full-ci.md)へ分離した。dotagents／Observer関連repo write、
remote作成、push、publishは0。
