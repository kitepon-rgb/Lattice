# Lattice 工程表の白紙再構成差分

## 比較条件

新工程を作成し、`scope-review`とstore verifyを通した後に、初めて旧storeの退避物を開いた。新工程の作成中は旧task本文、`docs/plan_backlog.md`、過去campaign計画を参照していない。

旧storeは次へ退避した。

- archive: `/Users/kite/Developer/.codex-archives/lattice-plan-rebuild-20260813/todo-store-before.tar.gz`
- SHA-256: `2e43ae4d1dda67884f7c27bc996c51c3a69c83d742aa714ae1f37dcc16d9b897`
- 退避時Git HEAD: `bf64fccdc059a3eb98ee7ef1d255e63af48f28bd`

## 数量差分

| 指標 | 旧store | 新store |
|---|---:|---:|
| active plan | 52 | 1 |
| 全task | 311 | 1 |
| done task | 301 | 0 |
| 未着手task | 10 | 1 |
| 未着手plan | 1 | 1 |
| 残工程内dependency | 9 | 0 |
| 残工程の最長依存鎖 | 4 | 1 |
| 残工程の最大ready幅 | 7 | 1 |

旧storeの完了履歴301件は削除したのではなく、archiveへ退避した。新storeは今後の作業だけを持つ。

## 新工程

| task | 内容 | 根拠 |
|---|---|---|
| `core1` | 予測外書込みを実行時競合へ戻す | 特許請求項9と現行`prediction_excess`実装の直接不一致 |

旧task IDから引き継いだ工程は0件である。`core1`は旧工程に存在しなかった、一次資料と現実装の突合で新たに確認した不足である。

## 旧未着手10工程を残さなかった理由

| 旧task | 分類 | 新工程へ残さない理由 |
|---|---|---|
| `ldr-01` | 配備管理 | 過去20 commitと0.57.3を照合する時点限定の配備作業であり、製品機能ではない。 |
| `ldr-02` | consumer向け案内 | Peertable dogfoodで見つけたconversation/pull導線の改善であり、特許請求項または製品思想の未充足機能ではない。 |
| `ldr-03` | 復旧・安全機構 | AI制御processの誤attachを防ぐ追加契約であり、核心機能の実現条件ではない。 |
| `ldr-04` | 検知・安全機構 | 無関係WIPと未監査commitの混入検知を追加する工程であり、境界compileそのものの不足ではない。 |
| `ldr-05` | 工程管理拡張 | 完了済みsourceを後付けcross-plan dependencyとして記録する利便機能であり、並列開発閉ループの未充足ではない。 |
| `ldr-06` | authoring補助 | companion campaign起票の定型化であり、製品目的ではなく操作手順の軽量化である。 |
| `ldr-07` | 配備 | Wave 1のpush・publish・install・dogfoodであり、独立した製品機能ではない。 |
| `ldr-08` | 配備 | Wave 2の配備と再測であり、独立した製品機能ではない。 |
| `ldr-09` | 終端監査 | 全工程の監査・配備照合を別工程化したものであり、製品機能ではない。 |
| `ldr-10` | CLI利便性 | `--json` flagの一貫性改善であり、特許請求項または製品思想の未充足機能ではない。 |

これらを「価値がない」と判定したのではない。今回の工程正本へ入れるためのオーナー要求根拠がなく、旧campaignがdogfood中の摩擦を製品scopeへ取り込んだものなので、新しい製品工程から除外した。必要なら独立した改善提案として扱い、Latticeの残工程へ自動復帰させない。

## 検証

- 核心経路のfocused test: 107 / 107 green
- `lattice plan scope-review`: work spec 1、task 1、`scope_preserved`、余計なtask 0、未充足work spec 0
- `lattice todo verify`: issue 0、snapshot stale false
- 新store topology: task 1、dependency 0、critical path 1

## 切替

現時点では候補worktreeだけが新storeを持ち、元のworktreeは変更していない。比較結果をオーナーが受け入れた後、新storeを`main`へ着地させる。受け入れない場合は候補branchを破棄すればよく、旧storeはarchiveと元worktreeの双方に残る。
