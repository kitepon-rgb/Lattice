# RC1-F treatment recompile acceptance evidence

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v3` / RC1-F
- Control: `lattice-rc1-closed-loop-v3` / `RC1-F-treatment-recompile-v3`
- Decision: [ADR 0015](../adr/0015-rc1-treatment-plan-v2-accepted.md)
- classification: F。version barrier、artifact predecessor chain、実験識別性を親が裁定した。

## Outcome

accepted seamをcontrol baseだけへ適用したdisposable worktreeで、同じ10-query setをCodegraph 1.4.1へ2回fresh indexした。
raw outcomesはtemp path／時刻telemetryにより不一致だったが、portable outcomesとnormal／negativeの全compiled artifact、plan diff、
comparisonは一致した。canonical Lattice fixtureへpatchは適用していない。

| 指標 | control | treatment |
|---|---:|---:|
| typed verdict | `seam_candidate` | `parallel_ready` |
| write conflict | 1 | 0 |
| state conflict（normal） | 0 | 0 |
| hard precedence | 0 | 0 |
| minimum feasible waves | 2 | 1 |
| unknown | 4 | 0 |
| Codegraph corpus | 16 files / 208 nodes / 835 edges | 18 files / 214 nodes / 845 edges |

negative controlはcontrolでwrite＋state conflict、treatmentでwrite conflictだけが消え、state conflict 1、
`intentional_serial`、2 wavesを保持した。したがってpath-only parallel判定の反証caseは通過している。

## Fixed inputs and independent variable

- plan input: `c4b64dab54db09f20a7a6ba57003a8d2f444a0c878b9387a2bbc338fa6d87ee3`
- normal manual evidence: `e995b6a7b70ff46b9df383bf15d940ef0d658b4a102e6f18a302a3d4e7851b5e`
- negative manual evidence: `126a55fc5137314f33d54866746913fefee7c8943412d6d0f32460de1b1d79a1`
- query set: `c20c16da335826e1b5e692f6628cb83b6173ee30dd1ee60a1bf3b1d71dc69892`
- capacity: writers 2
- verifier receipt: `893cbf613d0b15a87c3d98638ec371a568dd204a0fe0f8eaf1a17e624d493e7d`
- independent variable: accepted transform `09ef275af54cf4bc4bbd65e08750be6ab22f7febe4d800b3be16548408a4a30d`、
  patch `acefad450f77906d21e1712c710c1ed91e199d9607d7c6703e8378abeb1f92af`

control／treatmentは同じbase SHA `d2d412800492fbed03febe02abc6dca81c09a88b`を使う。treatment compiler／runnerの実装sourceは
index corpusへ混入せず、baseへ加えた差はaccepted patchだけである。

## Artifact identities

| artifact | canonical digest | canonical bytes |
|---|---|---:|
| normal boundary manifest | `cc2761d1d2839f8e309a2c7869e8169bdb964ac63e9e017194c3ed0a2878006a` | 3467 |
| normal boundary verdict | `50269f3b6b89d4b3514be5ed24b9cfe0eb9958cd15337bcb74df744d41820acf` | 401 |
| normal plan v2 | `c3122180b9d1faf95ab49f9a40434b71d9074596548fc57bfe5f07460f1decac` | 783 |
| negative boundary manifest | `778732e8c67ae8fb1123bcd15cdb0c485af26c8a3823e136d171d375e7aaaa11` | 3843 |
| negative boundary verdict | `3a8809a6ffc2e62d6674cdc59860943ed48b812db7445c561ffd44883ead4baa` | 415 |
| negative plan v2 | `928736dc5a82ebca766304b44f428e19f2b896466d4cb0f2adec49f20fd408a7` | 979 |
| plan diff | `52a816d0c2c4243f103a7eee3c118173ffdb4efb17dc2089a27d5134d10dc7b2` | 1906 |
| comparison | `44d32a06ea56db357988ccd1f6e0325683b2b3503412716a151934dbb3ebf738` | 3074 |
| execution evidence | `3fafb388fcb034ffe0d89235fd7d151cb3d7ba44d30471246adac9f92dfb7596` | 8251 |

Machine artifactは`research/campaigns/rc1/artifacts/treatment-v2/compiled/`に置いた。JSON file byteはreview用pretty encodingで、
表はparsed payloadのLattice canonical serializationを示す。本文に絶対pathはない。

## Reindex and reproducibility

- treatment portable outcomes: `9d959e2ad40e4e027b0bb62921436d7b3a6e8139b982af976c7a38b1cac5b6f3`
- raw run digests: `5fa5878bc2d0cc7ebf68840468c850298280aa9ff321f52e27c7bb3d2b72930e`、
  `adf042f1d71e8226f00eac6e749ab59c6857084d431dc47d5a41bac9acab42b0`
- 各runは18 files、214 nodes、845 edges、pending changes／refs 0、worktree mismatchなし。
- 10 queryすべて`ready`。2 seam symbolは各expected moduleへexact解決し、3 sourceすべて
  `test/research-dispatch-record.test.mjs`へ到達した。
- `.codegraph-rc1-treatment`は各run後に削除し、source HEAD／status／ignored status／開始時worktree集合は不変。

## Version barrier

`lattice.plan_diff.v1`は`rc1-control-v1`から`rc1-treatment-v2`を新規生成し、nodeは2 TODOともownership変更、edgeは
`shared-dispatch-boundary`を除去した。old plan、agent context、partial patch、shared interface assumptionの4 contextを失効し、
old planや途中patchへ追記していない。

## Gates and rework

- test-first red: planned 2 module不在でfocused 0 pass / 2 fail。
- focused final: `node --test test/treatment-compiler.test.mjs test/treatment-runner.test.mjs`
  → 5 pass / 0 fail / 0 skip。
- syntax: task対象5 source／test fileがpass。
- related final: `node test/integration/treatment-recompile.integration.mjs` → 2 fresh index、compiled deep equal、raw unequal、
  portable equal、normal 1 wave、negative 2 waves、全cleanup pass。
- artifact generation: commit `52870a5…`から正規runnerをさらに2回実行し、同じidentity digestを再確認した。
- artifact reread: public validators、digest／canonical bytes、predecessor chain、絶対path不在を確認してpass。
- full `npm run ci`: RC1-Gへ集約したため未実行。

最初のrelated runはCodegraphが専用sensor dir内へ作る`.gitignore`をsource patchと誤分類してfailした。sensor prefixだけをindex中に
許可し、source 3 pathはcontent digestで固定、sensor削除後はexact 3 pathへ戻すよう修正した。次の軽量監査でFがE2 execution
evidenceを直接消費していないchain gapを発見し、drift testを赤にしてpredecessorへ追加した。後者のsource変更後にrelated gateを
再実行した。どちらも失敗をgreenへ丸めず、最終artifactへの手補正はない。

## Intervention cost

- E2 accepted transform: 312.125 ms、repeat 265.918 ms。
- F run 1: apply＋verify 101.301 ms、fresh index＋query 2085.276 ms、compile 3.902 ms、total 2243.306 ms。
- F run 2: apply＋verify 85.315 ms、fresh index＋query 2028.915 ms、compile 2.533 ms、total 2163.004 ms。
- rework: sensor scope分類とE2 receipt bindingの2件。いずれもfocused／related failureまたは親のdiff監査から修正した。
- rollback: 各runのdisposable worktreeとsensor DBを削除。canonical source変更がないためcode rollbackは不要。
- review: 親がdiff、受入条件、related gate、artifact chainを1回のTODO監査で確認。review時間は独立計測していないためunknown。

## Success conditions and residual unknown

RC1 success条件1〜7は固定fixtureで満たした。特にnegative control、portable determinism、version barrierまでmachine artifactに含む。
ただしResearch CampaignのPhase gateは未完であり、full CIと独立反証前にcampaign完了とはしない。

- isolation runnerが既存ignored fileのcontent-only mutationを検出できないresidual unknownは残る。
- 単一fixtureから任意repoへの変換成功率、一般的速度改善率、製品価値は推論しない。
- dotagentsとObserver関連repoはread-onlyを維持し、remote作成、push、publishは実施していない。
