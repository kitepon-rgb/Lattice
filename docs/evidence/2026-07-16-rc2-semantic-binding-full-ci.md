# RC2 semantic binding後full CI

- 実行日: 2026-07-16
- 対象HEAD: `3c3b34b12b8d22fa0a5f8208aadc2eb3e7561e48`
- source commit: `68b23ee292546ddd7db12ec7c0fd3bc871849469`
- canonical artifact: `research/campaigns/rc2/artifacts/v3`
- command: `npm run ci`

source、test、canonical artifact v1／v2／v3が収束し、worktreeがcleanな状態でfull gateを一回だけ実行した。

| gate | pass | fail | cancelled | skipped | todo | duration |
|---|---:|---:|---:|---:|---:|---:|
| `npm test` | 172 | 0 | 0 | 0 | 0 | 62.471 s |
| `npm run check` | success | 0 | — | — | — | process exit 0 |
| `npm run ci` | success | 0 | — | — | — | process exit 0 |

full testはRC1／RC2のunit、integration、isolated worktree、fresh Codegraph、canonical v6 replay、RC2 artifact v1／v2／v3 replay、
oracle唯一正本、exact 6×4 mutation、全digest再封印後の3 semantic substitution rejectを含む。integration内でもimmutable artifact identityの
live graph除外がgreenだった。

同じHEAD／workspace digestでfull gateを反復していない。既存の
[artifact v2時点full CI](2026-07-16-rc2-full-ci.md)は上書きせず、semantic correction後の新しい回帰証拠として本ファイルを追加した。
dotagents／Observer関連repo write、remote作成、push、publishは0。
