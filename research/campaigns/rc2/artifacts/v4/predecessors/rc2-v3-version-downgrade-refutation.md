# RC2 artifact v3 version-downgrade Phase反証

- 観測日: 2026-07-16
- 対象source HEAD: `3de508e`
- canonical v2 base: `888b32e68c4a960506a24724a9c0a0e47ba81471`
- canonical v3 corrected base: `68b23ee292546ddd7db12ec7c0fd3bc871849469`
- 対象Decision: [ADR 0041](../adr/0041-rc2-artifact-semantic-oracle-mutation-binding.md)
- severity: P1

## 反例

canonical fileは変更せず、次のartifact setをmemory上に構成して`verifyRc2CampaignArtifactSet`へ渡した。

1. v3 exact path setを土台にし、v3-onlyのADR 0041、semantic reseal characterization、v2 manifest、v2 planだけを保持する。
2. その他の共通payloadをすべてcanonical v2から置換する。
3. v2 `identity.json`のschemaだけをexecution identity v3へ更新する。
4. v2 plan v3をpredecessorにplan v4を作り、mixed payloadから35 causal predecessor digestを再計算する。
5. plan diff、comparison、execution evidence、manifest entryを正規規則で再計算し、manifest schemaをv3にする。

これはrandom byte corruptionではない。全75 payloadのsize／SHA-256、behavior／mutation／receipt、causal predecessor、plan、comparison、
execution evidence、manifestを正規に再封印したversion downgradeである。

## 実結果

pure verifierは次を返した。

```json
{
  "valid": true,
  "failed_conditions": [],
  "candidate_digest": "30ee67852f7ab5fb0d9bf82f2a4c55b6569a76507b0df5b329290c84d29b49f5",
  "oracle_source_digest": "c4012dfc00cc5b0194bd1a87be4a4e0b20d45e784d49a987768eea1b9932fafe",
  "manifest_base_sha": "888b32e68c4a960506a24724a9c0a0e47ba81471",
  "corrected_base_sha": "68b23ee292546ddd7db12ec7c0fd3bc871849469"
}
```

15 checksは`exact_artifact_set`、`identity_binding`、`codegraph_config_binding`、`transform_binding`、`fresh_run_binding`、
`compiled_conditions`、`minimum_verification`、`repeat_reproducibility`、`rc1_transfer_binding`、`predecessor_binding`、
`version_barrier`、`cost_arithmetic`、`comparison_recalculation`、`hypothesis_recalculation`、`execution_binding`の全件がpassedだった。

## 破られる契約

- ADR 0041 §4はv3へsource digest更新済みactive candidate bytesを要求するが、旧candidate／oracle pairをv3として受理する。
- ADR 0041 §5.3–4はcorrected clean sourceからfresh observation／compileしてv3を発行するよう要求するが、v2のrun／compileを
  schema変更だけでplan v4へ再包装できる。
- 成功条件23のartifact-only再計算はrelationを再計算しても、artifact versionがどのactive witness epochを要求するか識別していない。
- 成功条件25はPhase反証に生き残るP1 0を要求するため、現時点では不成立である。

canonical v3 bytes自体が破損しているというfindingではない。問題は、canonical v3と因果的に異なる旧epochのartifact setを同じ15-check
receiptで識別できないことにある。署名、remote attestation、trusted verifier replacementというnon-goalとも異なる。trusted current verifierへ
正規payloadを渡しただけで再現するlocal version-contract欠陥である。

## Root cause

- `artifactContract`はmanifest schemaからpath set／identity schema／predecessor setを選ぶが、active candidate／oracle epochを選ばない。
- v1／v2 replay互換のためdelivery-policy front-endは旧／新candidate digest pairを共通許可する。
- `verifyTransformSemantics`はcandidate内のownershipとoracle semanticsを再計算するが、そのpairがartifact versionに対応するか検査しない。
- `verifyIdentity`は保存source bytesのself digestを検査するが、execution identity schemaをsource epochへbindしない。
- version barrierはplan v3→v4と35 predecessor relationを検査するが、run evidenceがcorrected epochかを区別しない。

## Correction boundary

次の設計仮説をcharacterizationと新ADRで裁定する。

1. artifact versionごとにexact active candidate digest／oracle source digest pairを持ち、v1／v2は旧pair、v3以降は新pairを要求する。
2. accepted／rejected transform source baseとmanifest／run baseのcross-bindingを補う。
3. v2 common payload＋v3-only predecessorを再封印した反例を`transform_binding`または新しいepoch checkでrejectする。
4. v1／v2／canonical v3 read compatibilityを維持する。
5. v1／v2／v3を変更せず、source correction後はartifact v4／plan v5へ再compileする。

## Audit independence

本反証時点でorchestrate Controlはworker 8／8、consultation 2／2を消費済みだった。予算を迂回した未記録subagentを起動せず、親が
read-only adversarial constructionを行った。このため「別実行者による独立監査済み」とは主張しない。一方、findingは監査役の評価ではなく、
全digest再封印後に15／15 validとなる実行可能な反例である。corrected successor後のPhase gateでもこの独立性制約を明記する。

dotagents／Observer関連repo write、remote作成、push、publishは0。related／full testはfinding記録のために反復していない。
