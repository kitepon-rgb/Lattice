# RC2 transfer／delivery policy characterization

- 日付: 2026-07-16
- Control: `lattice-rc2-bounded-graph-v1` revisions 35〜47
- Tasks: `RC2-D1-rc1-transfer-front-end-characterization-v1`、
  `RC2-E1-delivery-policy-fixture-characterization-v1`
- Decision: ADR 0035
- production source変更: 0

## RC1 transfer front-end

`test/rc2-rc1-transfer-front-end.test.mjs`で、committed RC1 v6の4 boundary manifestをv2へ移す予定契約を固定した。

- control-normal: 3 conflict records／1 distinct pair／2 waves。
- treatment-normal: 0 conflict／1 wave。
- control-negative: 4 conflict records（state 1）／2 waves。
- treatment-negative: state conflict 1／2 waves。
- 全conditionでv2 bundle／verdict／plan validatorを通す。
- candidate ID、query target、manual state bindingのcorruptionをrejectする。

親のfocused実行は7 fail／0 pass／0 skipで、7件すべてがplanned
`src/rc2-rc1-transfer-front-end.mjs`だけの`ERR_MODULE_NOT_FOUND`だった。4 manifest pathの実在、diff check、
1-file scopeを別途確認した。

- test SHA-256: `53bdb5010ba63465217517b4254c0729bc3c08ef36b904584828310b9b8e296d`

## Delivery policy fixture／oracle

`test/rc2-delivery-policy-fixture.test.mjs`で、email／sms／push × routine／urgentの6 exact output、exact input shape、
`TypeError`／`RangeError`、fresh repoRootを受け取るblack-box oracle receiptを固定した。oracle receiptはcandidate、conflict、
expected wavesを持たない。

親のfocused実行は10 fail／0 pass／0 skipだった。9件はplanned fixture module、1件はplanned oracle moduleの
`ERR_MODULE_NOT_FOUND`で、それ以外の失敗はなかった。diff checkと1-file scopeも通った。

- test SHA-256: `7cdf6334f42abccf1bde542e1850a76a9ef348ff8ebd0aa0b08cdd38316020fb`

## Orchestration observation

二つのTaskはfile write scopeが非交差だが、Controlは同一worktreeのdirect writerを一件に限定するため、同時admissionを
`WRITE_CONFLICT`でfail-loudに拒否した。D1をacceptしてreservationを解放後、E1をadmitした。これは研究laneのhard dependencyでは
なく、共有worktree実行の安全制約である。実同時実行が必要なら専用worktreeを使う。

## Verification classification

- `focused`: D1 0 pass／7 expected-red、E1 0 pass／10 expected-red。全失敗がplanned module欠落だけ。
- `related`: production source未実装のため未実行。
- `full`: 未実行。RC2 Phase gateへ集約する。
- dotagents／Observer関連repo write、remote、push、publish: 0。
