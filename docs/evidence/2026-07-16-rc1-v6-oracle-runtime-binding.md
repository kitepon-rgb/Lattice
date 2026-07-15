# RC1 v6 oracle semantics／runtime binding evidence

- 日付: 2026-07-16
- plan version: `lattice-research-campaign-1-v6`
- TODO: RC1-V1
- Decision: [ADR 0029](../adr/0029-rc1-v6-causal-identity-preimages.md)

## Codegraph preflight

RC1-V0 commit後に`codegraph sync .`を実行し、48 files、1098 nodes、4173 edges、pending 0、index completeを確認した。

- `verifyRc1V6BehaviorReceipt`: caller 1、callees 9、impact 2 nodes／1 edge。
- oracle／causal coreのaffected testはblack-box oracle、v4/v5 transform／campaign、v6 causal bindingの7件、
  total dependents 14。
- planned `compileRc1V6BehaviorEvidence`はfuzzy queryがv5 symbolを返したため、v6 symbolは未索引unknownと判定した。
  planned pathのaffectedは新test自身だけであり、依存なしとは扱っていない。
- `compileRc1V5BehaviorEvidence`: impact 7 nodes／7 edges。v5 transform／campaign consumerを互換gateへ含めた。
- manual unknownはWorker内dynamic import、親から継承可能なruntime flags／environment、Git／fixed surface副作用である。

## Characterization

実装前のfocused testは次の期待どおりredになった。

```text
node --test --test-name-pattern='v6 receipt binds' test/rc1-black-box-oracle.test.mjs
0 pass / 1 fail: createRc1V6OracleRuntimeIdentity is not a function

node --test test/rc1-v6-behavior-evidence.test.mjs
0 pass / 1 fail: ERR_MODULE_NOT_FOUND src/rc1-v6-behavior-evidence.mjs
```

## 実装

- v5 APIとschemaを変更せず、`runRc1V6BlackBoxOracle`とreceipt v4を追加した。
- Workerを`execArgv: []`、`env: {}`で起動し、Worker自身が`process.version`、実`process.execArgv`、
  executor module bytesのSHA-256を返す。親から渡したdigestのechoではない。
- callerが固定したruntime identityとWorker観測値が異なればreceipt発行前にrejectする。
- case contractは保存oracleのID／順序／expected kind／digest完全列から生成し、receiptをV0 verifierへ通す。
- behavior envelope v2はoracle、runtime、case contract、pre／post full receipt、surface、accepted transform、patch、
  output snapshotをcross-bindする。
- `--input-type=module --trace-warnings`付き親processから別processで起動し、Worker receiptの`exec_argv: []`を実測した。

## Gates

Focused:

```text
v6 oracle: 1 pass / 0 fail / 0 skip
v6 behavior envelope: 1 pass / 0 fail / 0 skip
```

TODO完了候補のrelated setを一回実行した。

```text
node --test \
  test/rc1-black-box-oracle.test.mjs \
  test/rc1-v4-campaign.test.mjs \
  test/rc1-v4-characterization.test.mjs \
  test/rc1-v4-transform.test.mjs \
  test/rc1-v5-campaign.test.mjs \
  test/rc1-v5-transform.test.mjs \
  test/rc1-v6-causal-binding.test.mjs \
  test/rc1-v6-behavior-evidence.test.mjs

28 pass / 0 fail / 0 skip
```

full `npm run ci`はRC1-Yまで実行していない。v5 immutable artifactも変更していない。

