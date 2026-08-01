## 背景

migration入力は一箇所ずつ失敗するため、AIが修正と再実行を繰り返している。書込み前に全体を検査できる面が必要。

## 実装方針

- `lattice todo migrate --dry-run --json`を、実writeと同じparse、schema、semantic、digest、freshness、topology検証へ通す。
- 相互独立な違反を上限付き配列で返し、同じ根因の連鎖エラーは重複させない。
- dry-runはplan、journal、snapshot、registryのbytesを一切変更しない。
- 成功時は作成予定plan、task数、dispatch shape、次の一手を返す。

## 受入

複数の独立違反を含むfixtureで一回のdry-runに複数診断が出て、store digestが前後一致する。
