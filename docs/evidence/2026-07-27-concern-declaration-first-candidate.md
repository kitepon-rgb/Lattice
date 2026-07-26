# 担当concern宣言を入れた実データ実行

[2026-07-26の初回実行](2026-07-26-seam-proposal-first-real-run.md)が
`semantic_owner_binding_missing`で止まった実conflictへ、係争file内の担当concernを宣言して
compilerを通し直した記録。

## 結論（3行）

- **実データで初めて`seam_candidate`が出た。** 残余conflictは0で、compilerと同じ規則の再compileを通っている。
- ただしそれは**探りの宣言**での話である。正直な宣言では`concern_anchor_unresolved` 1件で止まる。
- 止まる理由は宣言の誤りではなく、**同名symbolが2 fileにあると名前だけでは解決できない**という
  現行evidence契約の限界である。

## 宣言（実態のまま・記録されているもの）

各ToDoが実際に`src/todo-gantt-html.mjs`の中で書き換えた範囲を、当該commitのdiffから取った。

| ToDo | 宣言したconcern | 由来commit |
|---|---|---|
| `tio-008`（SVGカードへ独立性バッジを描く） | `CSS` | `fa573f3`（stylesheet本文のみ） |
| `tio-009`（右ペインと凡例を独立性へ追従させる） | `dispatchBasis`, `renderDiagramLegend`, `renderIndependenceNote`, `renderRightPane`, `summarizeIndependence` | `da72a15` |

## 結果1: 正直な宣言（記録されている状態）

```
lattice todo independence compile --plan todo-independence-ops --input .lattice/todo/witness/todo-independence-ops.json
lattice todo seam-proposal compile --plan todo-independence-ops
```

base `beaf740aa1bb38007d321a5927430a3680385225`。

```
component 1件 / seam_candidate 0 / intentional_serial 0 / unknown_requires_evidence 1
unknowns: [{ kind: "concern_anchor_unresolved", ref: "tio-009:summarizeIndependence" }]
```

6件の宣言symbolのうち5件（`CSS`・`dispatchBasis`・`renderDiagramLegend`・`renderIndependenceNote`・
`renderRightPane`）は解決し、資源内包含も通っている。落ちたのは`summarizeIndependence`だけで、
これは`src/todo-gantt-html.mjs:220`と`src/project-cli.mjs:122`の**2 fileに同名の関数がある**ため
`exactSymbolResolution`が単一pathへ絞れず、resolvedへ昇格しないからである。

**判定は正しい。** 名前だけを渡された機械が「たぶんhtml.mjsの方だろう」と決めてはいけない。
一方で宣言は`within`で対象fileを名指ししており、**情報は宣言側に存在する**。

## 結果2: 探りの宣言（記録には残していない）

`summarizeIndependence`だけを外した宣言で同じ2コマンドを走らせた（commit `a09116f`、直後の
`beaf740`で正直な宣言へ復元済み）。base `a09116f5490aab389ea440a8c4ba7753637c14b6`。

```
component 1件 / seam_candidate 1 / intentional_serial 0 / unknown_requires_evidence 0
```

| | |
|---|---|
| proposal_id | `seam-e7ff8088a4d7da0cca31a53623a8ddc8b66035572bfa603807c12e3e570f113b` |
| 現在surface | `src/todo-gantt-html.mjs`（`shared_path`・所有者 `tio-008` / `tio-009`） |
| 提案後surface | `src/todo-gantt-html.seam-fbe949203c8d2d70.mjs`（`tio-008`）／`src/todo-gantt-html.seam-33b6124ba83c1044.mjs`（`tio-009`） |
| 残余conflict | 0 |
| limits | `hypothetical_new_surfaces`, `structural_only` |

`declared_partition` cutが宣言から2つのpartitionを作り、各ToDoが自分の宣言anchorだけで束縛され、
提案後ownershipを実`compileRuntimePlanV1`と同じ規則で再compileして残余0を確認している。
**閉ループの入口はこれで実データ上に立った。**

なぜこの探りを記録の正本にしないか——`tio-009`は実際に`summarizeIndependence`を触っている。
機械が解決できないという理由で宣言から落とすのは、宣言を実態からずらして候補を作る行為であり、
「宣言の誠実さが判定の上限」という前提そのものを壊す。

## 残った限界と次の一手

`lattice.seam_proposal.v1`の`evidence.queries[]`は`resolved_path`を**単数**しか持てない。
そのため「同名で複数path」は`unknown`へ潰れ、`within`が指す資源で絞る余地が受け皿に無い。
宣言側にある情報を使うには、evidence receiptが候補pathを保持できる必要があり、
それは公開artifact契約の版上げになる。本campaignのscope外として[ADR 0133](../adr/0133-concern-anchor-binding.md)の
Open questionへ送る。

回避策として`tio-009`側で`summarizeIndependence`を改名すれば通るが、それは製品の限界を
codebase側で吸収させる話であり、限界が消えたことにはならない。

## 限界（この記録が主張しないこと）

構造証拠であって、意味的独立やbehavior preservationの証明ではない。提案後surfaceは
`hypothetical_new_surfaces`であり、実変換は行っていない。したがってこの提案が実際に
並列化を解放するかは未検証である。
