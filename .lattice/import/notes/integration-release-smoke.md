## 目的

個別実装のgreenではなく、Lattice authoringからbingo公開工程表までの多段受入を閉じる。

## 検証順

1. 設計メモ欠落/空白のnegative testと`NO_PLAN`/Markdownのpositive test。
2. show/start/local/public rendererの同値確認とXSS negative test。
3. registry root conflict時のbytes不変、migrate dry-runのstore不変。
4. focused test、関連test、`npm run check`、Phase gateの`npm run ci`。
5. bingo task backfill後、個別HTMLを再生成せず、動的公開URLの右ペインを操作してsmoke。

## 完了条件

未実行の検査はgreenへ丸めず、公開面で設計メモが3秒で見つかることを証拠化する。
