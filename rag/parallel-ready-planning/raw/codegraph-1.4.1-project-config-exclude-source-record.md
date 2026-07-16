<!-- raw source record: Codegraph同梱一次資料のproject config境界を保存する -->

- 出典: ローカル導入物`@colbymchenry/codegraph@1.4.1`の`README.md`と`dist/project-config.d.ts`
- upstream: https://github.com/colbymchenry/codegraph
- 取得日: 2026-07-16
- 取得方法: `/opt/homebrew/lib/node_modules/@colbymchenry/codegraph/`をread-only参照
- 確度: 高（実行中versionと同梱された一次資料）

## Verbatim contract excerpt

同梱READMEのConfiguration節は、`.gitignore`ではgit-tracked directoryを除外できないため、project rootの`codegraph.json`へ
`exclude`を置くよう定める。patternはgitignore-style、repo-root-relativeで、index、sync、watchに適用される。

```json
{
  "exclude": ["static/", "**/vendor/**"]
}
```

同梱`project-config.d.ts`は`exclude?: string[]`を、git-tracked pathもindexから外すescape hatchと定義する。built-in defaultsと
`.gitignore`に追加して適用され、明示`exclude`は`include`より優先する。

## Latticeへの適用境界

この資料は除外機構の存在と意味だけを根拠づける。Latticeのartifact identityを除外すべきという裁定、pattern選択、v2 artifact化は
RC2の実測とADR 0040による設計判断であり、upstreamの主張ではない。
