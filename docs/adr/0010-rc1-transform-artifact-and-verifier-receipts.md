# ADR 0010: transform acceptanceをpatch・verifier・cleanup receiptへbindする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v2`
- 対象Control: `lattice-rc1-closed-loop-v3`
- depends on: ADR 0003、ADR 0006、ADR 0009

## Context

RC1-Cのisolation runnerはbounded patch、verifier green、cleanup、source不変を実行時に保証するが、成功結果へは
base SHA、changed path、patch bytesしか返さない。このままRC1-Eが`accepted`を宣言すると、どのverifier commandが
どのexit／stdout／stderrで通ったかをtransform artifactのdigestへbindできない。

また、runner failureを単にthrowして捨てると、scope violationやbehavior divergenceを再現したreject条件をmachine artifactへ
残せない。逆に全errorをcatchしてsuccess-likeなfallbackにすると、infrastructure failureやsource leakを隠す。

## Decision

### Transform artifact

初期公開面へ`lattice.transform_artifact.v1`を追加する。accepted／rejectedは同じexact root shapeを使い、少なくとも次を持つ。

- candidate IDとcontrol boundary manifest／verdict／plan graphのcanonical digest。
- base commit、pre-transform code snapshot、固定query-set digest。
- allowed path、observed changed path、raw patchのSHA-256／byte length。
- verifier status、stable verifier ID、command／args、exit code、stdout／stderr digest、およびreceipt集合のcanonical digest。
- post-transform file content digestとsnapshot digest。
- cleanup status、canonical sourceの`unchanged | changed | unresolved`。
- reject時のtyped kind、理由、evidence digest、残存unknown。

accepted artifactは、非空patch、allowed path内の非空changed path、全verifier exit 0、post snapshot、cleanup passed、source unchanged、
rejectionなしを同時に要求する。rejected artifactはrejectionを必須にし、後段へraw patchを返さない。patch snapshotが観測済みなら
そのdigestを証拠として保持してよいが、accepted predecessorにはならない。

### Isolation runner receipt amendment

`runIsolatedTransform`の成功結果へverifier receiptを追加する。stdout／stderr本文は複製せずSHA-256だけを返す。
verifier failureは失敗receiptと、その時点で固定済みならchanged path／patch snapshotをerror evidenceへ付けたままthrowする。
cleanupとsource invariantの検査順、canonical sourceがdirtyなら開始しない契約は変更しない。

RC1 seam transformerはrunnerのthrowを`accepted`へ丸めない。bounded interventionとして評価できるfailureはtyped rejected artifactへ
変換し、unexpected／aggregate failureも`execution_failure`または対応する安全categoryとしてrejectする。cleanupまたはsource状態を
確定できない場合は`unresolved`を保持する。

## Rejected alternatives

- **patch digestだけをaccepted predecessorにする:** behavior gateとcleanupをartifactから検証できない。
- **test command文字列だけを記録する:** 実行結果をbindせず、未実行をgreenに見せられる。
- **stdout／stderr全文をartifactへ保存する:** 端末pathや秘密を混入させる面が増え、RC1には不要である。
- **reject時もpatchをRC1-Fへ渡す:** failed interventionを新planへ採用できてしまう。
- **fixture sourceをcanonical worktreeで直接変更する:** control conditionとrollback boundaryを破壊する。

## Consequences

- RC1-Eはnormal candidate、scope violation、behavior divergenceを同じartifact validatorへ通し、acceptedだけがpatch bytesを返す。
- RC1-Fはtransform artifact digest、patch digest、verification digestを`plan_diff.v1`へ接続できる。
- verifier receipt追加はADR 0006のRC1-C結果shapeを補強するが、既存のscope／cleanup／source invariant受入を撤回しない。
- transform artifact fileはreview用JSON encodingでもよいが、digestはparsed payloadのLattice canonical byteを指す。
- Codegraph、dotagents、Observer関連repoのwriter境界は変更しない。
