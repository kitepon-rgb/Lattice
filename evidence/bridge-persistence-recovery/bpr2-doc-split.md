# bpr2-doc-split

## 実施

`docs/bridge-setup.md` の persistence 表へ `BRIDGE_PERSISTENCE_STATE_SPLIT` を追記し、片割れ状態の意味と `lattice bridge reconfigure --json` による復旧手順を説明した。既存の表構成と文言は変更していない。

## 確認

追記箇所を目視確認した。実装変更を伴わない docs-only task のため、bpr1 の関連 focused test 52/52 green を受入時の実装根拠として参照した。
