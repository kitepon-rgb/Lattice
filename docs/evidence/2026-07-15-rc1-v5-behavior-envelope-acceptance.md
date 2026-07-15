# RC1 v5 behavior envelope／evaluator受入証拠

- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-O2、RC1-O2B
- 対象Control: `lattice-rc1-closed-loop-v3`
- 実装commit: `009df1f95d7d35c90a46a347ceb03546eb028f59`
- Decision: [ADR 0024](../adr/0024-rc1-v5-behavior-envelope-accepted.md)

## Scope

F（causal evidence／artifact identity契約）として親が直轄した。変更は次の2 fileだけである。

- `src/rc1-v5-behavior-evidence.mjs`
- `test/rc1-v5-behavior-evidence.test.mjs`

oracle executor、filesystem surface observer、transform、campaign writer、fixture、v4 source／artifactは変更していない。
dotagentsとObserver関連repoはread-onlyを維持し、Control recordはLatticeの`.git`配下だけを更新した。
remote作成、push、publishは実施していない。

## Source編集前のCodegraph

[preflight evidence](2026-07-15-rc1-v5-behavior-binding-preflight.md)で、既存v4 symbolのcaller／callee／impact／affected
testと、新規v5 symbolの未存在を確認した。characterization commit後に明示reindexし、source着手直前は
`40 files / 771 nodes / 2,945 edges`、index state `complete`、pending refs／changes `0`だった。

新規pathとsymbolの空結果は依存なしへ丸めず、planned symbol／new path unknownとしてO2へ引き継いだ。

## 実装した契約

`src/rc1-v5-behavior-evidence.mjs`は次を実装した。

1. receipt v3、fixed surface v1、envelope v1をexact schemaとself-digestから検証する。
2. pre receiptを`transform.source.code_snapshot_digest`、post receiptをaccepted transformのexact output
   snapshotへ結ぶ。
3. role、base SHA、oracle、entrypoint、surface、transform artifact、patch、envelope参照をunderlying
   artifactから再計算する。
4. comparison v3のbehavior summaryを信頼せず、envelope参照とfull evidenceから`behavior_binding`を評価する。
5. manifestと保存bytesのpath bijection、required payload、byte count、SHA-256、canonical writer JSON、
   patch bytes、全behavior relationを再計算する。
6. malformed surfaceを公開validatorのexceptionではなく`false`へfail closedにする。

sourceとtestのSHA-256は次である。

- `src/rc1-v5-behavior-evidence.mjs`:
  `4086775b2689f2503622936ef61251389b7cf02e72fed2bbfda82233949bd70b`
- `test/rc1-v5-behavior-evidence.test.mjs`:
  `350909e393ff311cad65219b80096acbd30763a286bb3554175a22987a0fc698`

## 親監査で見つけ、commit前に除去した非識別

最初のfocused実装は2／2 greenだったが、親diff監査では次の2点を受入不可とした。

1. post surfaceはtransform outputへbindされていた一方、pre surfaceはbase SHAにしかbindされず、
   `transform.source.code_snapshot_digest`とのrelationがなかった。
2. corruption testはleaf変更後のreceipt／envelope digestを古いまま残していた。そのためrelationを
   検査しなくてもstale digestだけでrejectでき、因果relationの識別力を立証していなかった。

修正後のtestは、leaf corruptionごとにreceipt、envelope、comparison参照を再封印する。その状態でも
post→pre再利用、role、base、oracle、entrypoint content、pre source snapshot、post surface、observation
drift、patch、transform outputの全反例が`behavior_binding=false`になる。

また、`files: [null]`のsurface validator probeがnative `TypeError`を投げる実欠陥を再現した。testを
`1 pass / 1 fail / 0 skip`へ先に赤くし、validator全体をfail-closed境界へ置いてgreenへ収束させた。

## Focused gate

最終実行:

~~~text
node --check src/rc1-v5-behavior-evidence.mjs
node --check test/rc1-v5-behavior-evidence.test.mjs
node --test test/rc1-v5-behavior-evidence.test.mjs
git diff --check
~~~

結果:

- syntax: 2 entrypointとも成功
- focused: `2 pass / 0 fail / 0 skip`
- corruption controls: 10種すべてfalse support
- manifest controls: required payload欠落と保存byte改変をreject
- diff check: 成功

O2完了候補で必要な関連testは、この新moduleを直接consumeする
`test/rc1-v5-behavior-evidence.test.mjs` 1件であり、上記focused runと同一scopeで一回実行済みである。
full `npm run ci`はRC1-RのPhase gateへ集約し、ここでは実行していない。

## Source commit後のCodegraph

`codegraph index .`を明示実行した。結果は
`41 files / 811 nodes / 3,113 edges`、index state `complete`、pending refs／changes `0`だった。

| owned export | caller | callee要約 | impact | affected test |
|---|---|---|---|---|
| `compileRc1V5BehaviorEvidence` | v5 behavior test | exact record、receipt、transform、digest、binding | 2 nodes／1 edge | v5 behavior test |
| `evaluateRc1V5Hypothesis` | v5 behavior test | binding、envelope、v4 non-behavior evaluator | 2／1 | v5 behavior test |
| `verifyRc1V5BehaviorArtifactSet` | v5 behavior test | manifest、payload、byte hash、binding | 2／1 | v5 behavior test |
| `validateRc1V5BehaviorSurface` | v5 behavior test | surface validator | 2／1 | v5 behavior test |
| `validateRc1V5BehaviorReceipt` | 現時点では空 | receipt validator | 1／0 | 現時点では空 |

最後の空caller／affectedは依存なしではない。RC1-O1のoracle executorがconsumeする予定の未接続exportであり、
O1 source着手前に再度Codegraphでcaller／callee／impact／affected test／unknownを確認する。

## 結論

RC1-O2とO2Bの局所契約は受入可能である。これはv5閉ループ全体またはH1-v5の支持ではない。
RC1-O1、P、Q、Rは未完了で、O1の実surface observationとPのisolated transform integrationが
このpure causal boundaryを実データへ接続するまで、v5 campaign supportは主張しない。
