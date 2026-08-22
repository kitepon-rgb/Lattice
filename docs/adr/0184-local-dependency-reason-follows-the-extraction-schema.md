# ADR 0184: local dependencyのreasonはextraction schemaどおり受理する

- status: accepted
- date: 2026-08-23

## 文脈

`lattice.todo_extraction.v3/v4`の公開schemaは、`hard_dependencies`の各edgeに任意の
`reason`を許している。cross-plan edgeでは監査可能な接続理由として必須だが、local edgeでも
AIが依存判断の根拠を記録できる契約だった。

runtime validatorは`reason`付きedgeをcross-planの場合だけ受理していた。このためschemaに適合する
local edgeが`todo migrate --dry-run`で`hard_dependencies_invalid`になり、作成者が理由を削らないと
登録できなかった。

## 決定

extraction v3/v4ではlocal edgeの非空`reason`を任意で受理する。cross-plan edgeは従来どおり
非空`reason`を必須とする。compiled planのlocal dependencyは実行topologyだけを所有するため、
`from`と`to`へ正規化する。

## 結果

公開schemaとruntime validationが一致し、計画作成者はlocal dependencyの設計理由を削らずに
scope reviewとmigrationを通せる。cross-plan接続の監査契約は弱めない。
