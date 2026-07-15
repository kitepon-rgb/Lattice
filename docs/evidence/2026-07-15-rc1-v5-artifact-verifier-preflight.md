# RC1 v5 artifact verifier preflight

- 日付: 2026-07-15
- 対象HEAD: `7d1bae965a2cc61964deaecbbb8eac51aa26150e`
- Control: `lattice-rc1-closed-loop-v3` revision 108
- Task: `RC1-Q-artifact-verifier-characterization-v5`
- 分類: F。保存artifactの同一性、compiler replay、plan version barrierは公開実験契約なので親直轄。

## Codegraph preflight

indexはup to dateで、45 files／968 nodes／3,661 edgesだった。

| owner | caller／callee | impact | affected tests |
|---|---|---|---|
| `runRc1V5Campaign` (`src/rc1-v5-campaign.mjs:505`) | callerは`test/rc1-v5-campaign.test.mjs`。calleeは`observeFreshIndex`、`compileCondition`、`runRc1V5SeamTransform`、`validateRc1EvidenceCampaign`、`buildPlanDiff`、`makeComparison`、`evaluateRc1V5Hypothesis`ほか | 2 nodes／1 edge | `test/rc1-v5-campaign.test.mjs` |
| `writeRc1V5Artifacts` (`src/rc1-v5-campaign.mjs:730`) | callerは同test。calleeは`assertWritableResult`、`artifactFiles`、`verifyRc1V5BehaviorArtifactSet`ほか | 2 nodes／1 edge | 同上 |
| `verifyRc1V5BehaviorArtifactSet` (`src/rc1-v5-behavior-evidence.mjs:523`) | callerはwriter、campaign test、behavior test。behavior receipt／patch／envelopeだけを検証する | 5 nodes／6 edges | campaign test、behavior test |
| `compileBoundaryCondition` (`src/boundary-compiler.mjs:652`) | v4／v5 campaignとcompiler testから利用されるsingle compiler | queryでexact ownerを確認 | campaign source変更のaffectedはcampaign test |
| `validateRc1EvidenceCampaign` (`src/rc1-evidence-bundle.mjs:436`) | v4／v5 campaignとbundle／campaign testsから利用される | queryでexact ownerを確認 | campaign source変更のaffectedはcampaign test |

planned `verifyRc1V5CampaignArtifactSet`と`src/rc1-v5-artifact-set.mjs`はindexに存在せず、queryは空だった。
これは未実装／未索引のunknownであり、依存なしとは判定しない。planned pathを含む`codegraph affected`は既存importがないため
campaign testだけを返したが、実装後に再indexしてcaller／callee／impact／affected testを再確認する。

## 変更前identity

- `src/rc1-v5-campaign.mjs`: `26ac2bb7f70ec06a4262251019c14b552316ffe1e0fed81f20447296ddb08239`
- `src/rc1-v5-behavior-evidence.mjs`: `4086775b2689f2503622936ef61251389b7cf02e72fed2bbfda82233949bd70b`
- `src/boundary-compiler.mjs`: `5b4f4272e396b6e257ab0bfd4997382dddae9eb38cc19a0bf707d7ae8017e733`
- `src/rc1-evidence-bundle.mjs`: `294409dfc748c7d493ccf523a230487639d5e3fa808f841c03de7ab46e092e7f`
- `test/rc1-v5-campaign.test.mjs`: `516e06eef73337594c76e83dc41df13f049280b3e9624cdacc705f84d5ca0084`

## Characterization契約

v5 artifact setはfixed input 6件、2+2 Codegraph evidence、normal／negativeのcompiled artifact、full behavior
receipt／envelope、accepted transform／patch／receipt、plan diff、comparison、hypothesis evaluation、execution evidenceを
exact path集合で保存する。保存bytesだけから各runのraw preimageを復号し、同じcompilerへ再投入して保存済みcompile結果と一致させる。

corruption controlは改ざん後のpayload byte hashと依存digestを再封印する。input identity、compiler replay、transformとcontrol
compileのsource binding、v4→v5 invalidation、comparison、hypothesis evaluation、execution receiptのいずれかが因果的に切れた場合、
artifact-only verifierは拒否しなければならない。

## Expected red

- command: `node --test test/rc1-v5-campaign.test.mjs`
- 結果: 1 test／0 pass／1 fail／0 skip
- failure: `ERR_MODULE_NOT_FOUND: src/rc1-v5-artifact-set.mjs`
- 判定: expected red。新しいfull artifact verifierが存在しないため、既存campaignを実行する前にfail loudした。
