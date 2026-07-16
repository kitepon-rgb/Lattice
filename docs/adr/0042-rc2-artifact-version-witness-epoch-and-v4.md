# ADR 0042: artifact versionをactive witness epochへbindしv4へ再compileする

- Status: Accepted
- Date: 2026-07-16
- Scope: RC2-H2のartifact-only verifier、transform source identity、version barrier
- Amends: [ADR 0038](0038-rc2-closed-loop-version-and-artifact-contract.md)、
  [ADR 0041](0041-rc2-artifact-semantic-oracle-mutation-binding.md)
- Evidence: [RC2 artifact v3 version-downgrade Phase反証](../evidence/2026-07-16-rc2-v3-version-downgrade-refutation.md)

## Context

ADR 0041実装後のPhase再反証で、canonical v2の共通payloadとv3-only predecessor 4件を組み合わせ、execution identity、plan、
comparison、execution evidence、manifestを正規再封印したartifact setが、v3 verifierの15 checksをすべて通ることを再現した。

誤受理setはv2のcandidate digest `30ee67852f7ab5fb0d9bf82f2a4c55b6569a76507b0df5b329290c84d29b49f5`、oracle source
digest `c4012dfc00cc5b0194bd1a87be4a4e0b20d45e784d49a987768eea1b9932fafe`、base SHA
`888b32e68c4a960506a24724a9c0a0e47ba81471`を保持したまま、plan v4と35 predecessorを持つv3として`valid: true`になった。

これはmanifest self-digestの破損でもremote authenticityの問題でもない。current trusted verifierが、artifact versionとactive candidate／oracle
witness epochの関係を検査していないlocal contract欠陥である。ADR 0041 §4–5が要求するupdated active candidateとcorrected clean sourceからの
fresh compileを、旧epochのrun／compileから区別できない。

## Decision

### 1. artifact versionはexact witness epochを選ぶ

artifact contractはpath、identity、predecessor setに加え、次のexact pairをversion別に返す。

| artifact version | epoch | candidate digest | oracle source digest |
|---|---|---|---|
| v1 | `delivery-policy-legacy-v1` | `30ee67852f7ab5fb0d9bf82f2a4c55b6569a76507b0df5b329290c84d29b49f5` | `c4012dfc00cc5b0194bd1a87be4a4e0b20d45e784d49a987768eea1b9932fafe` |
| v2 | `delivery-policy-legacy-v1` | 同上 | 同上 |
| v3 | `delivery-policy-semantic-v2` | `4cc5d7bb428a8899353d18524c25105742fa90f89ee55d36064c4be3c52e2907` | `c68a7ff9a7c9c4a181ceda6396d5fcbf27084de18680018d244a27998041652c` |
| v4 | `delivery-policy-semantic-v2` | 同上 | 同上 |

`verifyTransformSemantics`は保存candidateを再計算したdigestとoracle source digestが、cross-bindingだけでなくartifact contractのpairにも
一致することを要求する。v1／v2 replayのためfront-endがlegacy pairを読めることと、v3以降がlegacy pairを受理することは別問題である。
front-endのversion非依存read compatibilityは維持し、artifact verifierがversion固有epochを選ぶ。

将来oracle semanticsまたはcandidate witnessを変更する場合は、旧mappingを削除せず、新artifact versionとepochを加算する。

### 2. manifest baseと全transform outcome sourceをcross-bindする

accepted transform、rejected incomplete transform、rejected scope transformの`source.base_sha`はmanifest `base_sha`と一致しなければならない。
run measurementは既にmanifest baseへbindされているため、これによりtransform transactionとfresh sensor runsが同じsource baseを持つ。

accepted／rejected artifactのcandidate ID／digest、fixed oracle path／digest、adapter path／digestも、該当する保存identityとversion witnessへ
cross-bindする。rejected controlをsource epochから切り離してよいfallbackにはしない。

base SHAの特定値をsourceへハードコードしない。clean test cloneや将来のbehavior-preserving source commitでも、同一artifact set内の因果関係を
満たせばよい。version固有性はcandidate／oracle epochで識別する。

### 3. v2→v3再包装をcharacterization contractにする

canonical v2 common payload、v3-only predecessor、正規再封印したplan／manifestを組み立てる反例をtest helperとして固定する。production fix前は
`valid: true`のexpected-red、fix後は`transform_binding`でrejectする。単一field corruptionではなく、全downstream relationを再計算した
version downgradeを保持する。

同じfocused gateでcanonical v1 14 checks、v2 15 checks、v3 15 checksをgreenのまま維持する。check ID／件数を増やさず既存
`transform_binding`の意味を強化する。

### 4. v1／v2／v3を不変に保ちartifact v4／plan v5を発行する

canonical v1／v2／v3、ADR 0038／0041は変更しない。writer targetを`research/campaigns/rc2/artifacts/v4`へ進める。

artifact v4はv3 exact setへ少なくとも次を加算する。

- 本ADRとversion-downgrade反証evidenceのexact bytes。
- canonical artifact v3 manifestとplan `rc2-delivery-policy-v4`のexact bytes。

manifest schemaは`lattice.rc2.artifact_manifest.v4`、execution identityはv4とする。new planは
`rc2-delivery-policy-v5`、predecessor versionはv3 artifactの`rc2-delivery-policy-v4`。v3の35 causal predecessorsへ上記4件を加え、
39件をexactly once持つ。3 TODO全件をfresh treatment evidenceから再compileし、旧plan／agent context／partial patch／interface assumption／
boundary evidenceをv4 refsで失効する。

oracle／candidate source bytesはsemantic-v2 epochのままなのでactive candidate inputを変更しない。artifact verifier／campaign source identityの変更は
v4 execution identityへ保存する。

### 5. correction gateを再度分離する

実装順は次で固定する。

1. 本Decisionとplanをdocs-only commitにする。
2. version downgradeをproduction変更前のexpected-red characterizationとして独立commitする。
3. source編集前にartifact verifier、campaign、front-end、transform、candidate consumerのCodegraph境界を開き直す。
4. version witness／base bindingを実装し、downgrade rejectとv1／v2／v3 replayをgreenにする。
5. corrected clean sourceからfresh campaignを実行し、artifact v4／plan v5をatomic発行する。
6. post-publication reindex、related、full CIの後、RC2成功条件だけを一回Phase再反証する。

version downgradeがrejectされない、canonical v1／v2／v3がinvalidになる、v4がv3 planをpredecessorにできない、fresh structural resultが変わる
場合はv4を発行せず、後続ADRで再裁定する。

## Consequences

- artifact schemaだけ上げたlegacy witness replayを、全digestが整合していても拒否できる。
- front-end read compatibilityとartifact version acceptanceを分離し、旧artifact replayを壊さない。
- transform outcomeとfresh runsが同じmanifest baseへbindされる。
- canonical v3はPhase反証P1を含むimmutable predecessorとして残り、corrected support claimはv4／plan v5だけが担う。
- source／artifactが再び変わるため、related／full gateとPhase反証の再実行は必要な新証拠であり反復監査ではない。

## Non-goals

- 署名、remote attestation、保存process outputの真正性、malicious trusted-verifier replacementを解決しない。
- candidate witnessをrequirementsから自動発見したとは主張しない。
- registry shardを任意repoへ一般化せず、actual multi-agent wall-clock改善を主張しない。
- Observerをfixtureにせず、dotagents／Observer関連repoを編集しない。remote作成、push、publishを行わない。
