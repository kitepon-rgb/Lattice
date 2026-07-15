# RC1 v5 full oracle receipt／surface observation受入証拠

- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-O1
- 対象Control: `lattice-rc1-closed-loop-v3`
- characterization commit: `e02a2630c26f168e7a23e1bea5b554d61a1a3c7e`
- source commit: `46cf93cdea04a92ae8decb8f38f65dd0167abe6a`
- Decision: [ADR 0025](../adr/0025-rc1-v5-oracle-observation-accepted.md)

## Scope

F（observation identity／artifact contract）として親が直轄した。変更は次に限定した。

- `test/rc1-black-box-oracle.test.mjs`
- `src/rc1-black-box-oracle.mjs`
- [preflight evidence](2026-07-15-rc1-v5-oracle-preflight.md)

fixture、oracle input、transform、campaign writer、v4 artifactは変更していない。dotagentsとObserver関連repoは
read-only、Control recordはLatticeの`.git`配下だけを更新した。remote作成、push、publishは行っていない。

## Source着手ゲート

最初のpreflightは`41 files / 811 nodes / 3,113 edges`、complete、pending `0`で、既存
`runRc1BlackBoxOracle`のimpact `8 nodes / 11 edges`、affected test 4件を確認した。
planned `runRc1V5BlackBoxOracle` queryは既存v4 symbolへのfuzzy hitだけで、planned-name unknownとして扱った。

characterization commit後に再indexし、source編集直前を
`41 files / 820 nodes / 3,148 edges`、complete、pending `0`へ更新した。既存v4 impactとaffected 4 testは
変わらず、v4 APIをin-place変更せず新exportを追加する方針を維持した。

## Characterizationと実反例

test-first gateは`8 tests / 4 pass / 4 fail / 0 skip`だった。

- green: 既存v4 3件と、v4 ESM dependency-cache反例
- red: v5 receipt、base／scope、fresh module graph、surface drift
- red原因: 4件とも`runRc1V5BlackBoxOracle is not a function`

cache反例はtemp Git repoでentrypointを変えずdependencyだけ`before→after`へ変え、v4 executorをpre／postに
呼んだ。post call自体は実行されたが、同じentrypoint URLのcached module graphを再利用し、postも`passed`、
receiptもpreと同一になった。したがってentrypoint content query parameterだけではpost observationを
dependency snapshotへ帰属できない。

## 実装したv5観測契約

`runRc1V5BlackBoxOracle({ repoRoot, oracle, role, baseSha, surfacePaths })`は次を行う。

1. oracle、surface path、role、base SHAをexact検証し、oracleとsurface listを最初のasync境界前にcloneする。
2. `baseSha`を実repoの`HEAD^{commit}`へ照合し、観測後にもHEAD不変を確認する。
3. sorted fixed surfaceの全pathを`present | absent`とcontent digestへ観測する。
4. root外、symlink ancestor／file、special file、oracle input／executorを含むsurfaceをtyped rejectionにする。
5. 各receiptをfresh Worker module graphで実行し、dependency module cacheを観測間で共有しない。
6. 同じsurfaceをoracle直後に再観測し、digest driftなら`LATTICE_RC1_V5_SURFACE_DRIFT`としてreceipt生成を拒否する。
7. surfaceがstableでbehaviorだけ違う場合は、全case resultを持つvalidなfailed receiptを返す。
8. role、実base SHA、oracle digest、entrypoint／export、entrypoint content、surface preimage／digest、
   observation、case resultsをreceipt v3のself-digestへ含める。

sourceとtestのSHA-256は次である。

- `src/rc1-black-box-oracle.mjs`:
  `40f26d5a076dd0736ee46f3dd9e4c0604bbbdbeb89bc5857b69a44e51eb4aa73`
- `test/rc1-black-box-oracle.test.mjs`:
  `05b98804e007ab62ba2730a9a6a36300c0ba12bacba03b004e0a4df71d4769f7`

## Focused gate

実行:

~~~text
node --check src/rc1-black-box-oracle.mjs
node --test test/rc1-black-box-oracle.test.mjs
git diff --check
~~~

結果:

- syntax: 成功
- focused: `8 pass / 0 fail / 0 skip`
- pre／post receipt: `validateRc1V5BehaviorReceipt=true`
- false baseとscope violation: typed rejection
- dependency-only behavior drift: v5 post receiptが`failed`
- observation中surface mutation: typed drift rejection
- v4 receipt v2の既存3件とcache反例: green

## Related gate

Codegraphが列挙したaffected test 4 fileを、O1完了候補で一回実行した。

~~~text
node --test test/rc1-black-box-oracle.test.mjs \
  test/rc1-v4-campaign.test.mjs \
  test/rc1-v4-characterization.test.mjs \
  test/rc1-v4-transform.test.mjs
~~~

結果は`20 pass / 0 fail / 0 skip`、約14.3秒だった。実v4 campaignのcontrol／treatment各2 fresh index、
isolated transform、pre／post v4 oracle、cleanup、source invariantもgreenで、v4 caller互換を保持した。
full `npm run ci`はRC1-Rへ集約し、ここでは実行していない。

## Source commit後のCodegraph

明示`codegraph index .`後は
`41 files / 845 nodes / 3,254 edges`、complete、pending refs／changes `0`だった。

- `runRc1V5BlackBoxOracle`: exact exported function
- caller: `test/rc1-black-box-oracle.test.mjs`
- callees: exact record、oracle validator、surface paths、typed rejection、repo root、Git HEAD、surface capture、
  fresh Worker、artifact digest
- impact: `2 nodes / 1 edge`
- `Rc1V5OracleRejection`: exact exported class、callerはinternal `v5Rejection`
- 既存`runRc1BlackBoxOracle`: impact `8 / 11`を保持
- path-level affected test: oracle、v4 campaign、v4 characterization、v4 transformの4 fileを保持

v5 runnerの現callerがtestだけなのは依存なしではない。RC1-Pでisolated transformへ接続するplanned integration
unknownであり、P source着手前に同じCodegraph gateを再実行する。

## 結論

RC1-O1の局所契約は受入可能である。O1は実観測receiptを作れるが、まだaccepted transformと同じdisposable
worktree内でpre→transform→postを順序固定していない。RC1-P、Q、RとH1-v5支持は未完了のまま維持する。
