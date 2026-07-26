# creation-boundary: 新規fileを作るToDoが判定対象になった

- 日付: 2026-07-27
- plan: `creation-boundary` / task `cb-001`〜`cb-003`
- 裁定: [ADR 0135](../adr/0135-readjudicating-seam-proposal-open-questions.md) Decision 3 →
  [ADR 0136](../adr/0136-declared-creation-boundary.md)

## 直前の状態

[bk-005の記録](2026-07-27-bk-005-open-question-readjudication.md)で測ったとおり、
新規fileだけを作るToDoを1件混ぜるとcompileは`BOUNDARY_UNKNOWN`で止まり、記録の`conflicts`は
空になっていた。実開発ToDoのかなりの割合が並列可否を持てない状態だった。

## 実行（隔離repo・実CLI・実sensor）

`src/shared.mjs`を両方が書く`T1`/`T2`と、`src/brand-new.mjs`（未存在）だけを作る`T3`。
`T3`の`owns`へ`creates: true`を宣言した（witness set v3）。

```
lattice todo independence compile --plan main --input .lattice/todo/witness/main.json
→ outcome compiled / task_count 3 / conflict_count 1 / unknown_count 0
```

投影:

| 項目 | 値 |
|---|---|
| coverage | `verified` |
| guidance | `independence_conflict_between_ready` |
| parallel_groups | `[{T1, T3}, {T2}]` |
| serialize_pairs | `[[T1, T2], kind: path, severability: code_seam]` |
| unknown | なし |

**新規fileのToDoが判定を止めなくなり、かつT1/T2の実conflictはそのまま残っている。**
`T3`は誰とも干渉しないので`T1`と同じ並列グループへ入る。

## 宣言が実態からずれた時

同じ宣言のまま`src/brand-new.mjs`を実在させ、commitしてsensor syncしてから再compile:

```
outcome unknown / conflict_count 0 / unknown_count 1
unknowns: [{"kind": "sensor_creates_path_present", "ref": "q-new", "task_id": "T3"}]
guidance: independence_verdicts_absent / parallel_groups: []
```

**宣言だけでは裏付けにならない。** 「作る」と言ったpathが既に在れば止まる。
bk-005で入れた`plan_verdicts_absent`も同時に効いていて、判定が止まった記録から
T1/T2が検証済み並列として出ることはない。

## 契約の版上げ

| 契約 | 版 | 差分 | 旧版の扱い |
|---|---|---|---|
| `lattice.todo_witness_set` | v2 → **v3** | `owns[].creates` | v1/v2を読み口として受理 |
| `lattice.run_request` | v1 → **v3** | 同上 | v1を読み口として受理 |
| `lattice.boundary_manifest` | v2 → **v3** | 同上 | v2を読み口として受理 |

`concern_anchors`と違い、創作宣言は合成run requestへそのまま届く。判定そのものへ効く宣言なので
落とせばfront endが読めない。

## 検証

- `npm test` — 963 pass / 0 fail。`npm run check` — 通過。
- 新規test: 創作宣言がv3から使えること、判定入力へ届くこと、pathに限りtrueだけを受理すること、
  不存在pathで`dispatchable`になること、既存pathへの宣言が`creates_path_present`で止まること、
  fs観測が無い証拠が`creates_unverified`で止まること。

## この記録が主張しないこと

- 宣言していないabsent pathの扱いは変えていない。従来どおり`path_absent`で止まる——
  pathのtypoを「黙って通る創作境界」にしないための線である。
- 存在するがaffected testを持たないfile（docや葉のtest）は今も`empty`でunknownへ落ちる。
  同じ「blast radiusが空」でも、本件は宣言があるabsent pathだけを扱っている。
- 1 ToDoが複数pathを所有する場合の制約（`affected_tests`のbinding単位exact比較）は解いていない。
