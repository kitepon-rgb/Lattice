# ADR 0177: `test_result`のLattice・Peertable横断リリースを受理する

日付: 2026-08-13

## Decision

Lattice `0.59.0`のToDo正式項目`test_result`と、Peertable `0.3.10`の完了フロー結線を受理する。

- Latticeは非空Markdownをdone eventと同じtransactionで保存し、`todo show`でevidenceと同時に返す。
- Peertableは既存のcommit済みevidence本文をそのまま`--test-result`へ渡す。別台帳・store直書き・自動生成・採点は持たない。
- 作業者は自己試験・自己監査を終えてevidenceと同じ最終結果を監査担当へ渡し、監査担当は試験を再実行せず妥当性を判断してcloseする。

## Evidence

- Lattice release commit `13352e6e61175be9beeee0000b1d204c6451aca9`、npm `@quolu/lattice@0.59.0`
- Peertable release commit `24c6a3f5a815ae909bf3bff7b3f089e787e94007`、npm `peertable@0.3.10`
- Lattice: product 1766 / 1766、Sensor 2308 pass / 183 skipped、global install後のCLI・dashboard・bridgeは0.59.0
- Peertable: focused 31 / 31、generated assets 4 cases、diagnostics ready
- installed Peertableから生成した使い捨て卓で、evidenceと`test_result`のbyte一致を確認
- 両npm registryのintegrityはpack成果物と一致し、global install後の実物を確認した

このDecisionは、横断工程のtask finalization、Control finalization、knowledge returnの不変正本とする。
