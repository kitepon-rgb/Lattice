# ADR 0038: RC2 closed loopをfresh repeat、version barrier、disk-only artifactへ固定する

- Status: Accepted
- Date: 2026-07-16
- Scope: RC2-Gのfresh reindex、control／treatment compile、new plan version、immutable artifact
- Related: [ADR 0032](0032-rc2-bounded-graph-compiler-and-three-way-seam.md)、
  [ADR 0037](0037-rc2-delivery-policy-transform-transaction.md)

## Context

ADR 0037は、delivery policy registryの3-way seamを、canonical repoを変えないaccepted transform artifactとして固定した。
しかしaccepted patchとv2 compilerが個別にgreenでも、次の因果鎖はまだ実証されていない。

- controlとtreatmentを同じCodegraph indexの更新前後として測り、cacheや残存indexを独立変数へ混ぜていないか。
- treatmentのsource snapshotがaccepted transformのactual outputと一致し、別patchや手補正を使っていないか。
- primary fixtureとRC1 transferが同じv2 core bytesを通り、fixture別schedulerへ分岐していないか。
- normal、partial-state、capacity、unknownを別条件としてcompileし、seam効果へ混ぜていないか。
- accepted transformから新しいplan versionを全体compileし、旧agent contextや途中patchを失効したか。
- 実行時objectを捨てた後、保存bytesだけからgraph、minimum、patch、oracle、predecessor relationを再計算できるか。

同じworktreeを二度queryするだけではfresh repeatにならず、二回の同じ結果は残存indexの再読でも作れる。また、elapsed値は観測値であり
同じ入力から再生成できないため、compiler identityやplan digestへ混ぜると構造結果の再現性を壊す。一方でelapsedをsummaryだけへ置くと、
未実測や失敗試行を0へ丸められる。この二つを分離する必要がある。

## Decision

### 1. RC2-Gを一つのcausal campaignにする

`src/rc2-campaign.mjs`は、actual clean `HEAD === baseRef^{commit}`を入口にし、次を一回のcampaign resultへ束ねる。

1. default writerによるaccepted RC2 transformを一回実行する。
2. incomplete writerとscope-violating writerを別transactionで実行し、typed rejected artifactを保存する。
3. primary control／treatmentを各2回、互いに独立したdisposable worktreeでfresh indexする。
4. RC1 v6 control／treatmentを各1回、別のdisposable worktreeでfresh indexし、v2 transfer front-endへ通す。
5. primary normal、partial-state、capacity 2、third-only unknownを同じv2 coreへcompileする。
6. accepted treatment normalだけからnew plan versionとplan diffを作る。
7. artifact setを一時directoryへ構築し、pure verifierを通してからatomic renameする。

public entryは`runRc2Campaign`、`writeRc2CampaignArtifacts`、`verifyRc2CampaignArtifactsOnDisk`に限定する。
pure artifact relationは`src/rc2-artifact-set.mjs`が所有し、campaign executionやCodegraph commandを呼ばない。

accepted transformが得られない場合は手順3以降へ進まない。rejected controlは失敗を証明する観測であり、独立変数またはtreatment
predecessorにはしない。

### 2. fresh repeatの実験単位をworktreeにする

primaryの4 runとRC1 transferの2 runは、runごとにexact base SHAから新しいdetached worktreeを作る。treatmentだけaccepted binary
patchを`git apply --check --binary`後にexact replayする。その後、各worktreeで既存`.codegraph` bootstrapを退避し、fresh
`codegraph init .`、固定query set、source snapshot、oracleを実行し、`.codegraph`を元の状態へ戻してworktreeを削除する。

- primary controlはpatch digest `null`、9-path control snapshotを持つ。
- primary treatmentはRC2 accepted patch digest、9-path output snapshotを持つ。
- RC1 controlはpatch digest `null`、RC1 v6 fixed surface snapshotを持つ。
- RC1 treatmentは保存済みRC1 v6 accepted patchのexact digestとoutput snapshotを持つ。

