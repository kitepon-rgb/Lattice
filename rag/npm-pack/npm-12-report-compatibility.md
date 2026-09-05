---
source: https://github.com/npm/cli/blob/v12.0.2/CHANGELOG.md
retrieved_at: 2026-09-05
confidence: 公式仕様とnpm 11.17.0・12.0.2の実測
---

# npm packのJSON形式の互換性

[公式変更記録の抜粋](raw/npm-12-output-change.md)に出力形式の変更が明記されている。
LatticeのMac CIでは、配布文書の検査が配列を期待し、JSONの形式不一致で停止した。
Windows上でもnpm 12.0.2を公式の`npm exec --package`で実行すると同じ失敗を再現した。

- npm 11.17.0: `[{ "name": "@quolu/lattice", "files": [...] }]`
- npm 12.0.2: `{ "@quolu/lattice": { "name": "@quolu/lattice", "files": [...] } }`

これはOS差ではなくnpm版の差。共通の受信処理で新旧のpackage集合を配列へ正規化し、
対象packageが1件でfilesが配列という既存条件を維持する。未知形式を空の成功結果にはしない。
`npm exec --yes --package=npm@12.0.2 -- npm run check:docs`で新版を、
通常の`npm run check:docs`で導入済み旧版を検証できる。
