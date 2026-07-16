# RC2 artifact version-contract expected-red characterization

- 観測日: 2026-07-16
- production source HEAD: `f811d935005c3d3ac62b62b320bb1952ff513e90`
- Decision: [ADR 0042](../adr/0042-rc2-artifact-version-witness-epoch-and-v4.md)
- focused test: `test/rc2-artifact-version-witness.test.mjs`
- test source SHA-256: `3f3a78a05bf273c12c6cc114507e7126e141d64605f39f0f2652d31c5d171ba9`

## Characterization contract

専用testはcanonical v2の共通payload 71件と、canonical v3に追加されたpredecessor 4件から75-pathのv3 setをmemory上に作る。
execution identityをv3へ進め、plan v4、35 causal predecessor、plan diff、comparison、execution evidence、manifest entryをすべて
現行の正規化／digest規則で再計算する。manifestだけを書き換える単一field corruptionではない。

再包装setは次の旧witnessを保持する。

- candidate digest: `30ee67852f7ab5fb0d9bf82f2a4c55b6569a76507b0df5b329290c84d29b49f5`
- oracle source digest: `c4012dfc00cc5b0194bd1a87be4a4e0b20d45e784d49a987768eea1b9932fafe`
- manifest base SHA: `888b32e68c4a960506a24724a9c0a0e47ba81471`
- resulting envelope: artifact manifest v3、plan `rc2-delivery-policy-v4`、35 causal predecessors、75 payloads

修正後の契約は、同じsetを`valid: false`かつ`transform_binding`失敗として拒否すること。check IDと件数は増やさない。

## Focused expected-red

実行入口:

```text
node --test test/rc2-artifact-version-witness.test.mjs
```

production source変更前の一回実行結果:

```text
tests 2
pass 1
fail 1
duration_ms 480.960209

canonical RC2 artifact v1／v2／v3のread compatibilityを維持する: passed
artifact v3はcanonical v2 witness epochの完全再封印downgradeを拒否する: failed
AssertionError: true !== false
```

1件目でcanonical v1は14 checks、v2／v3は各15 checksのままgreenだった。2件目は補正後のrejectを期待したのに、current verifierが
`valid: true`を返したためだけにexpected-redになった。module欠落、manifest digest不一致、旧artifact compatibility破壊は失敗原因ではない。

## Immutable inputs

- v1 manifest SHA-256: `7152dfc3eefdc21d560ed4d8f5a25b644345538abdca0ddfda494cca07608ed6`
- v2 manifest SHA-256: `8622b820d74c3bd0fac063affda3fc5449a11c32cf4a424a919337ff93e1f2cf`
- v3 manifest SHA-256: `31bb32689722c453ef99a893af9a33406529687c359a3a1a35552d6cb29af858`

artifact v1／v2／v3、production source、既存ADR／evidenceは変更していない。related／full gateは実行していない。
dotagents／Observer関連repo write、remote作成、push、publishは0。
