# RC1-D control compiler contract

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v2`の既存RC1-D node
- classification: F。typed verdictとplan topologyを生成する契約中枢のため親直轄。
- Decision: [ADR 0007](../adr/0007-manual-evidence-provenance-in-boundary-manifest.md)

## Source-edit preflight

Codegraph 1.4.1は13 files、154 nodes、603 edges、index complete、pending changes／refs 0、mismatchなし。

- `validateBoundaryManifest`は`src/artifact-contracts.mjs`に実在し、callerは
  `test/artifact-contracts.test.mjs`、impactも同testを返した。
- planned `compileControlArtifacts`はquery／caller／callee／impactがtyped `symbol_absent`。
- `src/artifact-contracts.mjs`のaffected testは`test/artifact-contracts.test.mjs`。
- planned `src/control-compiler.mjs`のaffected testは空で、依存なしでなく`new_surface_unknown`。
- planned `test/control-compiler.test.mjs`はtest自身だけを返し、source impactの証明には使わない。

## Public API

```text
compileControlArtifacts({
  planInput,
  manualEvidence,
  querySet,
  codegraphEvidence,
  codeSnapshotDigest
})
```

入力artifactをexact／boundedに検査し、query setとCodegraph outcomeをID／operation／順序まで一致させる。空・欠落・重複・
stale／failureをfallbackで補わない。成功時は次を返す。

```text
{
  boundary_manifest, boundary_manifest_digest,
  boundary_verdict, boundary_verdict_digest,
  plan_graph, plan_graph_digest
}
```

digestはpayload外のcanonical SHA-256である。同一入力からbyte-identical payloadとdigestを再生成できなければ失敗とする。

## RC1 compile rules

- plan TODOのanchor symbol／pathを`owns`とcode writeへ置く。
- manual `state_reads`はread、`state_writes`はwrite、`effects`はeffect writeへ型付けする。
- 同じmonolithic symbol／pathは1つの`write_boundary`へcoalesceし、controlのwrite conflictを1件にする。
- shared stateは片側以上がwriteする場合に`state` conflict、shared effectは`effect` conflictにする。
- manual unknownまたはfail-loud graph outcomeはunknownとして消さない。
- normal条件でmanual state／effect conflictがなければ`seam_candidate`を生成する。RC1 fixtureのconcernと固定query setから
  `selectDispatchChannel`／`dispatch-channel.mjs`、`formatDispatchLabel`／`dispatch-label.mjs`の非重複ownershipを作る。
- shared-state negative条件ではcode seamだけで切れないため`intentional_serial`とし、`parallel_ready`を禁止する。
- control planはcapacity 2でもwrite conflict edgeにより2 wave、hard need 0とする。

## Acceptance

- normal: manifest validator green、write conflict 1、`seam_candidate`、plan 2 wave。
- negative: write conflict＋state conflict、manual provenance参照、`intentional_serial`、false `parallel_ready`なし。
- graph outcome欠落、query drift、manual TODO mismatch、affected test欠落をfail closedにする。
- focused unitをTODO gateで1回、実Codegraph inputからartifact生成するrelated integrationをacceptance時に1回実行する。
- full `npm run ci`はRC1-Gへ集約する。

## Non-goals

- seam code transform、treatment post-index、plan v2／plan diffはRC1-E／Fで行う。
- arbitrary codebase向けのgoal decompositionや一般seam synthesisへ拡張しない。
- Codegraph、dotagents、Observer関連repoを編集しない。
