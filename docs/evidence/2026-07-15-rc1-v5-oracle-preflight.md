# RC1 v5 full oracle receipt／surface observation preflight

- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-O1
- 対象Control: `lattice-rc1-closed-loop-v3` / `RC1-O1-oracle-characterization-v5`
- classification: F（observation identity／artifact contract、親直轄）
- predecessor: [ADR 0023](../adr/0023-rc1-v5-behavior-evidence-contract.md)、
  [ADR 0024](../adr/0024-rc1-v5-behavior-envelope-accepted.md)

## Writer boundary

このpreflightとcharacterizationで変更するのは次だけである。

- `test/rc1-black-box-oracle.test.mjs`
- 本evidence

`src/`、fixture、oracle input、transform、campaign、v4 artifactは未変更である。dotagentsとObserver関連repoは
read-only、Control recordはLatticeの`.git`配下だけを更新した。remote作成、push、publishは行っていない。

## Source編集前Codegraph

`codegraph status . --json`は次を返した。

- version: `1.4.1`
- `41 files / 811 nodes / 3,113 edges`
- index state: `complete`
- pending refs: `0`
- pending changes: added／modified／removedすべて`0`
- worktree mismatch: `null`

### 既存owned symbol

`runRc1BlackBoxOracle`は
`src/rc1-black-box-oracle.mjs:157`のexact exported functionへ解決した。

- callers: `runRc1V4SeamTransform`、oracle test、v4 characterization、v4 transform file
- callees: oracle validator、entrypoint resolver、SHA-256、expected／thrown observation、artifact digest
- impact: `8 nodes / 11 edges`
- affected test: oracle、v4 campaign、v4 characterization、v4 transformの4 file

`validateRc1BlackBoxOracle`は同fileのexact exported functionへ解決した。

- callers: v4 runner、v4 transform、oracle test
- callee: internal oracle validator
- impact: `6 nodes / 10 edges`

path-level `codegraph affected src/rc1-black-box-oracle.mjs --json`も上記4 testを返した。
したがってv4 APIのin-place schema変更は行わず、新しいv5 exportを追加してv4 callerを保持する。

### Planned symbol unknown

`codegraph query runRc1V5BlackBoxOracle --json`はexact v5 symbolを返さず、fuzzy scoreで既存
`runRc1BlackBoxOracle`だけを返した。これは実装済みでも依存なしでもない。planned-name mismatchの
unknownとして扱い、source実装後に明示reindexしてexact resolutionを再確認する。

## Characterization contract

新v5 APIを次のexact inputへ固定する。

`runRc1V5BlackBoxOracle({ repoRoot, oracle, role, baseSha, surfacePaths })`

testは次を要求する。

1. receipt v3がrole、実Git HEAD、entrypoint content、full fixed surface、full case resultsを保持する。
2. 同じbehavior／surfaceでもpreとpostはroleにより別receipt identityを持つ。
3. false base SHAと、oracle input／executorを含むtransform surfaceをtyped rejectionにする。
4. oracle直前／直後のsurface digestが違えば`LATTICE_RC1_V5_SURFACE_DRIFT`としてreceipt生成を拒否する。
5. 各観測はfresh module graphを使い、entrypoint不変・dependencyだけ変更したpost behaviorを再実行する。
6. behavior divergenceはsurfaceがstableならvalidなfailed receiptとして保存する。
7. v4 APIのreceipt v2と既存3 testは変更しない。

## ESM module cacheの実再現

temp Git repoに不変entrypointとdependencyを置き、v4 executorを一度実行した後、dependencyだけを
`before`から`after`へ変更して同じoracleを再実行した。entrypoint content digestとmodule URLが同じため、
現v4 in-process executorはcached module graphを再利用し、postも`passed`、full receiptもpreと同一になった。

これは「v4 runnerがpost APIを呼ばない」という主張ではない。post callは存在するが、dependency-only transformを
fresh codeとして評価していない具体的経路である。v5は各観測をfresh Worker module graphへ隔離する。

## Expected red

実行:

~~~text
node --check test/rc1-black-box-oracle.test.mjs
node --test test/rc1-black-box-oracle.test.mjs
~~~

結果:

- syntax: 成功
- focused: `8 tests / 4 pass / 4 fail / 0 skip`
- green 4件: 既存v4 3件＋dependency-only cache反例
- red 4件: 新v5 receipt、base／scope、fresh module graph、surface drift
- failure原因: 4件とも`runRc1V5BlackBoxOracle is not a function`

これは未実装契約を先に固定したexpected redであり、O1実装成功へ丸めない。source実装後は同じfocused入口だけを
greenへ収束させ、Codegraphが列挙したv4 related testはO1完了候補で一回だけ実行する。
