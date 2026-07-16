# ADR 0039: RC2のopaque predecessor JSONとowned canonical JSONを分離する

- Status: Accepted
- Date: 2026-07-16
- Scope: RC2-G artifact setのJSON canonicality、predecessor byte identity、disk-only verification
- Related: [ADR 0030](0030-rc1-v6-artifact-chain-trust-boundary.md)、
  [ADR 0038](0038-rc2-closed-loop-version-and-artifact-contract.md)

## Context

ADR 0038は、RC1 v6 predecessor artifactをRC2 artifact内へexact bytesでcopyし、plan predecessor relationを
保存bytesから検証可能にする。同時にdisk-only verifierへartifact JSONのcanonicality検査を要求した。

RC1 v6のartifact manifest、transform artifact、transform receiptはimmutable predecessorとしてpretty JSON bytesで保存済みである。
これらをRC2 canonical JSONへ再serializeすると元bytesのSHA-256が変わり、exact predecessorという因果preimageを失う。
一方、全JSONをcanonicality検査から外すと、RC2が所有するrun、compiled condition、plan、comparisonのbyte表現が可変になる。

したがって「元bytesを証拠にするopaque predecessor」と「RC2が新規生成するcanonical JSON」をpath単位で分離する必要がある。

## Decision

### 1. opaque predecessor JSON pathをcompile-time exact setに限定する

RC2 artifact setでcanonicality例外にできるJSONは次の3 pathだけとする。

- `predecessors/rc1-v6-artifact-manifest.json`
- `predecessors/rc1-v6-transform-artifact.json`
- `predecessors/rc1-v6-transform-receipt.json`

manifest記載path、拡張子、directory prefixから例外を拡張しない。RC2-owned input、identity、run、compiled condition、plan、comparison、
hypothesis、cost、execution evidence、manifestは引き続きRC2 canonical JSONを必須とする。

### 2. opaque predecessor bytesを再serializeしない

campaignは3 predecessorをRC1 v6からbyte-exactにcopyする。RC2 writerとverifierはwhitespace、object key order、newlineを変更しない。
RC2 manifestのbyte length／SHA-256、new planのcausal predecessor descriptor、plan diffのpredecessor relationはcopyしたactual bytesへbindする。

### 3. byte identity確認後だけtrusted verifierがJSON parseする

pure verifierはcompile-time exact path set、RC2 manifest entry、payload SHA-256を確認した後、3 opaque predecessorを`JSON.parse`する。
parse failure、期待schema／relation不一致、RC1 transform patch digest不一致はfail-closedにする。parseしたpredecessor objectをRC2 canonical bytesへ
変換して同一性判定に使わない。

保存されたsource／executableを実行しないというADR 0030のtrust boundaryは維持する。opaqueは未検証を意味せず、
serialization canonicalityの代わりにexact byte identityとsemantic relationを検査することを意味する。

### 4. manifest再封印だけではcorruptionを受理しない

opaque predecessorのbytesとRC2 manifest SHAを同時に書き換えても、new plan／plan diffが持つ旧digestとの不一致を
`predecessor_binding`で拒否する。RC2-owned JSON corruptionはcanonicality、manifest、各semantic checkの全てを通る必要がある。

## Rejected alternatives

- **RC1 predecessorをRC2 canonical JSONへ変換する:** exact predecessor bytesと既存RC1 digestを失う。
- **全`.json`をopaqueとして扱う:** RC2-owned artifactの一意なbyte表現を失う。
- **`predecessors/`配下を一括例外にする:** 将来追加pathや攻撃者が差し込むJSONへ例外を拡張する。
- **manifest SHAだけを検査する:** payloadとmanifestを同時に再封印するsemantic substitutionを検出できない。
- **opaque JSONをparseしない:** RC1 transform／patch／plan relationを保存bytesから再計算できない。

## Consequences

- artifact loaderはRC2 canonical JSONと3 opaque JSONを別のparse pathで扱う。
- exact artifact path setへ別のopaque JSONを追加する場合は、新しい不変Decisionが必要になる。
- RC1 artifactは変更・再発行しない。
- RC2 campaignのpredecessor descriptorはserialization形式でなくactual copied bytesのdigestを持つ。
