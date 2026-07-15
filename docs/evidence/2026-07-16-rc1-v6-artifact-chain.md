# RC1 v6 artifact chain evidence

- 日付: 2026-07-16
- plan version: `lattice-research-campaign-1-v6`
- TODO: RC1-W
- Decision: [ADR 0030](../adr/0030-rc1-v6-artifact-chain-trust-boundary.md)

## Preflight

Codegraphを追加source込みで同期し、55 files、1,281 nodes、4,867 edges、pending 0を確認した。

- `resolveRc1V6CodegraphIdentity`: callers 3、callees 4、impact 5 symbols。
- `verifyRc1V6CampaignArtifactSet`: callers 3、impact 4 symbols。
- `runRc1V6Campaign`: caller 1、impact 2 symbols。
- `writeRc1V6Artifacts`: caller 1、callees 7、impact 2 symbols、affected test 1。
- manual unknownはdynamic Worker、Git／worktree lifecycle、PATH解決後のCodegraph dependency tree、保存codeの実行を伴わない
  provenance authenticityである。空結果やstatic graph外unknownを依存なしとは扱っていない。

## 実装したcausal chain

- control／treatment各2のv2 evidence bundleとcondition runをtyped snapshot、base、patch、query、Codegraph identityへ結合した。
- normal／negativeの8 compileを保存runからreplayし、4組のmanifest／verdict／planをexact照合した。
- accepted transform、v2 behavior envelope、v6 transform receipt、plan diff v3、comparison v4、hypothesis evaluation v4、
  execution evidence v6を下流digestだけでなく保存preimageから再構成した。
- boundary compiler、oracle executor、resolved Codegraph executableの実bytesをexact setへ加え、identity digestを再計算した。
- disk loaderはmanifest pathを入力として使わず、compile-time exact path setだけを読む。

## Characterizationとfocused gate

初回campaign testは未実装moduleで赤、実装後はcompiler replayの保存形差分を検出して赤になった。保存artifactはcompilerの
metadataを別fileへ重複保存せず、manifest／verdict／planの実payloadとreplay結果を個別照合するよう修正した。

identity bytes追加前には3 path欠落で期待赤を確認した。追加後、manifestを再封印したoracle、plan predecessor、compiler bytes、
oracle executor bytes、Codegraph executable bytesの置換をsemantic verifierがrejectした。

```text
$ node --test test/rc1-v6-causal-binding.test.mjs \
  test/rc1-v6-behavior-evidence.test.mjs \
  test/rc1-v6-measurement.test.mjs \
  test/rc1-v6-campaign.test.mjs
tests 6 / pass 6 / fail 0 / skip 0
```

これはRC1-Wのrelated gate一回である。full `npm run ci`はRC1-Yまで実行していない。
