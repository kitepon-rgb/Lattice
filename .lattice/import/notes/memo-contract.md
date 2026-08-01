## 背景

題名と依存だけのToDoは、後続AIへ過去のTODO／PLAN Markdownにあった設計判断を渡せない。`narrative_ref`だけでは元文書のどこを読むかも定まらない。

## 実装方針

- versioned task contentへMarkdown本文の`design_memo`を追加する。
- 新規・revision・migration authoringでは空文字と空白だけを拒否し、違反task IDと入力位置を返す。
- 計画が無い場合の唯一の明示値は`NO_PLAN`。Latticeは品質採点をせず、`NO_PLAN`も通常本文として保存する。
- AIへの案内文は「あなたがこのToDoに対して、何も考えていないならば、設計メモに `NO_PLAN` と書いてください」で固定する。
- legacy planは読めるままにし、新規authoringだけが旧schemaへ逃げないversion境界を置く。

## 受入

欠落時にstore bytes不変でtyped error、Markdown本文と`NO_PLAN`は保存成功し、revision後も対応taskへ移行する。
