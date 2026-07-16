# ADR 0040: RC2 artifact publication後のCodegraph scopeを閉じ、artifact v2へ再compileする

- Status: Accepted
- Date: 2026-07-16
- Scope: post-artifact Codegraph scope、execution identity、immutable artifact successor、plan version barrier
- Amends: [ADR 0038](0038-rc2-closed-loop-version-and-artifact-contract.md)
- Related: [ADR 0030](0030-rc1-v6-artifact-chain-trust-boundary.md)、
  [ADR 0039](0039-rc2-opaque-predecessor-json-boundary.md)

## Context

RC2 artifact v1をcommitした後のfull `npm run ci`は163/167 passで、RC2 campaign共有fixtureの4 testだけが失敗した。
単独focused再実行も1/5 pass、4 failとなり、並列test干渉ではなかった。fresh cloneをCodegraph 1.4.1でfull indexすると、
artifact v1が保存した12個の`identity/*.mjs`がlive sourceと同じgraphへ入った。`src/rc2-delivery-policy-oracle.mjs`の
`affected`は、artifact commit前またはincremental indexでは3 testを返す一方、artifact commit後のfresh full indexでは
`affectedTests: []`、`totalDependentsTraversed: 3`となった。front-endはpresent pathの空affectedを独立へ丸めずfail-loudした。

これはv1のcontrol／treatment結果を反証する挙動差ではなく、immutable evidenceとして保存したsource preimageをactive codeへ再分類した
sensor scope欠陥である。しかしartifactをcommitした最終repositoryでcampaignが再実行不能なら、閉ループのpublication境界は閉じていない。
また除外設定がCodegraph出力を変える以上、そのbytesをexecution identityから省略できない。

Codegraph 1.4.1の同梱READMEと型定義は、git-trackedだがindex対象でないdirectoryをrepo-rootの`codegraph.json`に
gitignore-style `exclude`として記録し、index／sync／watch全てで除外する正規機構を明示している。

## Decision

### 1. immutable artifact identityをlive Codegraph scopeから除外する

Lattice rootへtracked `codegraph.json`を置き、exactly次のpatternを`exclude`へ入れる。

```json
{"exclude":["research/campaigns/**/artifacts/**/identity/"]}
```

除外対象はartifact内の保存execution bytesだけである。`src/`、`test/`、研究fixture、query input、compiled JSON、plan、patch、evidenceを
一括除外しない。保存identityはartifact verifierがbyte／digest relationを検査するuntrusted evidenceであり、live caller／callee／impactの
候補ではない。Codegraph global packageや`node_modules`は変更しない。

fresh index gateは`codegraph files`でartifact identity 0、live RC2 source収載、status complete／pending 0を別々に確認する。
空結果やconfig load failureを「除外成功」へ丸めない。

### 2. Codegraph project configをexecution identityへ追加する

次回campaignはtarget repositoryで実際に使った`codegraph.json`のactual bytes、byte length、SHA-256を開始前後にcaptureする。
Codegraph identity v2はexecutable version／bytesに加え、config artifact ref／digestを持つ。artifact v2はconfig actual bytesを
`identity/codegraph-config.json`へ保存し、manifest、identity digest、各fresh run measurementへcross-bindする。

v1 artifactはconfig不存在時のhistorical identityとして変更しない。trusted verifierはv1 identityを引き続き読めるが、v2 identityを
v1 shapeへdowngradeして受理しない。config変更、欠落、非canonical JSON、digest不一致はfail-closedにする。

### 3. v1を上書きせずartifact v2とplan v3を作る

ADR 0038の`research/campaigns/rc2/artifacts/v1`はimmutable predecessorとして残す。corrected campaignはclean final source commitから同じ
control／treatment 2+2、RC1 transfer 1+1をfresh full indexし、`research/campaigns/rc2/artifacts/v2`へatomic発行する。

v2 artifactはv1 exact path setに次を追加する。

- `identity/codegraph-config.json`
- `predecessors/adr-0040.md`
- `predecessors/rc2-v1-artifact-manifest.json`
- `predecessors/rc2-v1-new-plan-version.json`

manifest schemaとexecution identityをv2へ上げ、disk loaderはmanifest versionごとのcompile-time exact path setだけを読む。
v1 verifierの14 checksを維持し、v2 verifierはconfig binding、v1 predecessor byte identity、v2 relationを追加検証する。

v2 campaignはplan `rc2-delivery-policy-v2`をpredecessorに、同じaffected 3 TODOを全再compileした
`rc2-delivery-policy-v3`を発行する。topologyが同じでも、post-publication sensor config、fresh evidence、source identityが変わるため
旧planへ追記しない。old plan／agent context／partial patch／interface assumption／v1 boundary evidenceを失効する。

### 4. v2差分を新しい独立変数にしない

control／treatmentの独立変数は引き続きaccepted registry-shard patchだけとする。artifact exclusion configは両condition、全repeat、
RC1 transferへ共通のmeasurement scopeである。v1とv2のelapsed、temp path、raw telemetry byte一致は要求しない。
primary conflict 12→0、minimum waves 3→1、partial-state 2、capacity 2、third-only unknown、RC1 transfer isomorphismが維持されなければ、
v2を発行せずRC2仮説またはsensor設計の反証として扱う。

## Rejected alternatives

- **front-endでfixed oracleのempty affectedだけを無条件受理する:** artifact sourceのlive graph混入を残し、fresh／incremental差を隠す。
- **artifact identityを`.gitignore`へ追加する:** tracked pathは除外できず、Codegraph一次資料の正規機構にも反する。
- **保存`.mjs`の拡張子を変える／内容を削る:** immutable v1を改変し、実行主体preimageを失う。
- **global Codegraphをpatchする:** 第三者製品所有境界と再現性を破る。
- **v1 rootを削除・上書きする:** immutable evidenceとplan predecessorを破る。
- **topology不変を理由にplan v2を継続する:** sensor configとfresh evidenceが変わった後の旧contextを有効扱いする。

## Consequences

- RC2-Hにpost-publication closure correctionを追加し、full CIはcorrection収束後に再実行する。
- artifact verifier／campaignはv1 read compatibilityとv2 write contractを明示的に分ける。
- v2はv1より4 payload多く、configとv1 predecessor relationを保存する。
- artifact publicationがCodegraph live scopeを変えないことをfresh clone integration testで継続確認する。
