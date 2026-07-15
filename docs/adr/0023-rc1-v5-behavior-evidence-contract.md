# ADR 0023: RC1 v5のbehavior observationとcausal bindingを別artifactへ分ける

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-N
- predecessor: [ADR 0022](0022-rc1-v4-phase-gate-rejection.md)
- characterization commit: `b702ef1`

## Context

v4 runnerはpre／post black-box oracleを実際に呼ぶが、receipt v2は観測role、base SHA、entrypoint content digest、
fixed surface snapshotを持たない。transform receiptはfull receiptをoutcome＋digestへ縮約し、artifact writerもfull receiptを保存しない。
そのためpostをpre receiptへ再利用しても保存behavior blockと15条件のmachine evaluationが変わらない。

RC1-Nは保存v4 artifactを使い、この反例が現実にsupportを維持することをfocused testで再現した。同じtestで、
v5のvalid artifactとsingle-field corruptionに必要なexact contractを実装より先に固定した。

## Decision

### 1. observation receiptとcausal envelopeを分離する

oracle executorが返すfull observationを`lattice.rc1.black_box_behavior_receipt.v3`、その観測をaccepted transformへ帰属する
cross-artifact recordを`lattice.rc1.behavior_evidence_envelope.v1`とする。receiptへpatchを後付けして実行時事実と後段事実を混ぜない。

receipt v3は次のexact fieldだけを持つ。

- `schema`
- `role`（`pre | post`）
- `base_sha`
- `oracle_digest`
- `entrypoint`
- `export_name`
- `entrypoint_content_digest`
- `surface`
- `surface_digest`
- `observation.before_surface_digest`
- `observation.after_surface_digest`
- `outcome`
- `case_results`
- `receipt_digest`

`receipt_digest`は同field自身を除くreceipt preimageのcanonical digestである。pre／postのbehavior outcomeとcase resultsが同じでも、
roleまたはsurfaceが違えばreceipt identityは異ならなければならない。

### 2. fixed surfaceはtyped preimageを持つ

surface schemaを`lattice.rc1.behavior_surface_snapshot.v1`とし、accepted transformの全allowed pathをsort済みexact listで保存する。
各entryは`path`、`state=present | absent`、present時の`content_digest`またはabsent時の`null`だけを持つ。

oracle実行直前と直後に同じsurfaceを観測し、両digestとstored surface digestが一致する場合だけstable observationとする。
entrypoint content digestはsurface内の同path content digestと一致しなければならない。

### 3. envelopeは参照だけを持ち、relationを自己申告しない

envelope v1は次のexact fieldだけを持つ。

- `schema`
- `base_sha`
- `oracle_digest`
- `pre_receipt_digest`
- `post_receipt_digest`
- `pre_surface_digest`
- `post_surface_digest`
- `transform_artifact_digest`
- `patch_digest`
- `output_snapshot_digest`
- `envelope_digest`

same base、same oracle、role order、receipt self-digest、entrypoint binding、observation stability、accepted transform、patch、post outputの
relationはevaluatorがunderlying artifactから再計算する。envelopeへ`same_base=true`等の自己申告booleanを保存しない。

### 4. v5 machine evaluatorはunderlying artifactを入力にする

`src/rc1-v5-behavior-evidence.mjs`は少なくとも次のpure APIを公開する。

- `compileRc1V5BehaviorEvidence({ preReceipt, postReceipt, transformArtifact, patchDigest })`
- `evaluateRc1V5Hypothesis({ comparison, behaviorEvidence })`
- `verifyRc1V5BehaviorArtifactSet({ manifest, payloads })`

comparison v3のbehavior fieldは`evidence_envelope_digest`参照だけを持つ。evaluatorはoutcome summaryを信頼せず、full receipt、envelope、
transform artifact、patch digestから`behavior_binding`を再計算する。invalid／unknown／exceptionはfalse supportへfail closedにする。

### 5. behavior payloadをmanifest必須subsetにする

artifact-only verifierは少なくとも次のpayloadをmanifestとbytesの両方から検査する。

- `behavior/pre-receipt.json`
- `behavior/post-receipt.json`
- `behavior/evidence-envelope.json`
- `transform/transform-artifact.json`
- `transform/seam.patch`

path欠落、重複、byte count不一致、SHA-256不一致、manifest外／payload外の片側だけの存在をrejectする。

### 6. characterization failureを正確に扱う

focused testは2件中、v4非識別反例が1 pass、未実装v5 moduleが`ERR_MODULE_NOT_FOUND`で1 failした。
これはexpected redであり、v5契約の実装成功ではない。実装laneは同じfocused入口をgreenへ収束させる。

## Rejected alternatives

- **receipt v2へentrypoint digestだけ足す:** role、base、surface、patch relationが欠け、pre再利用と別snapshotを排除できない。
- **full receiptをtransform receiptへembedするだけ:** patch確定後のcross-bindingとobservation時事実の責務が混ざる。
- **envelopeへrelation booleanを保存する:** evaluatorが自己申告を再利用し、underlying artifact corruptionを見落とす。
- **comparison summaryへsnapshot digestを一つ追加する:** full receiptとmanifest bytesを保存せず、観測の独立再計算ができない。
- **v4 module／artifactをin-place更新する:** historical resultのschemaとdigest chainを破る。

## Consequences

- v4 sourceと`artifacts/v4`は変更しない。v5 behavior evidenceは新module／新artifact versionへ実装する。
- O1はreceipt v3とsurface observation、O2はenvelope／evaluator／manifest verifierを非交差laneで実装できる。
- transform integrationはO1＋O2の両方をhard dependencyにし、full receiptを保存できないrunを再index／recompileへ進めない。
- cooperative isolated-worktree threat modelに限定し、署名、remote attestation、敵対的filesystemの完全防御はRC1 non-goalとする。
- Latticeだけをwriter scopeとし、dotagents／Observer関連repoはread-only、remote作成・push・publishは禁止を維持する。
