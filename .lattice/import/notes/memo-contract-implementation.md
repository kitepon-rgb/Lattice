## 実装進捗（2026-08-01）

- `lattice.todo_extraction.v3`へ必須`design_memo`を追加した。
- 空文字・空白だけを拒否し、固定値`NO_PLAN`と通常のMarkdownを受理する。
- schemaと欠落errorへ「あなたがこのToDoに対して、何も考えていないならば、設計メモに `NO_PLAN` と書いてください」を返す。
- 新規planは`lattice.todo_plan.v6`として、参照ではなくtask本体へ本文をdigest束縛する。
- `todo show`はdetail v2、`todo start`はmutation v4で同じ設計メモprojectionを自動供給する。
- legacy taskは空に丸めず`missing_legacy`を返す。
- v6から設計メモを持たないsuccessor schemaへの移行は現時点で拒否し、暗黙消失を防いだ。Phase付きrevisionへの正規移行は後続ToDoで設計メモ対応schemaを追加してから解禁する。

## 検証

設計メモのnegative/positive、実migration後のshow/start同値、公開Markdown安全化を含むfocused testと関連116 test、syntax checkがgreen。
