## 実装結果

`todo show`と`todo start`は同一の`design_memo` projectionを追加操作なしで返す。初期設計メモとappend-only note contextは別fieldで保持し、legacy欠落は`missing_legacy`として明示する。