各runはbase SHA、condition、run ID、snapshot full object／digest、query set digest、Codegraph executable identity、raw／diagnostic／portable
evidence、patch digest、source invariant、cleanup、index／query／oracle elapsedを持つ。primary同士ではraw telemetryのbyte一致を要求せず、
portable preimageとcompiled structural artifactの一致を要求する。Codegraphのempty、absent、failure、stale、unresolvedはtyped outcomeのまま
front-endへ渡し、independenceへ変換しない。

### 3. executableとsource identityをcampaign前後で固定する

campaign開始前と全run後に次のactual bytes／identityをcaptureし、exact一致させる。

- Codegraph executable bytes、version、digest。
- `schedulability-compiler-v2.mjs`、`schedulability-verifier-v2.mjs`。
- primary／RC1 transfer front-end、RC2 transform adapter、fixed oracle executor。
- primary query set、candidate witness、manual evidence、plan input。

保存したidentity sourceは実行用としてロードしない。campaignはcurrent trusted source moduleを実行し、artifact verifierは保存bytesのdigestと
source identity relationを検査する。compilerの入力へcandidate ID、fixture path、expected waves、condition selectorを加えない。

### 4. compile matrixと独立minimum verificationを固定する

primary各fresh runはsnapshot-bound portable evidenceからnormal bundleを作り、同じ
`compileSchedulabilityGraphV2`へ渡す。各compiled planは`verifySchedulabilityPlanV2`で保存graphからfeasibilityとminimumを再計算する。
二回の同conditionはbundle、verdict、planのdigestが一致しなければならない。

追加条件はtreatmentの一つのfresh portable preimageを固定して、ほかを一変数だけ変える。

- partial-state: manual evidenceだけを変え、exactly 1 unordered conflict、minimum 2、第三TODOのco-scheduleを要求する。
- capacity-2: plan input capacityだけ3から2へ変え、0 conflict、minimum 2を要求する。
- third-only unknown: manual evidenceだけを変え、compilerとverifierの両方を`BOUNDARY_UNKNOWN`にし、verdict／plan／new versionを作らない。

RC1 transferはimmutable v6 inputとfresh v1 boundary observationからv2 bundleを作る。control／treatment normalに加えて同じfresh evidenceから
shared-state negativeもcompileし、v6の3→0 write conflict、2→1 normal waves、negative 2 wavesとisomorphicであることを検査する。
RC1 artifactは読み取りpredecessorであり、再発行・上書きしない。

### 5. v2 planをversion envelopeへ入れる

`plan_graph.v2`自体へfixture固有version fieldを追加しない。accepted treatment normalのbundle／verdict／planを
`lattice.rc2.plan_version.v1` envelopeへ入れ、versionを`rc2-delivery-policy-v2`にする。old plan descriptorはplan inputの
`rc2-delivery-policy-v1`とprimary control compiled planを指す。

new plan versionは少なくとも次をcausal predecessorにする。

- RC1 v6 Phase-supported archiveとADR 0031の保存bytes。
- RC2 design ADR 0032、transform ADR 0037、本ADRの保存bytes。
- accepted transform artifact／receipt／patch、behavior evidence、mutation evidence。
- primary 4 fresh runとRC1 transfer 2 fresh runのevidence descriptor。
- fixed candidate／query／manual inputとv2 compiler／verifier identity。

plan diffは3 TODO全件をaffected／recompiledとして列挙し、control planへ追記しない。次をexactly invalidated contextとして持つ。

- old plan `rc2-delivery-policy-v1`。
- old agent context。
- control snapshotまたはpartial patchから作られた途中patch。
- transform前ownershipを前提にしたinterface assumption。
- accepted treatment snapshotへbindされないboundary evidence。

unknown、rejected transform、oracle divergence、source drift、Codegraph unresolved、minimum verification failureのいずれからもnew plan envelope／
plan diffを発行しない。

