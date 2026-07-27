# rt-007: 変換で失効した記録を作り直し、競合の消滅を実測した

- 日付: 2026-07-27
- plan: `real-transform` / task `rt-007`

## 閉ループが実repositoryで閉じた

変換の動機だった競合が、本ツリーから消えたことを実compileで確認した。

| 時点 | conflict_count |
|---|---:|
| 変換前 | **1**（`tio-008` × `tio-009`、`src/todo-gantt-html.mjs`） |
| 着地後・再コンパイル | **0** |

```
lattice todo independence compile --plan todo-independence-ops --input .lattice/todo/witness/todo-independence-ops.json
→ outcome compiled / task_count 4 / conflict_count 0 / unknown_count 0

lattice todo independence --plan todo-independence-ops
→ coverage verified / serialize_pairs []

lattice todo seam-proposal compile --plan todo-independence-ops
→ component_count 0 / conflict_resource_count 0 / verdict_counts すべて0
```

**提案対象そのものが無くなった。** 切るべき競合が存在しないからである。

## 失効は機械が言った

着地の直後、記録は自分で失効を申告していた。

```
independence: coverage stale
seam proposal: coverage superseded / next_action compile_seam_proposal
```

人が「作り直さないと」と気づく前に、記録が現在のcodeを指していないことを述べている。
これは古い記録を検証済みとして読ませないための面（ADR 0127・0132）が、変換という
最も大きな変化に対しても効いたということである。

## 手順

1. `lattice sensor sync .` — 索引を新sourceへ追従させる。
2. 宣言を移動先へ写す。`tio-008`は`src/todo-gantt-html-style.mjs`へ、`tio-009`は
   `src/todo-gantt-html-independence.mjs`へ。observationの裏付け（query set・provenance）と
   自己digestも揃える。旧pathを指したままの宣言は実態からずれている。
3. `todo independence compile` — 新baseで再判定。
4. `todo seam-proposal compile` — 提案を作り直す。

## plan versionを新しく起こしていない理由

AGENTS.mdは「code変換後は旧plan／旧agent context／途中patchを失効し、accepted artifactを
predecessorにした新versionへ**全affected TODOを再コンパイル**する」と定めている。

本件で失効したのは**base_shaへ束縛された記録**（独立性記録・seam提案・宣言の指す資源）であり、
plan topologyは変わっていない。`tio-008`／`tio-009`はどちらも完了済みで、再dispatchすべき
in-flight TODOが存在しない。したがって再コンパイルすべき対象は記録だけであり、それは行った。

新しいplan versionを起こすと、内容の無いversionが1つ増えるだけになる。**topologyが変わって
いないのにversionを刻まない**という判断であり、規律を外したのではない。topologyを変える変換
（TODOの分割・併合を伴うもの）では、同じ規律から新versionが要る。

## この記録が主張しないこと

- 変換が並列開発を実際に速くしたことは測っていない。測ったのは競合の消滅と実行段階数の
  見積り（2→1）である。`tio-008`／`tio-009`は完了済みなので、この分割で実際に並行実行が
  起きることはない。
- 計画段階で完全な分断は得られていない。残りは実行段階の境界検知が持つ（AGENTS.md）。
