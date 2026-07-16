# RC2 opaque predecessor verification

- 記録日: 2026-07-16
- scope: ADR 0039 implementation／RC2-G artifact verification
- artifact verifier source SHA-256: `e44f6ca605d9f368a3ed73cf6b534df75a7ac5493ca4c9a6155e0934e89d844b`
- focused test: `node --test test/rc2-campaign.test.mjs`

## Exact boundary

canonicality例外はADR 0039が固定した次の3 pathだけである。

- `predecessors/rc1-v6-artifact-manifest.json`
- `predecessors/rc1-v6-transform-artifact.json`
- `predecessors/rc1-v6-transform-receipt.json`

verifierはexact artifact path set、manifest entry、actual byte length／SHA-256を確認してから3 payloadを`JSON.parse`する。
それ以外のRC2-owned JSONは従来どおり`canonicalizeArtifact`とのbyte equalityを必須とする。directory prefixや拡張子で例外を
拡張せず、RC1 bytesを再serializeしない。

## Reproduction and correction chain

初回focused gateは、3 predecessor JSONがRC1 v6のpretty JSON exact bytesでありRC2 canonical bytesではないため、
`exact_artifact_set`でfail-loudした。compile-time exact setを実装後、このcheckを通過した。

次に`identity_binding`がfailし、生成側snapshotは各sourceの`runtime_path`、`artifact_ref`、`digest`をhashする一方、
verifierだけが`artifact_ref`を落とした異なるprojectionを再構成していることを実測した。12 source refs、各source payload digest、
Codegraph executable digest、Codegraph identity digestは全て一致し、snapshot projectionだけが不一致だった。verifierを生成時と同じ
exact schemaへ訂正し、characterizationへidentity self-digest assertionを追加した。

raw chunk characterizationは当初すべてのreceiptへ複数chunkを要求していたが、実payloadはサイズが異なる。固定12,000-byte chunkの
正しい個数を`ceil(base64 bytes / 12000)`で要求し、16KiB超のpayloadだけへ複数chunkを要求する識別可能な条件へ訂正した。

## Gates

- focused final: 5 pass / 0 fail / 0 skip、47.365秒。
- pure artifact verifierはvalid、disk-only verifierもvalid。
- predecessor bytesを書き換えmanifestを再封印したcorruptionは、保存済みcausal digestとの不一致により
  `predecessor_binding`で拒否される。
- identity snapshotは生成時と同じsource projectionからself-digestを再計算して一致する。
- post-sync Codegraphで`verifyIdentity`は`src/rc2-artifact-set.mjs`のexact symbol、callerは
  `verifyRc2CampaignArtifactSet`、impactはwriter／disk verifier／campaign testまで到達した。affected testは
  `test/rc2-campaign.test.mjs`だった。

full CIはRC2 Phase gateへ集約し、このTODOでは再実行していない。

## Boundary

RC1 artifactは変更・再発行していない。Lattice以外のrepoへのwrite、remote作成、push、publishは行っていない。
