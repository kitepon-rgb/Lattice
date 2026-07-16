# RC2 artifact／front-end characterization

- 日付: 2026-07-16
- Control: `lattice-rc2-bounded-graph-v1` revisions 26〜31
- Task: `RC2-C2-v2-artifact-front-end-characterization-v1`
- predecessor HEAD: `1603deef4792af0c28d4ae7c3bbe37cc5a2a20a8`
- production source変更: 0

## Fixed characterization

`test/rc2-artifact-contracts-v2.test.mjs`は、production sourceより先に次の8ケースを固定した。

1. ready Codegraph＋asserted manual candidate witnessのshared symbolからK3の3 conflictを導出する。
2. resource、TODO、owner TODO、provenanceの入力順列をcanonicalな同一bundleへ変換する。
3. Codegraph `empty`を0 conflictへ見せかけず、owner A／B／C全件のunknownとして保持する。
4. manual state evidenceがB／Cだけを所有する時、exactly one partial conflictを導出する。
5. symbol ownershipにmanual candidate provenanceが無い入力をfail loudlyにする。
6. bundleのgraph、graph digest、resource provenanceの各corruptionをrejectする。
7. boundary verdictの欠落、余分、wrong normalized graph digestをrejectする。
8. independently minimumなplanだけをacceptし、非最小、conflict同居、precedence違反、capacity超過をrejectする。

test SHA-256は`1fa0cc2067ce8dd31e828f5098b01f252a65225a168c686662abf401bf2c33f9`である。

## Expected-red result

親のfocused再実行結果:

```text
tests: 8
pass: 0
fail: 8
skip: 0
```

- expected-red 5: `src/boundary-observation-compiler-v2.mjs`の`ERR_MODULE_NOT_FOUND`だけ。
- expected-red 3: `src/artifact-contracts-v2.mjs`の`ERR_MODULE_NOT_FOUND`だけ。
- syntax、fixture construction、assertion由来のfailure: 0。
- `git diff --check`: pass。
- 変更scope: `test/rc2-artifact-contracts-v2.test.mjs`の1 pathだけ。

この赤は「未実装だから失敗した」という総称ではなく、後続sourceが満たす8つの観測／validation契約を個別testとして保持する。

## Delegation and acceptance

- A: test実装 → routing／execution検証済みimplementer `/root/rc2_b1_characterization`。
- worker run `RC2-C2-characterization-run-01-v1`はControl revision 29でdispatch、revision 30でreport import、親の実読、focused
  実行、exact 1-path scope、file digest確認後のrevision 31でacceptした。
- workerはproduction source、docs、git、dotagents／Observer関連repoを変更していない。
- ADR／evidence／TODO更新は`F: provenanceとartifact validationの契約クリティカル裁定`として親が行った。

## Verification classification

- `focused`: artifact／front-end characterization 0 pass／8 intentional expected-red。
- `related`: 未実行。production source実装後のTODO完了候補へ集約する。
- `full`: 未実行。RC2 Phase gateへ集約する。
- remote、push、publish、Lattice外write: 0。
