# ADR 0024: RC1 v5のcausal behavior envelopeを受け入れる

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-O2、RC1-O2B
- predecessor: [ADR 0023](0023-rc1-v5-behavior-evidence-contract.md)
- source commit: `009df1f95d7d35c90a46a347ceb03546eb028f59`
- evidence: [RC1 v5 behavior envelope／evaluator受入証拠](../evidence/2026-07-15-rc1-v5-behavior-envelope-acceptance.md)

## Context

ADR 0023は、v4のpost receipt再利用を排除するため、observation receiptとcausal envelopeを分離した。
実装初版はreceipt、post output、transform、patch、manifestをcross-bindしてfocused testを通した。

しかし親監査で、pre surfaceがtransform source snapshotへ直接bindされていないことを確認した。また、
corruption testがleaf変更後の上位digestを再封印しておらず、stale digestだけでもrejectできるため、
各relationの識別力を単独では立証していなかった。

## Decision

### 1. O2のpure causal boundaryを受け入れる

`src/rc1-v5-behavior-evidence.mjs`の次のAPIとexact artifact contractをRC1 v5の正規入口にする。

- `compileRc1V5BehaviorEvidence`
- `evaluateRc1V5Hypothesis`
- `verifyRc1V5BehaviorArtifactSet`
- `validateRc1V5BehaviorSurface`
- `validateRc1V5BehaviorReceipt`

invalid evidenceはsupportへ丸めず、evaluator／artifact verifierではexplicit false、envelope compilerでは
契約違反としてrejectする。

### 2. preとpostを別のsnapshot relationへbindする

pre receiptはrole、base SHA、oracleだけでなく、
`pre.surface_digest === transformArtifact.source.code_snapshot_digest`を必須とする。

post receiptは同じallowed path集合を持ち、全pathがpresentで、path＋content digestのprojectionが
`transformArtifact.output.files`と`output.snapshot_digest`へ一致しなければならない。

envelopeは両receipt digest／surface digest、transform artifact digest、patch digest、output snapshot
digestを参照する。same-base等のrelation booleanは保存せず、evaluatorがunderlying artifactから再計算する。

### 3. corruption controlは依存digestを再封印してから判定する

leaf fieldを変更した後、変更に従属するreceipt digest、envelope digest、comparisonのenvelope参照を
再計算する。それでも破れたrelationによりsupportがfalseになる場合だけ、そのcorruption controlを
識別成功と数える。

古い上位digestを残したtrivial hash mismatchは保存byte改変の検査には使えるが、role、base、snapshot、
patch等のcausal relationを識別した証拠には数えない。

### 4. behavior manifestを保存bytesから検証する

v5 manifestはrequired behavior payloadをmanifest／payload双方に持ち、両path集合を全単射にする。
byte count、SHA-256、media type、writerのcanonical pretty JSON bytes、patch bytesを検査した後だけ
payloadをartifactとして解釈する。

RC1 v5のbehavior artifact gateでは、manifest `base_sha`をenvelope baseへ、
`result_digest`を`envelope_digest`へbindする。full campaign payloadは同manifestの個別file hashで保持し、
comparisonは同envelope digestを参照する。

### 5. malformed validator inputはfalseへ閉じる

公開validatorは構造不正でnative exceptionを漏らさない。特にarray itemが`null`、sparse、extra property、
不正prototypeを含む場合もfalseを返す。compile APIの明示的契約違反と、predicate APIのfalseを区別する。

## Rejected alternatives

- **base SHA一致だけでpreを受理する:** 同じcommitを名乗る別surfaceを再封印した反実仮想を排除できない。
- **stale envelope digestでcorruption testを通す:** relation検査を削除してもgreenになり、v4と同種の非識別を残す。
- **comparisonのbehavior summaryを再利用する:** full receipt、snapshot、patchへの帰属を独立再計算できない。
- **JSONをparseできれば保存payloadとして受理する:** duplicate keyや非正規bytesでparser依存のartifact identityを許す。
- **validator exceptionをcallerに処理させる:** false predicateと実装例外を混ぜ、fail-closed契約を不安定にする。

## Consequences

- RC1-O2とO2Bを完了とし、O1とO2を満たすまでRC1-Pへ進めない。
- O1はpre surface digestをtransform source snapshot identityとして渡せるreceiptを生成する必要がある。
- Pはpost surfaceをaccepted transform outputへ一致させ、behavior envelope生成失敗時に再index／recompileへ進まない。
- Qの保存artifact corruption suiteは依存digest再封印型を使い、単なるbyte tamper testと分ける。
- v4 sourceと`artifacts/v4`は変更しない。O2受入はH1-v5または閉ループ全体の支持を意味しない。
- Latticeだけをwriter scopeとし、dotagents／Observer関連repoはread-only、remote作成・push・publishは禁止を維持する。
