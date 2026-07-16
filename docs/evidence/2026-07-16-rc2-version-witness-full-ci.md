# RC2 version witness整合後full CI

- 実行日: 2026-07-16
- 最終対象HEAD: `dc14a473575795ee4e13911faf52710c3b6a1d10`
- source commit: `fe75df08d469375703b183ec252955f2854774e7`
- artifact commit: `bf4ba1d4d446ce89d571c05dd5981c49ed90f923`
- canonical artifact: `research/campaigns/rc2/artifacts/v4`
- command: `npm run ci`

## 最初のfull gateと補正

最初のfull gateは174 tests中173 pass／1 fail／0 skip、約77.13秒だった。唯一の失敗は、発行後のfresh Codegraphが新しい
`test/rc2-artifact-version-witness.test.mjs`をaffected testsへ正しく加えた一方、integration testの期待集合が旧3件のままだった
ことである。production source、canonical artifact、version witness verifierの失敗ではなかった。

期待集合へ新testを加えた補正後、失敗scopeだけをscratch cloneで一回実行し、1 pass／0 fail、約1.50秒で成功した。scratch directoryは
削除済みである。補正は`dc14a47`（`RC2 Codegraph affected set期待値を更新する`）として計画のH2f分割と同じ独立cutへcommitした。
focused testは再実行していない。

## 最終full gate

期待値補正commit後にfull gateを一度だけ再実行した。

| gate | pass | fail | cancelled | skipped | todo | duration |
|---|---:|---:|---:|---:|---:|---:|
| `npm test` | 174 | 0 | 0 | 0 | 0 | 60.959 s |
| `npm run check` | success | 0 | — | — | — | process exit 0 |
| `npm run ci` | success | 0 | — | — | — | process exit 0 |

full testはRC1／RC2 unit、integration、isolated worktree、fresh Codegraph、RC1 v6 replay、RC2 artifact v1〜v4 replay、active witness
epoch、base cross-binding、oracle唯一正本、exact 6×4 mutation、全digest再計算後の整合性検査を含む。`npm run check`も全対象で成功した。

## 実行頻度

- related gate: 5 files、40 pass／0 fail、約53.17秒。再実行なし。
- focused correction: 1 pass／0 fail、約1.50秒。再実行なし。
- first full: 173／174。期待集合の更新漏れをfailとして保持した。
- final full: 174／174。補正commit後に一回だけ実行した。
- campaign: 再実行なし。
- canonical artifact v4: 再生成なし。

失敗をgreenへ丸めず、原因、補正scope、focused correction、最終fullを別々の実測として残した。dotagents／Observer関連repo write、
remote作成、push、publishは0。
