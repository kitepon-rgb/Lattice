# RC1 v6 snapshot／Codegraph measurement binding evidence

- 日付: 2026-07-16
- plan version: `lattice-research-campaign-1-v6`
- TODO: RC1-V2
- Decision: [ADR 0029](../adr/0029-rc1-v6-causal-identity-preimages.md)

## Codegraph preflight

RC1-V1 commit後に`codegraph sync .`を実行し、50 files、1141 nodes、4349 edges、pending 0、index completeを確認した。

- `createRc1EvidenceBundle`: callers 5、callees 9、impact 10 nodes／10 edges。v4/v5 campaignの観測入口である。
- 想定した`runCodegraphQuerySet` symbolは存在せず、実入口は`collectCodegraphEvidence`だった。空結果を依存なしへ丸めず、
  sourceを実読して入口を訂正した。
- adapter、bundle、campaign、control／treatment compilerのaffectedは12 tests、total dependents 26。
- manual unknownはglobal Codegraph executableの依存tree、fresh indexとsnapshot capture間の時間順序、Git worktree副作用である。

実装後に再syncし、52 files、1181 nodes、4467 edges、pending 0を確認した。`verifyRc1V6RunEvidence`はcaller 5、
impact 6 nodes／8 edgesとなり、bindingとcompiler wrapperの実consumerがindexへ現れた。

## Characterization

実装前のfocused testは予定module欠落だけでredだった。

```text
node --test test/rc1-v6-measurement.test.mjs
0 pass / 1 fail: ERR_MODULE_NOT_FOUND src/rc1-v6-measurement.mjs
```

## 実装

- behavior fixed surfaceの`present`／`absent`とaccepted transform outputを、sorted
  `lattice.rc1.source_snapshot.v1`へ投影する。
- 実repo pathの通常file bytesをSHA-256化し、存在しないpathを`state: absent, content_digest: null`として明示保存する。
- PATH上の`codegraph`をrealpathし、実entrypoint bytes digestと`codegraph --version`を
  `lattice.rc1.codegraph_identity.v1`へ固定する。absolute executable pathはartifactへ保存しない。
- 既存v1 bundleのraw／diagnostic／portable semantic validationを保持し、base SHA、patch digestまたはnull、source snapshot、
  Codegraph identity、query set、raw evidenceをmeasurement v1へcross-bindする。
- run identityは巨大raw base64を含むbundle全体hashでなく、ADR 0029のbounded bundle descriptor digestを使う。
- `compileRc1V6BoundaryCondition`は外部`codeSnapshotDigest`引数を持たず、verified bundleの
  `measurement.snapshot_digest`とdecoded raw evidenceからだけboundary compilerを実行する。compiler outputのsnapshotと
  Codegraph versionもmeasurementへ再照合する。

canonical v5 artifactをpreimage fixtureとして、control pre surfaceからのsnapshot、accepted transform outputからのtreatment
snapshot、post behavior surfaceからのsnapshotが一致することを確認した。全4 fresh runへの適用はRC1-Xの実験実行gateで行う。

## Gates

Focused:

```text
test/rc1-v6-measurement.test.mjs
2 pass / 0 fail / 0 skip
```

TODO完了候補のCodegraph related setを一回実行した。

```text
test/rc1-black-box-oracle.test.mjs
test/rc1-v6-behavior-evidence.test.mjs
test/rc1-v6-causal-binding.test.mjs
test/rc1-v6-measurement.test.mjs

14 pass / 0 fail / 0 skip
```

full `npm run ci`、2+2 campaign、immutable artifact発行は実行していない。

