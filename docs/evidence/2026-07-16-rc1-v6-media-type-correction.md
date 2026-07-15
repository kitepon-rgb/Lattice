# RC1 v6 artifact media-type correction evidence

- 日付: 2026-07-16
- plan version: `lattice-research-campaign-1-v6`
- TODO: RC1-X0
- Decision: [ADR 0030](../adr/0030-rc1-v6-artifact-chain-trust-boundary.md)

## 再現

最初のcanonical発行候補はcampaign、atomic write、disk verifier 12 checksを完走した。しかしTODO完了候補の実manifest監査で、
`identity/codegraph-executable`の`media_type`が`text/markdown`になっていることを確認した。writerが`.json`、`.mjs`、`.patch`
以外を一律Markdownへfallbackし、verifierもpathごとのmedia typeを検査していなかったためである。

因果payload digestは一致していたが、exact artifact setの型契約違反なので候補を受理していない。manifestの手補正も行っていない。

## Codegraph preflight

- status: 55 files、1,284 nodes、4,880 edges、pending 0。
- `artifactContext`: callers 2、callees 12、impact 11 symbols。名前衝突でv5／v6双方が表示されたため、v6 pathを実読した。
- `writeRc1V6Artifacts`: caller 1、impact 2 symbols。
- affected test: `test/rc1-v6-campaign.test.mjs`。
- manual unknown: manifest media typeはstatic call graph外のartifact semanticsであり、空結果を依存なしへ丸めていない。

## Characterizationと修正

campaign characterizationへCodegraph executableの期待media typeと、manifestを再封印したmedia type substitutionを追加した。
修正前はactual `text/markdown`／expected `application/javascript`で1 failを再現した。

修正後はv6 exact path setを受理する単一`rc1V6ArtifactMediaType`をwriter／verifierが共有する。JSON、JavaScript source／
Codegraph executable、patch、predecessor Markdownをpath別に分類し、未知pathはthrow、既知pathのtype置換はexact-set verificationでrejectする。

```text
$ node --check src/rc1-v6-artifact-set.mjs
$ node --check src/rc1-v6-campaign.mjs
$ node --test test/rc1-v6-campaign.test.mjs
tests 1 / pass 1 / fail 0 / skip 0
```

full `npm run ci`はRC1-Yまで実行していない。未受理candidateはこの修正commit後に削除し、同じ正規runnerから再発行する。
