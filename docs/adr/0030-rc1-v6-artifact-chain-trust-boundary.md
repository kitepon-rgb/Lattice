# ADR 0030: RC1 v6のartifact chainを実bytesから再計算し、disk loaderを固定pathへ限定する

- 状態: Accepted
- 日付: 2026-07-16
- 対象plan: `lattice-research-campaign-1-v6` / RC1-W〜X
- 対象Control: `lattice-rc1-closed-loop-v3`
- predecessor: ADR 0029
- evidence: [RC1 v6 artifact chain](../evidence/2026-07-16-rc1-v6-artifact-chain.md)

## Context

ADR 0029はoracle semantics、runtime、source snapshot、Codegraph identity、bundle descriptor、plan predecessorのtyped
preimageを定めた。しかしidentity objectにsource／executable digestだけを保存しても、artifact-only verifierがそのdigestを
実bytesから再計算できなければ、manifestを再封印した実行主体bytesの置換を検出できない。

またdisk loaderがmanifest記載pathをそのまま読む設計は、semantic verificationより前にartifact root外を読む事故経路を作る。

## Decision

### 1. 三つの実行主体bytesをexact artifact setへ含める

v6はboundary compiler、black-box oracle executor、実際にPATH解決したCodegraph executableのbytesをimmutable artifactへ保存する。
verifierは保存bytesのSHA-256を再計算し、comparison／executionのcompiler identity、runtime identityのexecutor digest、
Codegraph identityのexecutable digestへ照合する。

### 2. artifact-set verifierは保存payloadだけからcausal relationを再計算する

verifierはmanifest byte hashだけを成功条件にしない。保存oracleからreceipt semanticsを、behavior surface／accepted transformから
control／treatment snapshotを、raw evidenceとmeasurementからcompiler inputを再構成し、normal／negativeを同じcompilerへ再入力する。
plan diffはv5 rejected archive、ADR 0028、accepted transform、behavior envelope、4 bundle descriptorのordered 8 predecessorから再構成する。

### 3. disk loaderはcompile-timeのexact path setだけを読む

disk入口はcanonical manifestを確認した後もmanifest由来の任意pathを読まない。v6 verifierが定義するexact path setだけを
artifact rootから読み、pure verifierへ渡す。missing fileはI/O failure、余分／不足／重複pathはexact-set failureとする。

### 4. 保存実行コードはverifier内で実行しない

artifactはuntrusted inputである。保存compilerやexecutableを検証のために実行すると任意コード実行になるため、identity bytesの
digest再計算と、trusted v6 verifierによるcompiler replayを分離する。v6が証明するのは一つのartifact set内部の因果整合性であり、
署名や透明性logを持たない別の完全に自己整合したartifactの発行者真正性ではない。

## Rejected alternatives

- **digest値だけを保存する:** digest preimageの置換をartifact-onlyに検査できない。
- **manifest pathをそのまま読む:** path traversalと責務外file readの事故経路になる。
- **保存compiler／executableをimportして実行する:** untrusted artifactによる任意コード実行になる。
- **v5 artifactを追記更新する:** rejected plan versionを可変化しversion barrierを破る。

## Consequences

- `artifacts/v6`はv5と別のimmutable directoryとしてatomic発行する。
- verifierはmanifest再封印だけではsemantic substitutionを受理しない。
- 実行主体identityのauthenticityが将来必要なら、artifact signing／transparencyを別plan versionのtrust rootとして設計する。
- RC1-Xはこのexact setを実fixtureで発行し、disk再読込結果をPhase evidenceへ保存する。
