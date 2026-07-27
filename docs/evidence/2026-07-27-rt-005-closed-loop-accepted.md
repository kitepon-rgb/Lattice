# rt-005: 閉ループが実データで1周し、変換が採用された

- 日付: 2026-07-27
- plan: `real-transform` / task `rt-005`
- 契約: [ADR 0137](../adr/0137-real-transform-acceptance-contract.md)・[ADR 0138](../adr/0138-transform-acceptance-five-conditions.md)

## 結果

```
lattice todo seam-proposal apply --plan todo-independence-ops

decision: accepted
conditions: {
  "behavior_equivalent":  true,
  "focused_tests_passed": true,
  "sensor_fresh":         true,
  "overlap_reduced":      true,
  "parallelism_improved": true
}
```

**五条件がすべて満たされた。** 実行時間は約30秒、閉包の反復は4ラウンド。

これは製品が初めて「競合を検出し、切り方を決め、**実際にソースを書き換え**、外部挙動が保たれ、
影響testが通り、再indexし、残余競合0を実compileで確認し、並列度の改善まで測った」1周である。
これまでは提案で止まり、提案surfaceはディスク上に存在しなかった。

対象は`src/todo-gantt-html.mjs`（`tio-008`×`tio-009`の係争path）。宣言はstoreにcommit済みの
ものをそのまま使い、1文字も変えていない。

| 面 | path |
|---|---|
| residual | `src/todo-gantt-html.mjs` |
| task_owned（`tio-009`） | `src/todo-gantt-html.seam-13d0e295b0efa4c1.mjs` |
| task_owned（`tio-008`） | `src/todo-gantt-html.seam-952ce9f0993da67e.mjs` |
| shared | `src/todo-gantt-html.seam-shared.mjs` |

**本repositoryは変更していない。** 変換も検証も使い捨てworktreeの中だけで起き、残ったのは判定と
その理由である。着地は`rt-006`が持つ——検証と着地を同じ操作にすると、五条件を満たさない変換が
「途中まで着地した」状態を作りうる。

## 到達までに踏んだ壁（すべて実行しないと見えなかった）

| 壁 | 直し方 |
|---|---|
| verifierに依存が無く`ERR_MODULE_NOT_FOUND` | runnerが`node_modules`をmountする。**呼び出し側が`transform`の中で張れる形にしない**——任意の変更をsnapshotから隠す口になる |
| mountがallowed path外の変更として弾かれる | runnerが自分で張ったentryだけをsnapshotから外す。`src`／`test`へのmountは拒否する |
| base checkoutが同名を持ちmountが`EEXIST` | mount配下はまるごとsnapshot対象外なので置き換えてよい。保護pathだけは拒否 |
| verifierが索引を作り「変更を残さない」規律に当たる | 索引の書き先を使い捨てへ向ける。規律は緩めない |
| 索引の鮮度判定が常にfalse | `path_state`は**不存在の時にだけ付く欄**で、正常時は欄が無い。`=== 'file'`を要求していたのが誤り |
| 変換後witnessが契約違反 | 宣言だけ移して観測の裏付けを旧pathに残していた。query setとprovenanceも移動先へ揃え、自己digestを取り直す |

いずれも設計上は正しい規律に当たった結果である。**隔離を緩めて通す**選択はしていない。

## 検証

- `npm test` — 985 pass / 0 fail。
- 本ツリーは`src/todo-gantt-html.mjs`のみ（分割fileは存在しない）。worktreeは実行後に消える。

## この記録が主張しないこと

- 着地していない。本ツリーのソースは1バイトも変わっていない。
- 新plan versionへの再コンパイル（version barrier）は行っていない（`rt-007`）。
- 共有面の粒度、所有面のpath命名は裁定していない（ADR 0137 Open questions）。
- 五条件は構造と検査についての条件であり、意味的独立やbehavior preservationの証明ではない。
  `behavior_equivalent`が見ているのは原pathの公開面が欠けないことである。