### 6. artifact setはexact、immutable、atomicにする

artifact rootは`research/campaigns/rc2/artifacts/v1`だけとする。既存rootがあれば上書きせず失敗する。一時directoryへ全fileを
fsync可能な通常fileとして書き、exact relative path、media type、byte length、SHA-256を持つmanifestを最後に構築する。pure verifierが
全条件を通した後だけrootへatomic renameする。RC1 artifact、ADR、archiveは変更せず、必要なpredecessor bytesはRC2 artifact内へcopyして
digest relationを検証可能にする。

artifact setは少なくとも次を別fileで保存する。

- fixed inputs、source／executable identity、predecessor bytes。
- accepted／rejected transform、binary patch、behavior／mutation evidence。
- primary 4 run、RC1 transfer 2 runのraw／portable evidenceとmeasurement。
- condition別bundle、verdict、plan、independent verification receipt。
- new plan version、plan diff、comparison、hypothesis evaluation。
- stage別cost、intervention surface、reject／retry／rollback、未検証範囲。

### 7. disk-only verifierはsummaryを信頼しない

`verifyRc2CampaignArtifactSet`はmanifestとartifact bytesだけを受け、次を再計算する。

- exact path set、media type、byte length、file SHA-256、canonical JSON。
- input、source snapshot、Codegraph evidence、transform、oracle source／case set、patchのcross-binding。
- primary／RC1 transferのbundleを保存preimageから再compileしたverdict／plan。
- producerを呼ばないindependent verifierによるfeasibilityとminimum。
- partial-state、capacity、unknownの一変数差分とtyped outcome。
- plan version、predecessor、invalidated context、全affected TODO、comparison、hypothesis checks。
- stage costの`measured | not_measured`状態、per-stage値とaggregateの算術関係、reject／retry／rollback counts。

保存elapsedの真の経過時間は後から再測定できないため、verifierは値そのものを因果的に証明したとは主張しない。各値の明示状態、非負有限値、
run recordとの一致、aggregate再計算だけを検証する。elapsed、temporary path、timestampはportable structural digest／new plan digestへ含めない。
artifact-only verification receipt自体はartifact setの外で生成し、自己参照manifestを作らない。

## Rejected alternatives

- 同じworktreeで`codegraph init`を二回呼んで2 runとする: filesystem／index残存をrepeatへ混入する。
- treatment evidenceをaccepted transformのoutput digestだけで合成する: 実patch replayとfresh indexを観測していない。
- RC1 v6保存manifestだけをv2へ再度渡してfresh transferと呼ぶ: transfer front-end互換は示せてもfresh measurementではない。
- `plan_graph.v2`へcampaign versionを足す: generic bounded coreへfixture lifecycleを混ぜる。
- old planへtopologyを追記する: stale contextと途中patchを有効なまま残す。
- in-memory resultをdisk verifierへ渡す: 保存漏れや書換えを検出できない。
- elapsedを構造digestへ含める: 同じ構造結果が測定ノイズで別planになる。
- elapsed未実測を0とする: 0msと欠測を区別できない。
- rejected transformから診断用treatment planをcompileする: version barrierと発行禁止条件を破る。

## Consequences

- RC2-Gは単なるintegration testでなく、実seam、fresh sensor、compiler、version barrier、disk evidenceを一つの因果artifactへする。
- fresh worktreeは合計6 run、transformはaccepted＋rejected controlsを実行するため重い。focused characterizationとrelated campaign testを
  TODO gateに使い、full regressionはRC2-Hで一回だけ実行する。
- supportできる主張は、固定2-TODO transferと新3-TODO registry fixtureのbounded exemplarに限る。actual multi-agent速度、ownership自動発見、
  任意repo成功率、別seam class一般化は引き続きnon-goalである。
- このADRをTask finalizationに使った後は、本pathへ実測結果やPhase裁定を追記しない。
