# RC1 v5 transform／campaign integration受入証拠

- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-P
- 対象Control: `lattice-rc1-closed-loop-v3`
- characterization commit: `20abcd7ec91dba38bf31cf6e34dd4aade4fb3ef9`
- transform source commit: `4e967f1ab17d2e7ca48fc9c15c51023bc487d9e0`
- campaign source commit: `39ea279ad811832f78ef31e0a7df68101cabf674`
- Decision: [ADR 0026](../adr/0026-rc1-v5-transform-campaign-integration-accepted.md)
- preflight: [RC1 v5 integration preflight](2026-07-15-rc1-v5-integration-preflight.md)

## Scope

F（isolation、artifact binding、version barrier）として親が直轄した。追加は次に限定した。

- `test/rc1-v5-transform.test.mjs`
- `test/rc1-v5-campaign.test.mjs`
- `src/rc1-v5-transform.mjs`
- `src/rc1-v5-campaign.mjs`

既存v4 source、fixture、input、artifactは変更していない。test内のtemp Git repoへv5 artifact writerを適用したが、
canonical Latticeの`research/campaigns/rc1/artifacts/v5`はまだ作っていない。dotagentsとObserver関連repoは
read-only、Control recordはLatticeの`.git`配下だけを更新した。remote作成、push、publishは行っていない。

## Test-first characterization

source追加前のfocusedは`4 tests / 1 pass / 3 fail / 0 skip`だった。

- green: v4 accepted transformのpre／post receipt digestが同一で、role／surfaceを持たず、v5 validatorを通らない実反例。
- red: v5 accepted transform、rejected transform barrier、actual 2+2 campaign。
- red原因: planned v5 module 2件の`ERR_MODULE_NOT_FOUND`。

syntax 2件と`git diff --check`はgreenであり、v4挙動やtest typoをred原因にしていない。

## 実装したtransform relation

`runRc1V5SeamTransform`はresolved base SHAを固定し、同じdisposable worktreeでpre oracle、transform、post oracle、
verifier、output captureを順序実行した。accepted resultで次を実artifactから照合した。

- pre／post receiptはv3 validatorを通り、role、receipt digest、surface digestが別identity。
- preはbaselineのpresent／absentを含み、postはallowed 6 pathすべてpresent。
- transform source `code_snapshot_digest`はpre surface digestと一致。
- changed pathはallowed 6 pathと全単射。
- transform outputはpost surfaceのpath＋content digest projectionと一致。
- patch bytesのSHA-256はartifactとenvelopeのpatch digestへ一致。
- envelopeのpre／post receipt、surface、artifact、patch、output参照がunderlying artifactへ一致。
- cleanupとcanonical source invariantはpassed。

behaviorを壊すcustom transformとoracle inputへのscope逸脱はどちらもvalid rejected artifactになった。前者は
`behavior_verification_failed`、後者は`scope_violation`で、両方ともbehavior evidenceとenvelope digestを持たない。

## 実装したcampaign relation

`runRc1V5Campaign`はcontrolを2 fresh runしてからv5 transformを実行し、accepted patchだけでtreatmentを2 fresh runした。
各conditionは同じquery setとexported `compileBoundaryCondition`を使い、normal／shared-state negativeを全compileした。

focused actual campaignで次を確認した。

- 4 evidence bundleがcampaign validatorを通る。
- condition内2 runはopaque raw receiptが別でもportable aggregateが一致する。
- controlはshared production＋test boundaryを`seam_candidate`、minimum feasible waves 2として保持する。
- treatmentはconflict 0、unknown 0、minimum feasible waves 1、hard precedence不増加。
- control／treatment negativeはstate conflictと2 wavesを保持し、treatment negativeは`intentional_serial`。
- treatment 2 runのpatch digestはaccepted transform patchへ一致。
- comparison v3はbehavior envelope digestだけを持つ。
- artifact-only hypothesis evaluationは15 checksすべてpassed。
- plan diffはPhase-rejected v4をcausal predecessorにし、4 context kindを失効する。
- source HEAD、visible／ignored status、protected content、worktree countは不変。

writerはtemp repoの新規`artifacts/v5`へ26 payloadをatomic writeした。manifestと全payloadを保存前／保存後に
artifact-only verifierへ渡し、required paths、path bijection、byte hash、canonical parse、behavior binding、result bindingの
全checkがpassedした。同じrootへの二回目writeは拒否した。

## Gates

### Focused transform

~~~text
node --check src/rc1-v5-transform.mjs
node --test test/rc1-v5-transform.test.mjs
git diff --check
~~~

結果: syntax／diff check成功、`3 pass / 0 fail / 0 skip`、約1.2秒。

### Focused campaign

~~~text
node --check src/rc1-v5-campaign.mjs
node --test test/rc1-v5-campaign.test.mjs
git diff --check
~~~

結果: syntax／diff check成功、`1 pass / 0 fail / 0 skip`、約14.4秒。

### Related

post-indexでv5 transformのaffected testとしてv5 transform／campaign、v5 campaignのaffected testとして
v5 campaignが列挙された。TODO完了候補で次を一回だけ実行した。

~~~text
node --test test/rc1-v5-transform.test.mjs test/rc1-v5-campaign.test.mjs
~~~

結果: `4 pass / 0 fail / 0 skip`、約13.8秒。full `npm run ci`はRC1-Rへ集約し、ここでは実行していない。

## Post-index Codegraph

source commit後の明示indexはCodegraph 1.4.1、`45 files / 968 nodes / 3,661 edges`、complete、pending
changes／refs `0`だった。

- `runRc1V5SeamTransform`: exact `src/rc1-v5-transform.mjs:268`、callerはv5 transform testとv5 campaign、
  impact `5 nodes / 4 edges`、affected test 2件。
- `runRc1V5Campaign`: exact `src/rc1-v5-campaign.mjs:505`、callerはv5 campaign test、calleeにfresh index、
  single compiler、v5 transform、v5 evaluator、impact `2 / 1`、affected test 1件。
- `writeRc1V5Artifacts`: exact `src/rc1-v5-campaign.mjs:730`、callerはv5 campaign test、calleeにv5
  artifact-only verifier、impact `2 / 1`。

sourceとtestのSHA-256は次である。

- `src/rc1-v5-transform.mjs`: `78dff3d559a854bf9394150e500d2a02c0db18027029f33572b24d5926fd21ae`
- `src/rc1-v5-campaign.mjs`: `26ac2bb7f70ec06a4262251019c14b552316ffe1e0fed81f20447296ddb08239`
- `test/rc1-v5-transform.test.mjs`: `bc084cbfbfd3f147c7a2a30185eaddf35c2ef09161925a7ad9a557052ac374d4`
- `test/rc1-v5-campaign.test.mjs`: `516e06eef73337594c76e83dc41df13f049280b3e9624cdacc705f84d5ca0084`

## 結論と未完了範囲

RC1-Pの機構は受入可能である。O1 receiptとO2 envelopeをaccepted seam、2+2 fresh reindex、single compiler、
new plan version、immutable writerへ接続し、rejected transformから後段artifactを作らないbarrierを実証した。

ただしcanonical v5 run、保存artifact corruption suite、plan context invalidationの実artifact検証、intervention時間等の
実測はRC1-Q、full CIと独立Phase反証はRC1-Rであり、H1-v5支持は未判定である。
