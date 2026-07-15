# ADR 0007: boundary manifestへmanual evidence provenanceを持たせる

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v2`
- supersedes: ADR 0006の`boundary_manifest.v1` root shapeだけを訂正する。他のfoundation受入は維持する。

## Context

RC1-Dでnormal／shared-state negative controlを同じcompilerへ接続すると、現manifestはmanual evidence全体のdigestを
`source.manual_evidence_digest`へ持つ一方、個別の`evidence_refs`が参照できるのは`graph_evidence`だけだった。

この形で`dispatch-registry` state conflictを作ると、次のどちらかになる。

- state conflictが個別根拠を参照できない。
- 無関係なCodegraph status／query recordを根拠として参照し、provenanceを偽る。

後者はschemaを通すための虚偽であり、Codegraph証拠とLatticeが補うstate／effect証拠を区別する製品契約に反する。

## Decision

`lattice.boundary_manifest.v1`のrootへ次を追加する。

```text
manual_evidence: [{ id, todo_id, result_digest }]
```

- `id`と`todo_id`はbounded identifier、`result_digest`は対応する入力recordのcanonical SHA-256とする。
- graph evidence IDとmanual evidence IDはdisjointにする。
- RC1 subsetではTODOごとにexactly one manual evidence recordを要求し、全TODOを過不足なく覆う。
- TODOとconflictの`evidence_refs`はgraph＋manual evidence IDのunionだけを参照できる。
- state／effect／manual unknown由来の境界は、関与TODOのmanual evidence recordを参照する。
- `source.manual_evidence_digest`は入力artifact全体のdigestとして残し、個別record digestと二重にbindする。

RC1-Dの既存nodeがこのschema訂正、control manifest、verdict、plan graphをまとめて実装する。新しいTask nodeやhard edgeは
追加しないためactive plan topologyは変わらず、plan versionは`lattice-research-campaign-1-v2`を維持する。

まだ`boundary_manifest.v1`の生成artifactをpublish／dispatchしていないため、RC1中はschema名をv1のまま訂正する。
外部consumerが存在した後の互換変更にはversion bumpを必須とする。

## Rejected alternatives

- **global digestだけにする:** 入力全体はbindできても、個別TODO／conflictの因果根拠を特定できない。
- **graph evidenceを代用する:** state／effect根拠をCodegraph由来に偽装するため棄却する。
- **manual入力全文をmanifestへ複製する:** provenanceには過剰で、TODO reads／writesとの二重表現がdriftしやすい。
- **新plan nodeへ分離する:** RC1-Dの成立条件そのもので、独立dispatch可能な成果ではないためtopologyを増やさない。

## Consequences

- artifact validatorはmanual recordのexact shape、coverage、ID disjointness、全`evidence_refs`をfail closedに検証する。
- control compilerはnormal条件でも2 TODO分のmanual provenanceを出し、shared-state conflictはその2 recordだけを根拠にする。
- RC1-Aのcanonical byte／digest、verdict、plan graph、plan diff契約は変更しない。
- dotagentsおよびObserver関連repoのwriter境界は変更しない。
