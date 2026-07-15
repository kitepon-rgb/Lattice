# RC1 v6 causal-binding characterization

- 日付: 2026-07-16
- plan version: `lattice-research-campaign-1-v6`
- TODO: RC1-U
- 対象commit: 本文書とcharacterization testを含むcommit
- 判定: expected redを再現し、RC1-V1／V2／Wの契約を固定

## Codegraph preflight

source変更に先立ち、現行index（Codegraph 1.4.1、46 files、1050 nodes、3984 edges、pending 0）で
`verifyRc1V5CampaignArtifactSet`、`runRc1BlackBoxOracle`、`compileRc1V5BehaviorEvidence`と関連sourceを確認した。

- `verifyRc1V5CampaignArtifactSet`: impact 4 nodes／5 edges。artifact writerとv5 campaign testがconsumer。
- `runRc1BlackBoxOracle`: impact 10 nodes／15 edges。v4／v5 transform、campaign、関連testへ波及。
- `compileRc1V5BehaviorEvidence`: impact 7 nodes／7 edges。v5 transform、campaign、関連testへ波及。
- `codegraph affected`: 14 dependentsを走査し、RC1 oracle、evidence、transform、campaignの関連testを列挙。
- dynamic unknown: Worker内module import、Workerが継承する`execArgv`／environment、Git／worktree副作用、
  保存artifact間のdigest chainは静的graph単独では解決不能。空結果を依存なしへ丸めていない。

## 固定した反例

`research/campaigns/rc1/artifacts/v5`のmanifestと全payloadを読み、receiptからenvelope、transform receipt、plan diff、
comparison、hypothesis evaluation、execution evidence、manifestまで依存digestを再計算した。

v5 full verifierは次をすべてvalidとして受理した。

1. 保存oracleと無関係な`oracle_digest`への置換。
2. `outcome: passed`のまま`expected_digest != observed_digest`にしたcase。
3. 8件ある保存oracleに対してreceiptのcase列を1件へ切り詰めた結果。

これは単一hashの検査漏れではなく、保存oracleのexact semanticsがreceiptへbindされていない反例である。

## v6 expected-red契約

予定module `src/rc1-v6-causal-binding.mjs`に対し、次のartifact-only検証面をtest-firstで固定した。

- `verifyRc1V6BehaviorReceipt`: 保存oracleからcase ID、順序、件数、expected kind／digestを再計算し、
  `passed`ならexpected／observed digest一致を必須化する。Node version、明示`exec_argv`、必要environment、
  executor source digestを持つruntime identityを外部期待値へ照合する。
- `verifyRc1V6RunEvidence`: typed source snapshot preimage、base、patch、query set、Codegraph version／executable digest、
  raw evidenceを同一measurementへbindし、run、bundle、独立期待値をcross-checkする。
- `verifyRc1V6PlanPredecessors`: rejected v5 plan archive、Phase Decision、accepted transform、behavior envelope、
  control／treatment各2 evidence bundleのexact ordered predecessor集合を照合する。

corruption controlはoracle置換、case欠落／追加／並替え、false pass、runtime drift、snapshot substitution、
Codegraph version drift、raw evidence substitution、predecessor substitutionを依存digest再封印後もrejectする契約である。

## 実行結果

```text
$ node --test test/rc1-v6-causal-binding.test.mjs
pass 1
fail 1
skip 0

PASS v5 full verifier accepts resealed oracle, false pass, and truncated case semantics
FAIL v6 causal binding rejects semantic and measurement substitutions after resealing
     ERR_MODULE_NOT_FOUND: src/rc1-v6-causal-binding.mjs
```

失敗原因は予定module未実装だけであり、既存v5反例の再現はgreenである。RC1-V1／V2／WはこのAPIとcorruption
expectationを変えずに実装し、仕様変更が必要なら実装都合でtestを弱めずplan versionを再裁定する。

