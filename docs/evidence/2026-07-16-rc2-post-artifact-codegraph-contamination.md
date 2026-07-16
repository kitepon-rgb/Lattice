# RC2 post-artifact Codegraph contamination reproduction

- 記録日: 2026-07-16
- failing HEAD: `4baf09c36d9125f7860747033d5479fd055a4863`
- Codegraph: `1.4.1`
- scope: Lattice post-artifact fresh index

## Failure

artifact v1 commit後にPhase full `npm run ci`を実行し、167 tests中163 pass、4 failだった。4件は同じRC2 campaign fixture failureの
連鎖で、最初の例外は`portable affected src/rc2-delivery-policy-oracle.mjsがsnapshot存在状態へbindしていない`だった。
続くfocused `node --test test/rc2-campaign.test.mjs`も1 pass／4 failで、suite並列性を原因から除外した。

fresh clone＋`codegraph init .`で同じquery setを直接観測すると、oracle sourceは通常fileとして存在する一方、`affected`は次を返した。

```json
{"changedFiles":["src/rc2-delivery-policy-oracle.mjs"],"affectedTests":[],"totalDependentsTraversed":3}
```

artifact commit前のcanonical run、およびartifact追加前indexへincremental syncした作業treeでは、同じtargetがcampaign、fixture、transformの
3 testを返した。fresh full indexだけで保存`identity/*.mjs`がlive sourceと重複し、graph resolutionが変化した。

## Coverage evidence

artifact commit前indexは77 filesだった。`status`はartifact commit後もpending changes 0を報告したが、`codegraph files`には新artifact sourceが
未収載だった。明示`codegraph sync .`で12 files／523 nodesが追加され、statusだけではcoverageを判断できない既知境界を再現した。

一時cloneだけへ次の正規configを置いてfresh `codegraph init .`すると、indexed filesは75、artifact identity filesは0、
`src/rc2-campaign.mjs`とoracle sourceは収載された。oracle `affected`は3 test、total traversed 6へ戻った。

```json
{"exclude":["research/campaigns/**/artifacts/**/identity/"]}
```

この診断cloneは削除済みで、canonical artifact v1、RC1 artifact、dotagents／Observer関連repoは変更していない。

## Classification

実コードで再現するsensor scope欠陥であり、前例不足やworth-it判断ではない。front-endのfail-loudは正しく、emptyをindependenceへ丸めなかった。
correctionはADR 0040に従い、artifact identity exclusion、config preimage binding、immutable artifact v2／plan v3として扱う。
