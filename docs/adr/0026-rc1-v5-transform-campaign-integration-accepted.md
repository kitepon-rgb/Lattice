# ADR 0026: RC1 v5のtransform／campaign因果接続を受け入れる

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-P
- predecessor: [ADR 0024](0024-rc1-v5-behavior-envelope-accepted.md)、[ADR 0025](0025-rc1-v5-oracle-observation-accepted.md)
- characterization commit: `20abcd7ec91dba38bf31cf6e34dd4aade4fb3ef9`
- transform source commit: `4e967f1ab17d2e7ca48fc9c15c51023bc487d9e0`
- campaign source commit: `39ea279ad811832f78ef31e0a7df68101cabf674`
- evidence: [RC1 v5 transform／campaign integration受入証拠](../evidence/2026-07-15-rc1-v5-integration-acceptance.md)

## Context

ADR 0024はfull pre／post receiptをaccepted transform、patch、source／output snapshotへbindするpure
behavior envelopeを受け入れ、ADR 0025はそのreceiptを実repoのGit baseとfixed surfaceからfresh Workerで生成する
観測契約を受け入れた。しかし両者は局所APIであり、同じdisposable worktree内のpre→transform→post順序、
accepted patchによるfresh reindex、single compilerによるplan再compile、保存bytesまでは接続していなかった。

またv4 campaignを包んで後からv5 receiptを追加する方式では、treatment indexがv5 accepted transformより先に
実行され得る。これは保存artifactのdigestを合わせても因果順序を立証できない。

## Decision

### 1. v4を変更せずv5 transform／campaignを別moduleにする

`src/rc1-v5-transform.mjs`の`runRc1V5SeamTransform`と、`src/rc1-v5-campaign.mjs`の
`runRc1V5Campaign`、`writeRc1V5Artifacts`をRC1 v5の正規入口にする。

v4 source、v4 API、`artifacts/v4`は変更しない。決定的なproduction＋test seam writerとfixed transform pathだけを
v4の公開APIから再利用し、v5 artifact identityと実行順序は新moduleが所有する。

### 2. Codegraph snapshotとbehavior surfaceのidentityを分離する

control boundary compilerが観測したCodegraph snapshotはboundary manifestのdigest chainへ保持する。
transform artifactの`source.code_snapshot_digest`にはcaller自己申告やそのCodegraph snapshotを流用せず、
同じisolated worktreeで実測したpre receiptの`surface_digest`を設定する。

これにより、構造解析snapshotの帰属とbehavior preservation対象surfaceの帰属を混同せず、
`pre.surface_digest === transform.source.code_snapshot_digest`を実artifactから再計算できる。

### 3. accepted envelopeまでを一つのisolated順序へ固定する

resolved base SHAを固定し、一つのdisposable worktreeで次を順に実行する。

1. fixed surfaceのpre v5 oracle観測
2. production＋TODO-owned test seam変換
3. 同じfixed surfaceのpost v5 oracle観測
4. verifierとexact patch／output capture
5. cleanupとcanonical source invariant確認
6. accepted transform artifact生成
7. full receipt、artifact、patchからbehavior envelope compile

post surfaceの全pathはpresentで、path＋content digest projectionがtransform outputへ一致しなければならない。
envelopeはaccepted artifact生成後だけcompileする。

### 4. rejected transformを後段barrierにする

pre／post behavior failure、surface drift、scope violation、verifier failure、cleanup failure、source invariant failure、
cross-binding failureはvalidなrejected transform resultへ閉じる。rejected resultは
`behavior_evidence=null`かつreceiptの`behavior_envelope_digest=null`を必須とする。

campaignはaccepted artifact、passed source invariant、exact patch bytes、non-null behavior evidenceが揃わない限り、
treatment index、comparison、plan diff、再compileを開始しない。

### 5. v5 campaignをaccepted transformの後へ接続する

campaignは同じbase、candidate spec、manual evidence、query set、capacity、oracleをcloneして固定し、次を実行する。

1. controlを2回fresh indexし、single `compileBoundaryCondition`でnormal／negativeをcompileする。
2. control artifactをsource bindingにしてv5 transformを実行する。
3. accepted patch bytesだけをtreatmentの2 fresh worktreeへreplayする。
4. 同じquery setとcompilerでnormal／negativeを全再compileする。
5. v5 comparisonはbehavior summaryでなくbehavior envelope digestだけを参照し、underlying artifactを
   `evaluateRc1V5Hypothesis`へ渡す。
6. plan diffはPhase-rejected v4をcausal predecessorにし、v4 plan／agent context／partial patch／interface assumptionを失効する。

### 6. 保存前に全bytesをartifact-only検証する

`writeRc1V5Artifacts`は新規`research/campaigns/rc1/artifacts/v5`だけを対象にし、既存rootを上書きしない。
full pre／post receipt、envelope、transform artifact／receipt、patch、2+2 evidence、compiled plans、comparison、
hypothesis evaluation、execution evidenceをcanonical bytesへし、manifest v5を作る。

filesystemへ書く前に、そのmanifestと全payload bytesを`verifyRc1V5BehaviorArtifactSet`へ渡す。required payload、
path bijection、byte hash、canonical JSON、receipt／surface／transform／patch relation、manifest result bindingが一つでも
失敗すればatomic writeへ進まない。

## Rejected alternatives

- **v4 campaign実行後にv5 receiptだけを追加する:** treatment reindexがaccepted v5 interventionより先になり、因果順序を識別できない。
- **control Codegraph snapshotをtransform source snapshotへ流用する:** behavior surfaceと別schema／別preimageであり、O2のexact relationを満たさない。
- **post receiptとoutputを別worktreeで観測する:** 同じpatchでも別snapshotの再封印を排除できない。
- **rejected resultへ部分envelopeを残す:** callerが非nullだけをadmission条件にして後段へ進む事故経路を残す。
- **comparisonへpassed summaryを保存してv4 evaluatorを直接呼ぶ:** full receiptとpatchがなくてもsupportを再現できる。
- **保存後にmanifestを検証する:** invalid treeが一時的でもimmutable evidence rootとして可視化される。
- **v5 artifactをv4 rootへ上書きする:** rejected predecessorの再現可能性とversion barrierを破壊する。

## Consequences

- RC1-Pを完了とし、focused transform `3 pass`、focused actual 2+2 campaign `1 pass`、related
  `4 pass / 0 fail / 0 skip`を受け入れる。
- RC1-Qはこの正規入口をcanonical Lattice repoへ一回実行し、`artifacts/v5`を新規発行してcorruption controlsと
  plan version diffを保存する。Pのtemp repo writer testをimmutable campaign発行へ数えない。
- RC1-Rまでfull `npm run ci`とPhase refuterを実行せず、P受入をH1-v5支持へ丸めない。
- source／testを今後変更する場合は本Decisionのrelated greenを再利用せず、新しいCodegraph gateと変更scopeのtestを取る。
- Latticeだけをwriter scopeとし、dotagents／Observer関連repoはread-only、remote作成・push・publishは禁止を維持する。
