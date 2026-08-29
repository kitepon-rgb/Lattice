# ADR 0189: observed diffからgitignore済みfileの観測を撤去する

- status: accepted
- date: 2026-08-29

## 文脈

runtime diff observerは`git status --ignored=matching`でgitignore済みfileも観測し、
「gitignoreへ載せることで境界検査を迂回する」抜け道を塞いでいた。除外はコンパイラ／
ツール出力のdirectory名列挙（GENERATED_OUTPUT_DIR_NAMES）で行っていた。

この迂回という脅威は一度も観測されていない。一方、列挙に無いツールキャッシュ
（実被弾 2026-08-29: Ruffの`.ruff_cache`）が未宣言writeとして検知され、実装・監査とも
完了済みのtaskのintake acceptがRUNTIME_CONFLICT_HOLDで半日停止する実害が出た。
列挙リストは新ツールごとに同じ事故を繰り返す構造だった。

## 決定

オーナー裁定（2026-08-29「そんな実害はない。やる奴がいたらそれは悪意だ」）により、
ignored観測とその救済機構を丸ごと撤去する。

- statusは`--ignored=matching`なしで観測する
- GENERATED_OUTPUT_DIR_NAMES／isGeneratedOutputPath／ignored directory展開を削除

未追跡・追跡済みfileの未宣言write検知（並行taskの衝突検知の本体）は変わらない。
悪意ある迂回はLatticeの脅威モデル外とする。isolation-runner等の「canonicalが変わって
いないことの検証」に使う`--ignored=matching`は別機構であり、本決定の対象外。

## 帰結

- ツールキャッシュ（ruff / mypy / その他将来のツール）がacceptを止めることはなくなる
- 列挙リストの保守（もぐら叩き）が消える
