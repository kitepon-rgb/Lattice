# RC1 v6 Phase gate evidence

- 日付: 2026-07-16
- plan version: `lattice-research-campaign-1-v6`
- TODO: RC1-Y
- Decision: [ADR 0031](../adr/0031-rc1-v6-phase-gate-support.md)
- canonical artifact: `research/campaigns/rc1/artifacts/v6`

## Gate inputs

- implementation commits: `97f072b`、`724d2fe`
- immutable artifact commit: `3533ec0`
- campaign base: `724d2fee8abb6219c4c5d3979c494ab1ca46b163`
- result digest: `dd2a99ce959349de5087648780cbe829898de9246e0d53cd4b3a1fc9d9282b96`
- RC1-X evidence: [immutable closed loop](2026-07-16-rc1-v6-immutable-closed-loop.md)
- correction evidence: [media type correction](2026-07-16-rc1-v6-media-type-correction.md)

## Full regression

source convergence後にfull gateを一回だけ実行した。

```text
$ npm run ci
npm test: tests 97 / pass 97 / fail 0 / skip 0
npm run check: success
```

full testにはunit、actual Codegraph／Git／isolated worktree integration、v4／v5 non-identifiable controls、v6 causal corruption、
v6 2+2 temp campaignが含まれる。実canonical v6 artifactはRC1-Xで別に発行・disk検証済みであり、temp testを代用していない。

## Phase反証

ユーザーからこのPhaseでの新規子委譲の明示許可はなく、Controlのworker budgetも8/8だったため、新しい独立subagent監査は行っていない。
規約どおり親が一回、次の三視点を分離して反対仮説を検証した。

### 1. 識別性

- fixed inputはplan、candidate、normal／negative manual evidence、query set、oracle、runtime、Codegraph identity、capacity。
- independent variableはaccepted production＋test seamだけ。control snapshotとtreatment snapshotの差はtransform outputへexact一致する。
- control／treatment各2 bundleはportable evidenceが条件内一致し、全runは別descriptor、snapshot、base／patchへ結合される。
- same compilerはnormal／negativeの8 compileをreplayする。condition selectorはforbidden。
- negativeがtreatmentでも2 wavesのため、「compilerが常にparallelを返す」対立仮説は成立しない。

finding: 仮説を非識別にするinput driftは再現しなかった。

### 2. 実コード／artifact chain

- committed diskからverifierを再実行し12/12 checks、failed 0を確認した。
- saved boundary compiler／oracle executor bytesのdigestは現sourceと一致した。
- Codegraph executableはversion 1.4.1、digest固定、media type `application/javascript`。
- plan diffはordered 8 predecessor、accepted transform、behavior envelope、4 bundle descriptorから再構成された。
- v5で通るoracle substitution、false pass、case truncationをcontrolとして保持し、v6はsemantic substitutionをrejectした。

finding: manifest再封印だけで今回のcorruption caseを通す経路は再現しなかった。

### 3. 安全事故経路

- transformはdisposable worktreeだけで適用され、canonical source invariantはcontrol／treatmentともtrue。
- 実行前後のworktreeはcanonicalと既存2件の同じ集合で、一時worktree漏れはない。
- v4／v5 artifactは上書きせず、v6を別pathへatomic renameした。
- 最初のv6候補のmedia type欠陥はTODO監査で検出した。手補正せず、修正を独立commitし、未受理候補を全削除してfresh 2+2を再実行した。
- dotagents／Observer関連repoへのwrite、remote作成、push、publishは行っていない。

finding: source汚染、scope外write、cleanup漏れ、旧artifact上書きの事故経路は再現しなかった。

## 残る限界

- 単一の研究fixtureなので任意repoへの一般化は未検証。
- artifact-only verifierは内部causal consistencyを検証する。署名なしの別の完全自己整合artifactの発行者真正性は証明しない。
- Codegraph identityはcampaign前後のresolved executable bytesと全raw status versionでbracketする。cooperative local processを前提とし、
  実行中にPATH／executableを敵対的に差し替えるattackは検証していない。

これらはRC1の明示non-goal／threat modelであり、固定fixtureのH1-v6を反証する実測ではない。Phase findingは0、Decisionはsupport。
