# Lattice 残工程の白紙再構成

## 目的

現行工程を参照せず、Latticeの特許請求項と現在の実装だけから、未充足の製品機能を最小工程へ再構成する。

## 再構成に使った正本

- `/Users/kite/Developer/Patent/Lattice/出願書類/03_特許請求の範囲案.md`
- `PLAN.md`
- `docs/00_product-contract.md`
- 現在の製品コードとfocused test（既存機能の実装済み判定だけに使用）

旧`.lattice/todo`、`docs/plan_backlog.md`、過去campaignの計画文書は、新工程を確定するまで参照しない。

## 請求項と現実装の突合

請求項1〜8および10の核心経路である、構造graph、変更境界、read/write競合、並列配置、seam提案、隔離変換、挙動比較、再index、再compile、managed dispatch、selective hold、seam処置後の再開は現在の製品経路に存在する。関連focused test 107件はgreenだった。

請求項9だけが現在の実装と一致しない。請求項9は、実変更が推定した変更影響範囲の外へ及ぶ場合、または他の実行中作業の変更影響範囲と重複する場合に、実行時競合を検出すると定める。しかし現在の`classifyCheckpointObservation`は、単独作業の`undeclared_write`を`prediction_excess`へ再分類し、競合とfreezeを発生させない。

## 残工程

### core1 — 予測外書込みを実行時競合へ戻す

`undeclared_write`を作業数にかかわらず実行時競合として記録し、対象範囲のintakeを停止する。既存の複数作業間write conflict、selective hold、seam処置、再compile、再開は変更しない。READMEと製品契約の説明を実挙動へ一致させる。

受入条件:

- 1作業だけが予測外pathへ書いた最小再現で、`conflict_found`と`intake_frozen`が記録される。
- 2作業間のwrite conflict、hold、runtime seam処置の既存focused testがgreenである。
- 公開説明と実装が、請求項9の「範囲外または重複」と一致する。
- 作業者がfocused testと自己監査を完了し、最終試験結果を監査担当へ渡す。監査担当は試験を再実行せず、内容と結果の妥当性を判断して工程をcloseする。

## 非目標

- dataflow機構、採点、capacity規則、UI、追加の監査段、追加の安全装置を作らない。
- 実装済みの請求項を再実装しない。
- 試験、文書、releaseを独立した工程へ分割しない。

## 白紙再構成の判定

工程登録前に`lattice plan scope-review`を実行し、上記の未充足要求1件を`core1`だけが充足し、余計な工程と未充足要求がともに0件であることを確認する。
