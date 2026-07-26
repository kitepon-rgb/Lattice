# bk-005: ADR 0132 Open questions 2〜4の再裁定と、判定反転欠陥の修理

- 日付: 2026-07-27
- plan: `backlog` / task `bk-005`
- 裁定: [ADR 0135](../adr/0135-readjudicating-seam-proposal-open-questions.md)

## 測定した事実

sensorへ直接問い合わせて、まだ存在しない対象の返り方を確定した。

| 問い | outcome | 補足 |
|---|---|---|
| `affected src/does-not-exist-yet.mjs` | `empty` | `path_state: "absent"`、`affectedTests: []` |
| `affected docs/evidence/`（prefix形） | `unresolved` | targetも`unresolved` |
| `query symbolThatDoesNotExistYet` | `symbol_absent` | `data: []` |

`path_state`はindexの推測ではなく`inspectAffectedPathState`のlstat結果である。つまり
「観測できなかった」ではなく「観測して、無かった」。prefix形は裏付けを得る手段が無い。

## 発見した欠陥（OQ4を測る過程で）

隔離したscratch repoで、`src/shared.mjs`を両方が書く`T1`/`T2`と、新規file
`src/brand-new.mjs`だけを作る`T3`を用意した。

**T1/T2だけでcompile:**

```
outcome compiled / task_count 2 / conflict_count 1 / unknown_count 0
```

正しい。同じfileを書くので競合1件。

**T3を足してcompile:**

```
outcome unknown / task_count 3 / conflict_count 0 / unknown_count 1
```

投影:

```
coverage: verified | guidance: independence_verified
frontier: parallel_groups [{task_ids: ["T1","T2"]}]
          unknown [{task_id: "T3", unknowns: [{kind: "sensor_empty", ref: "q-new"}]}]
```

**T1とT2が「検証済み並列」として出た。** 実際には同じfileを書く。案内も
「記録時点の宣言境界では、他のready工程と干渉しない」と述べていた。

### 原因

compileが`BOUNDARY_UNKNOWN`で止まると、front endはpairwise verdictを1つも返さない。
`compileTodoIndependence`はそれを受けて`conflicts: []`を記録する。投影
（`projectIndependenceFrontier`）は自分にunknownが無いready同士を、`blocked`に載っていない
ことを根拠に並列グループへ入れる。`blocked`は`artifact.conflicts`からしか作られないので、
**空のconflictが「ぶつかる記録が無い＝独立」として読まれていた。**

投影のコメントは正しい原則を書いている——「verdictの不在を独立の証拠にできるのは、両taskが
compile対象であり、どちらにもunknownが無いときだけ」。欠けていたのは、**記録全体がverdictを
1つも持たない場合**という条件だった。

### 修理

記録の`outcome`が`compiled`でない時、covered readyを全件`plan_verdicts_absent`として未検査へ
落とす。案内へ`independence_verdicts_absent`（「判定が途中で止まっており、記録はどの組についても
verdictを持たない。自分にunknownが無いことは、他と干渉しない証拠にならない。」／
`next_action: resolve_unknowns_then_recompile`）を足した。

修理後の同じscratch repo:

```
coverage: verified | guidance: independence_verdicts_absent
parallel_groups: []
unknown: T1 [plan_verdicts_absent] / T2 [plan_verdicts_absent]
         T3 [sensor_empty, plan_verdicts_absent]
```

再現testは**修理を外すと落ちることを実際に確認した**（`判定がunknownで止まった記録は、
無関係なtaskまで検証済み並列にしない`）。

## 3件の裁定

| OQ | 裁定 | 理由 |
|---|---|---|
| 2. `candidate_set` v2 | 保留を維持。ただし発火条件を明文化 | 実componentは1件で、唯一の非劣位候補を返す。`multiple_incomparable_candidates`は実測ゼロ。「頻度を見る」は主体も閾値も無く永久に発火しないので、「実データで1件出たら着手」へ置き換えた |
| 3. `verification` digestの締め | 実変換campaign（bk-002）へ移す | ADR 0132自身が`bounded-seam.mjs`のcaller assertionと同型と述べており、その解消は既にそのcampaignの所有物。同じ設計判断を2回行わせない |
| 4. 新規fileだけを作るToDo | 判定対象にする。ただし**宣言**とし、自動導出にしない | absentは決定的な観測なので判定材料としては足りる。しかし自動導出にするとpathのtypoが「必ず止まるエラー」から「黙って通る創作境界」へ変わる。この検出を捨てない |

## 検証

- `npm test` — 960 pass / 0 fail。
- `npm run check` — 通過。
- 修理の実効性は隔離repoの実CLI実行で前後比較した（上記）。

## この記録が主張しないこと

- OQ4の実装はまだ入っていない。創作宣言は`lattice.todo_witness_set` v3と
  `lattice.run_request` v2の両方へ届く必要があり（判定はfront endが行い、front endは
  run_requestしか読まない）、後者は83箇所・30ファイルから参照される。campaign規模として
  別工程へ起こした。
- したがって現時点では、新規fileを作るToDoを含むplanは**全件が未検査**として出る。
  安全側だが、並列可否を持てない状態は続いている。
