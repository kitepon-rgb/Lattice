# RC2 canonical artifact v2

- Date: 2026-07-16
- Decision: [ADR 0040](../adr/0040-rc2-post-publication-codegraph-scope-and-artifact-v2.md)
- Base source commit: `888b32e68c4a960506a24724a9c0a0e47ba81471`
- Artifact commit: `9fa4f29`
- Artifact root: `research/campaigns/rc2/artifacts/v2`
- Scope: Lattice only

## Canonical execution

clean `HEAD === baseRef`で`artifactVersion: "v2"`を明示し、campaignを一度だけ実行した。writerは不存在だったv2 rootへ
atomic renameし、v1 rootへwriteしなかった。

| property | value |
|---|---|
| result schema | `lattice.rc2.campaign_result.v2` |
| manifest schema | `lattice.rc2.artifact_manifest.v2` |
| manifest payloads | 71 |
| files including manifest | 72 |
| disk size | 1,316 KiB |
| manifest raw SHA-256 | `8622b820d74c3bd0fac063affda3fc5449a11c32cf4a424a919337ff93e1f2cf` |
| result digest | `4e9c7d3b076da1a041cac9b2ccd2a668bedac8de58ff7c86c2b80ddbf306ab2a` |
| identity digest | `2ce7df5672b02d554a433c43e3ce5f8e6028a97b4452b936211416ac762066e7` |
| plan version | `rc2-delivery-policy-v3` |
| predecessor plan | `rc2-delivery-policy-v2` |
| plan raw SHA-256 | `f73172e5adf0805cfc68a6c4b14a274c6cf68f5f70b7ea0c8e3e3d510a128241` |
| causal predecessors | 31 |

execution identity before／after digestは共に
`238e7905d1b179bf91717c60f2829aede5f8bfcefacb6f1343a1fc2fba41c785`だった。Codegraph 1.4.1 executable digestと
project config digestを含むCodegraph identity digestは
`c8d1a6d68d47c4193a7c7e5653240acdc7bf36e4037a55896a1dbde3cea60cc9`である。

## Control／treatment

独立変数は引き続きaccepted registry-shard patchだけで、patch digestは
`164472242ac2d40896a891dafec07dd8e04f21502097edf3758b406483c70177`だった。

| condition | conflict records | distinct pairs | minimum waves |
|---|---:|---:|---:|
| primary control | 12 | 3 | 3 |
| primary treatment | 0 | 0 | 1 |
| primary partial state | 1 | 1 | 2 |
| primary capacity 2 | 0 | 0 | 2 |
| RC1 transfer control normal | 3 | 1 | 2 |
| RC1 transfer treatment normal | 0 | 0 | 1 |
| RC1 transfer control negative | 4 | 1 | 2 |
| RC1 transfer treatment negative | 1 | 1 | 2 |

third-only conditionはtyped unknownを維持した。hypothesis evaluationはsupported、failed conditions 0だった。v1とv2のresult digestは
同じであり、artifact exclusion configは両condition共通のmeasurement scopeとして働き、実験結論を変えていない。

## Byte and disk replay

- v2内のcopied v1 manifestはcanonical v1 manifestとbyte-exact一致した。v1 manifest SHA-256は
  `7152dfc3eefdc21d560ed4d8f5a25b644345538abdca0ddfda494cca07608ed6`。
- copied v1 new planもbyte-exact一致した。v1 new plan SHA-256は
  `49092597f6d8fd550b2afd2406eb1b6f9dcf06e22dbc50daad6a2d8d22024fa8`。
- saved `identity/codegraph-config.json`はtracked `codegraph.json`、saved campaign／artifact-set sourcesはruntime sourceと
  それぞれbyte-exact一致した。
- disk-only v1 verifier: valid、14 checks、failed 0。
- disk-only v2 verifier: valid、15 checks、failed 0。

## Post-publication closure

artifact commit後の既存indexはstatusだけで判断せず、`codegraph files`と明示`codegraph sync .`を再確認した。syncは
`Already up to date`、76 files、1,907 nodes、7,265 edges、complete、pending 0、artifact identity 0、live campaign 1だった。
artifact v2を含むcommitからのfresh clone integrationも1 pass / 0 failで、live source収載、artifact identity除外、oracle affected 3 testsを
再確認した。

full `npm run ci`とPhase反証は次のPhase gateへ残している。artifact v1、dotagents、Observer関連repo、remote、push、publishは変更していない。
