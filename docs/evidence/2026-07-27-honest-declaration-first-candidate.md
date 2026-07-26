# bk-003: 正直な宣言のままseam候補が出た（同名symbolの資源内解決）

- 日付: 2026-07-27
- plan: `backlog` / task `bk-003`（ADR 0133 Open question 1の裁定）
- 裁定: [ADR 0134](../adr/0134-ambiguous-symbol-receipt-narrowed-by-declared-resource.md)
- 対象plan: `todo-independence-ops`（`tio-008` / `tio-009`）
- base: `3dbbe58`

## 直前の状態

[2026-07-27の初回実行記録](2026-07-27-concern-declaration-first-candidate.md)では、`seam_candidate`は
**探りの宣言**からしか出なかった。`tio-009`が実際に触る`summarizeIndependence`を宣言から
落とした場合にだけ候補が出て、落とさない正直な宣言では`concern_anchor_unresolved` 1件で止まっていた。
`summarizeIndependence`が`src/todo-gantt-html.mjs`と`src/project-cli.mjs`の2 fileに同名で存在し、
receiptが`resolved_path`を単数しか持てないため、解決結果が`unknown`へ潰れていたためである。

## 今回の実行

storeにcommit済みの**正直な宣言**（`summarizeIndependence`を含む5 symbol）をそのまま使った。
宣言は一切変えていない。

```
lattice todo independence compile --plan todo-independence-ops --input .lattice/todo/witness/todo-independence-ops.json
→ outcome compiled / task_count 4 / conflict_count 1 / unknown_count 0

lattice todo seam-proposal compile --plan todo-independence-ops
→ component_count 1 / verdict_counts {seam_candidate: 1, intentional_serial: 0, unknown_requires_evidence: 0}
```

投影:

| 項目 | 値 |
|---|---|
| coverage | `verified` |
| guidance | `seam_proposal_verified` |
| verdict | `seam_candidate` |
| unknowns | なし |
| 提案surface | `src/todo-gantt-html.seam-13d0e295b0efa4c1.mjs` → `tio-009` |
| 提案surface | `src/todo-gantt-html.seam-952ce9f0993da67e.mjs` → `tio-008` |

## 機構が効いたことの確認

artifactは`lattice.seam_proposal.v2`で、8 receiptのうち1件だけが`ambiguous`である。

```json
{
  "operation": "query",
  "target": "summarizeIndependence",
  "outcome": "ambiguous",
  "resolved_path": null,
  "candidate_paths": ["src/project-cli.mjs", "src/todo-gantt-html.mjs"]
}
```

候補は2つ載っており、単数pathは持たない。binderが`within`（`src/todo-gantt-html.mjs`）で絞って
1つに決めた結果、`tio-009`の5 symbolすべてがanchorになり、`declared_partition` cutが成立している。
**曖昧さは潰さずに記録し、宣言された文脈がある所でだけ解いている。**

## 検証

- `npm test` — 958 pass / 0 fail。
- `npm run check` — 通過。
- 新規test: `query`操作だけが候補を残しgraph操作はunknownのまま潰すこと、資源内で一意なら束縛する
  こと、資源の外／資源内で複数なら束縛しないこと、`within`がsymbolで曖昧なら資源側でunknownに
  なること、契約が「一意に決まった形」と「決まらず候補があった形」の混在を拒否すること。

## この記録が主張しないこと

- 提案は構造証拠であって、意味的独立やbehavior preservationの証明ではない。実変換は行っていない。
- 同名symbolを名前だけで解決できるようになったわけではない。絞れる文脈（宣言された資源）が
  ある時にだけ解ける。conflict resource自身が同名の場合は`within`に当たる宣言が無いため、
  依然として`exact_surface_evidence_missing`で止まる（ADR 0134 Open question 1）。
- `tio-008`/`tio-009`はどちらも完了済みの工程であり、この候補を実際に切る予定は無い。
  ここで確かめたのは**正直な宣言から候補が出る**という製品の性質である。
