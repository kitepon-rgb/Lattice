## 背景

現行public rendererは`includeNotes:false`を強制し、ADR 0067/0149も本文非表示を要求していたため、右ペインが題名とIDだけになった。

## 実装方針

- plan taskの`design_memo`を既存allowlist型Markdown rendererでHTML化する。
- ローカルと公開の両方で「設計メモ」を主情報として表示する。
- append-only作業noteは通常readの運用履歴として保持するが、公開dashboardへ本文を露出しない。
- script、event handler、危険URL、raw HTMLを実行可能にしない。
- 設計メモへ秘密を書かないauthoring契約を採り、ローカル絶対pathも公開面へ出さない。
- legacy欠落は空白ではなく欠落ラベルを出す。

## 受入

同じToDoのshow/start/ローカル/public右ペインが同じ本文を示し、`NO_PLAN`も隠さない。
