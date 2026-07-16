# RC2 version witness consistency implementation

- 観測日: 2026-07-16
- source predecessor: `2549422`
- Decision: [ADR 0042](../adr/0042-rc2-artifact-version-witness-epoch-and-v4.md)
- preflight: [version witness Codegraph boundary](2026-07-16-rc2-version-witness-codegraph-preflight.md)

## Implemented contract

`src/rc2-artifact-set.mjs`のartifact contractはversionごとにexact witness pairを選ぶ。

| artifact version | epoch | candidate digest | oracle source digest |
|---|---|---|---|
| v1／v2 | `delivery-policy-legacy-v1` | `30ee67852f7ab5fb0d9bf82f2a4c55b6569a76507b0df5b329290c84d29b49f5` | `c4012dfc00cc5b0194bd1a87be4a4e0b20d45e784d49a987768eea1b9932fafe` |
| v3／v4 | `delivery-policy-semantic-v2` | `4cc5d7bb428a8899353d18524c25105742fa90f89ee55d36064c4be3c52e2907` | `c68a7ff9a7c9c4a181ceda6396d5fcbf27084de18680018d244a27998041652c` |

pure verifierは保存candidateとoracle bytesを再計算したうえで、このversion固有pairにも一致させる。front-endのv1／v2 read compatibilityは
変更していない。

accepted transformのcandidate、oracle、adapter、control snapshot、`source.base_sha`を保存identity／manifestへbindし、2件のrejected
transformもacceptedと同一candidate／sourceを持つことを要求する。base SHAの特定値はsourceへ埋め込まず、同じartifact set内のmanifest baseを
基準にする。

## Artifact v4 contract

- v3 exact setへADR 0042、本P1 evidence、v3 manifest、v3 planの4 predecessorを加算する。
- execution identity `v4`、manifest schema `v4`、campaign result `v4`を使う。
- v3 plan `rc2-delivery-policy-v4`をexact predecessorにし、new plan `rc2-delivery-policy-v5`を作る。
- causal predecessorは35件から39件へ増え、3 TODO全件と5 context invalidationを新versionへ再compileする。
- disk readerはv1／v2／v3を保持してv4を加算する。
- writer rootは`research/campaigns/rc2/artifacts/v4`、temporary rootもv4固有で、no-overwrite／fsync／atomic renameを維持する。

source digest:

- `src/rc2-artifact-set.mjs`: `6f4cb82d136cbf401aacbf00dfbf7b5a32d7dd724081a5da51372ce959ac1a8e`
- `src/rc2-campaign.mjs`: `63d720d8003aea2c8f18c80013e99ea838182512407772c13c8846a6d5fd85df`
- `test/rc2-campaign.test.mjs`: `f705d7dcec47f5c826ea67fafdedf36ea753c483b556d29cbe18cf9b5ef3e6f6`

## Focused gate

局所静的検査:

```text
node --check src/rc2-artifact-set.mjs
node --check src/rc2-campaign.mjs
node --check test/rc2-campaign.test.mjs
result: 3 success
```

main working treeでversion witness testを実行し、2件green、exit 0だった。campaign testはHEAD clone契約を持つため、今回の3-file diffだけを
`/tmp/lattice-rc2-h2e.pPoxVw`へ適用してscratch commitを作り、次を一回実行した。

```text
node --test --test-reporter=dot test/rc2-artifact-version-witness.test.mjs test/rc2-campaign.test.mjs
result: 11 green indicators, exit 0
```

gate後にこの一時cloneだけを削除した。mainのartifact v4 rootは未作成であり、canonical発行は次Taskへ分離した。

## Gate boundary

- focused: success 11／failure 0／skip 0（dot reporter、2 test files）。
- related: 未実行。canonical v4収束後に一回実行する。
- full: 未実行。同じPhase gateへ集約する。
- artifact v1／v2／v3、front-end、oracle、transform、candidate inputの変更: 0。
- dotagents／Observer関連repo write、remote作成、push、publish: 0。
