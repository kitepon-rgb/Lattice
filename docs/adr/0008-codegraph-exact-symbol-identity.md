# ADR 0008: Codegraph検索候補とexact symbol identityを分離する

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v2`
- 対象Control: `lattice-rc1-closed-loop-v3`
- amends: ADR 0006のRC1-B受入条件を補強する。

## Context

RC1-Dの実Codegraph integrationで、未作成の`selectDispatchChannel`が`ready`と観測された。indexはreadyであり、
Codegraph queryの実node identityは`SEAM_BY_CONCERN`だった。target textはそのconstant signature内に文字列として含まれるだけで、
関数symbolは存在しなかった。`callers`／`callees`／`impact`のJSONにある`symbol` fieldもrequested textを反復するため、
それだけではCodegraphが選択したroot identityを証明しない。

このfalse positiveを受け入れると、pre-transformで未作成seamを既存と誤認するか、逆に別symbolのimpactをseam evidenceへ
混入し、boundary verdictとpre／post比較を非識別にする。

## Decision

- `query` outcomeはJSON配列の非空性で決めない。各candidateの`node.name`または`node.qualifiedName`がtargetと
  exact一致する場合だけ`ready`とする。
- JSON配列が空、またはfuzzy candidateだけなら`symbol_absent`とする。候補を依存なしの証明には使わない。
- `callers`／`callees`／`impact`がJSONを返した場合も、同targetのCodegraph queryを実行し、exact node identityが
  解決した時だけtraversal outcomeを`ready`へ昇格する。
- exact resolutionのcommand failure、invalid JSON、非JSON近似messageはそれぞれのtyped failureを保持する。
  operation本体が返すexactなANSI付き`Symbol not found`だけは従来どおり`symbol_absent`とする。
- readyなtraversal evidenceには、exact一致したquery candidateを`resolution`として保持する。

## Rejected alternatives

- **compiler側で今回の`ready`だけ無視する:** sensor defectをconsumerごとに複製し、別query setで再発する。
- **score閾値で判定する:** scoreはidentityではなく、Codegraph versionやcorpusでdriftする。
- **JSONの`symbol` fieldを信頼する:** fuzzy traversalでもrequested textが入る実測に反する。
- **未作成seamの期待値を`ready`へ変える:** false positiveを実在へ偽装し、control conditionを破壊する。

## Consequences

- symbol traversalは追加queryを1回行う。RC1では観測の同定可能性を優先し、このbounded costを受け入れる。
- Codegraphのfuzzy search結果自体は破棄せず、query outcomeの`data`へ保持する。
- 修復の実測・focused／related gateは
  [RC1-B2 evidence](../evidence/2026-07-15-rc1-codegraph-exact-symbol-repair.md)へ固定する。
- Codegraph、dotagents、Observer関連repoのwriter境界は変更しない。
