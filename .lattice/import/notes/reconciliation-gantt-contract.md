## 背景

`registered_unreconciled`をPhase不足やdashboard非表示と誤診した。また動的Ganttがproject全planを描くことを結果が自己記述せず、表示範囲を誤解しやすい。

## 実装方針

- reconciliation statusへ「source inventory照合の状態でありlifecycle/dashboard表示を塞がない」と説明を付ける。
- 必要なreconcile commandと対象sourceをnext actionへ返す。
- `gantt serve` resultへproject scope、selection scope、含まれるplan群、HTML media type、動的表示であることを明示する。
- 静的HTML出力先の検証は追加せず、静的生成そのものを`STATIC_GANTT_RETIRED`で拒否する。

## 受入

CLI結果だけで状態の意味と生成物のscope/formatを誤解しない。
