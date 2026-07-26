# seam提案の初回実データ実行

このrepoの実conflictへseam提案compilerを通した記録。裁定を求める論点は末尾の1点。

## 結論（3行）

- 実conflict 1件に対して提案compilerはend-to-endで走り、**`unknown_requires_evidence`** を返した。
- 判定は**正しい**。片方のToDoは、宣言した境界の全部が係争中のfileで、固有のanchorを持たない。
- 人間には答えが見えている。ToDoのtitleに書いてある。**情報は存在するのに、typedな入口が無い。**

## 実行したもの

```
lattice todo independence compile --plan todo-independence-ops --input <witness>
lattice todo seam-proposal compile --plan todo-independence-ops
```

base `61b93dc1dfd1cf83a4c43cf96727cf5e619f2709`、bundled sensorはcomplete。

## 入力（実データ）

並列可否: 4 task、conflict 1件、unknown 0件、最小2 wave（`tio-009`が直列化されている）。

| | |
|---|---|
| 争っている資源 | `src/todo-gantt-html.mjs`（kind=path） |
| 争っているToDo | `tio-008` / `tio-009` |
| 切断可能性 | `code_seam`（symbol／pathのconflictなので分割で並列化しうる） |

宣言された境界:

| ToDo | owns | title |
|---|---|---|
| `tio-008` | `todo-gantt-svg.mjs`, `todo-gantt-html.mjs` | SVGカードへ独立性バッジを描く |
| `tio-009` | `todo-gantt-html.mjs` のみ | 右ペインと凡例を独立性へ追従させる |

## 出力

```
component 1件 / seam_candidate 0 / intentional_serial 0 / unknown_requires_evidence 1
unknowns: [{ kind: "semantic_owner_binding_missing", ref: "tio-009" }]
```

## なぜこれが正しいか

`tio-008`は`todo-gantt-svg.mjs`という**自分だけの錨**を持つので、そこへ帰属する構造は特定できる。
`tio-009`は`todo-gantt-html.mjs`しか宣言しておらず、それは係争中の資源そのものである。つまり
「`todo-gantt-html.mjs`のどの部分が`tio-009`のものか」を決める材料が、宣言のどこにも無い。

compilerはここでcall graphのedgeからtask IDを推測しない。推測すれば「並列化できる」と言った後に
実compilerが競合を残す事故になる。RC1/RC2の成功seamも、割り当ては人がcandidate specへ書いたもので
あって機械導出の実績ではない。よってunknownは安全側への逃げではなく、**証拠が足りないという事実の
報告**である（PLAN.md原則5）。

## 裁定を求める論点

**答えはtitleに書いてある。** 「SVGカードへバッジを描く」と「右ペインと凡例を追従させる」を読めば、
人は`todo-gantt-html.mjs`の分け方を即座に決められる。しかしwitnessのclosed fieldは
`owns / reads / writes / resources / state_effects / sensor_provenance / affected_tests / unknowns`
だけで、**concern・outcome・case IDを宣言する場所が無い**。titleは非typedなhuman-facing情報なので、
compilerがそれを読むことは許されない（自然言語の解釈で並列可を主張し始める）。

したがって次の一手は二択である。

1. **typedな`task_intent_binding`を足す** — ToDoごとに、係争資源の中で自分が触るconcernを機械可読に
   宣言させる。これがあれば今回のケースは`seam_candidate`まで到達しうる。宣言の手間は増える。
2. **提案生成をここまでとする** — 「切れる/切れない/情報が足りない」を正直に返す面までを製品とし、
   割り当ては人がcandidate specで与える（RC1/RC2と同じ運用）。

1を採ると、宣言の誠実さが判定の上限であるという既存の性質がさらに前面に出る。2を採ると、
「並列化できるかを機械が答える」という主張の射程が狭まる。

## 限界（この記録が主張しないこと）

構造証拠であって、意味的独立やbehavior preservationの証明ではない。実変換も行っていない。
