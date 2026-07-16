# RC2 Codegraph artifact scope characterization

- 記録日: 2026-07-16
- planned config state: absent
- test: `test/integration/rc2-codegraph-artifact-scope.integration.mjs`
- governing decision: ADR 0040

## Contract

testはcanonical Latticeをfresh cloneし、残存indexを使わず`codegraph init .`する。その後status complete／pending 0に加えて
`codegraph files`のactual coverageを読み、artifact配下の`identity/` sourceが0件、live RC2 campaign／oracle／fixture sourceが収載済み、
`runRc2Campaign`のexact live path候補が1件、oracle sourceのaffected testがcampaign／fixture／transformの3件であることを要求する。

## Expected-red result

`node --test test/integration/rc2-codegraph-artifact-scope.integration.mjs`は0 pass / 1 failだった。最初のfailureは
artifact identity pathsが空でないことだけで、次の14 filesを実収載した。

- RC1 v6 artifact identity: 2 files
- RC2 v1 artifact identity: 12 files

syntax checkはgreen。production source、`codegraph.json`、artifact、docsはtest追加前の状態から変更せずにexpected-redを得た。
この結果はstatusやincremental syncでなくfresh full indexのcoverageを直接固定する。

full CIはPhase failure修正の収束後まで再実行していない。Lattice以外のrepo、remote、push、publishへの変更はない。
