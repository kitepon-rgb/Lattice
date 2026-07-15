# ADR 0027: RC1 v5のimmutable closed loopを受け入れる

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-Q
- predecessor: [ADR 0026](0026-rc1-v5-transform-campaign-integration-accepted.md)
- characterization commit: `6edfcc6ee447ae8e6cdf24f39a5d3f37fdf50c1a`
- full verifier source commit: `b5e1029418b1eba8a0fb61215361e577f0065928`
- immutable artifact commit: `39c4471eee04c4e35ada15e0b90c98795d30e06b`
- evidence: [RC1 v5 immutable closed loop受入証拠](../evidence/2026-07-15-rc1-v5-immutable-closed-loop-acceptance.md)

## Context

ADR 0026はpre→transform→post、accepted patchによる2+2 fresh reindex、single compiler、v5 plan diffを
temp fixture repoで接続した。しかしwriterが保存したのは26 payloadで、fixed inputの完全なpreimageはartifact setに含まれず、
保存前検証もbehavior receipt／transform／patchの部分証明に限られていた。manifestの全byte hashが正しくても、保存input、
Codegraph raw evidence、compiled plan、comparison、execution receiptの間を再計算できないため、canonical campaign発行には足りない。

またRC1-Qはtemp testの成功ではなく、固定したLattice baseに対するcontrol／treatment各2 fresh run、実seam、再index、
再compile、新plan version、immutable保存を一つの実験として要求する。

## Decision

### 1. fixed input preimageをartifact setの一部にする

plan input、candidate spec v2、normal／shared-state negative manual evidence、query set v2、behavior oracle v2の6件を
`inputs/`へ保存する。execution evidenceとcomparisonにあるinput digestだけで完全preimageを代用しない。

v5のexact payload setはこれら6件、2+2 evidence、normal／negativeの12 compiled artifact、3 behavior artifact、
transform artifact／receipt／patch、plan diff、comparison、hypothesis evaluation、execution evidenceの計32件とする。
manifest自身を含むdisk fileは33件である。

### 2. full campaign artifact verifierを正規writer gateにする

`verifyRc1V5CampaignArtifactSet`をv5 artifact setの正規検証入口にする。writerはatomic renameより前に次の12条件を
すべて通さなければならない。

1. behavior artifact set
2. exact artifact set
3. canonical payloads
4. input identity
5. evidence campaign
6. compiler replay
7. transform binding
8. plan diff binding
9. comparison binding
10. hypothesis evaluation
11. execution evidence
12. result binding

behavior verifierは1の部分証明として残すが、full campaign受入の代用にはしない。

### 3. 保存raw preimageからsame compilerを8回replayする

control／treatment各2 runのopaque raw receiptを保存bytesから復号し、各runのCodegraph snapshot digest、fixed input、
normal／negative manual evidenceを同じ`compileBoundaryCondition`へ戻す。計8 compileすべてのmanifest、verdict、planと
そのdigestが保存artifactへ一致しなければrejectする。

compilerとcampaign runnerのsource digestは実行時module bytesへ照合する。portable projectionだけをcompiler inputへ
読み替えず、condition内2 runの片方だけでreproducibleと判定しない。

### 4. campaign-level corruptionは依存digest再封印後もrejectする

input、compiled plan、run snapshot、transform source binding、v4 context invalidation、comparison fixed inputs、
hypothesis evaluation、execution run receiptの8 corruptionを固定する。改ざん後はpayload byte hash、manifest、関連する
plan diff／comparison／evaluation／execution digestを可能な範囲で再封印する。

単純なstale hashで拒否するだけでは足りず、対応するsemantic checkがfalseにならなければならない。

### 5. canonical v5 experimentをimmutableに発行する

base `b5e1029418b1eba8a0fb61215361e577f0065928`へ次を実行し、
`research/campaigns/rc1/artifacts/v5`へ新規発行した。

- control 2 fresh index、normal／negative compile
- accepted production＋test seamとfull behavior envelope
- exact patchによるtreatment 2 fresh index、normal／negative recompile
- control／treatment comparison、underlying-artifact hypothesis evaluation
- v4 rejected planをcausal predecessorにしたv5 plan diff
- 32 payloadのmanifest v5、保存前とdisk再読込後のfull verification

既存rootの上書き、部分発行、rejected transformからの後段生成は許可しない。

### 6. RC1-Qはmechanism support、Phase verdictはRC1-Rに限定する

保存artifactはこのfixtureとcooperative isolated-worktree threat modelの範囲でH1-v5の15条件をsupportした。
これはRC1-Qの機構受入であり、full CIと独立反証を経たRC1全体のsupport Decisionではない。最終裁定はRC1-Rだけが行う。

## Rejected alternatives

- **input digestだけを保存する:** compiler replayの完全preimageがなく、candidate／query driftをartifact単体で反証できない。
- **conditionごとに1 runだけreplayする:** second fresh runのsnapshot／raw receiptをexecution自己申告へ残す。
- **behavior verifierだけでwriterをgateする:** compiled plan、comparison、version barrier、execution receiptの差替えを検出できない。
- **manifest hashだけを壊すcorruption:** semantic cross-bindingの識別力を証明しない。
- **v4 planへtreatment topologyを追記する:** Phase-rejected plan／agent context／partial patchを復活させる。
- **canonical artifactをtemp test結果で代用する:** fixed Lattice baseの実Codegraph、実worktree、実保存bytesを立証しない。
- **既存v5 rootを上書きする:** 実験identityとreproducibilityを破壊する。

## Consequences

- RC1-Qの6 TODOを完了し、immutable v5 artifactとfull verifierを受け入れる。
- 実測はcontrolのwrite conflict `3`／test-write conflict `1`／2 wavesから、treatmentの`0`／`0`／1 waveへ変化した。
  hard precedenceとunknownは両条件で`0`、negative treatmentはstate conflict `1`／2 wavesを保持した。
- campaign全体は`16,217.635 ms`、seam介入は`445.35 ms`。behavior、source invariant、cleanup、12 verifier checkはpassed。
- RC1-Rでsource収束後のfull `npm run ci`を一回、behavior evidence P1の独立refuterを一回実行し、H1-v5を
  support／refuteする最終Decisionを別ADRへ固定する。
- Latticeだけをwriter scopeとし、dotagents／Observer関連repoはread-only、remote作成・push・publishは禁止を維持する。
