# RC1-D control compile acceptance evidence

- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v2`
- 対象Control／Task: `lattice-rc1-closed-loop-v3`／`RC1-D-control-compiler-v3`
- 実装commit: `d2d4128`
- Decision: [ADR 0009](../adr/0009-rc1-control-boundary-compile-accepted.md)

## Accepted outputs

[control artifact directory](../../research/campaigns/rc1/artifacts/control/)へ、fixed plan input、fixed query set、実Codegraph
outcome、manual evidence、fixture snapshotから次を生成した。

- normal: boundary manifest、boundary verdict、control plan v1。
- shared-state negative: boundary manifest、boundary verdict、control plan v1。
- portable compilation evidence: input／outcome／artifact digest、canonical byte length、Codegraph index要約、observed facts。

artifact fileはreview用pretty JSONであり、公開byte contractはparsed payloadを`canonicalizeArtifact`した結果である。
presentation file byteをcanonical artifact byteと偽らず、各canonical lengthとSHA-256を
`compilation-evidence.json`へ記録した。Codegraph raw telemetryはdigestでbindし、端末絶対pathをrepoへ複製していない。

## Result

### Normal control

- graph evidenceはstatus ready、既存anchorのquery／caller／callee／impact ready、未作成seam 2 symbolの
  query／impact `symbol_absent`、既存／未作成path混在のaffected `unresolved`を保持した。
- boundary manifestは`write_boundary` conflict 1件、TODOごとのmanual evidence provenance、未作成surface／pathの
  unknownを持つ。
- verdictは`seam_candidate`で、channel／labelを非重複symbol／pathへ抽出する候補を持つ。
- plan v1はwrite conflict edge 1件、writer capacity 2に対してminimum feasible waves 2である。

Canonical digests:

- boundary manifest: `033481a45c95cef9a80caa38abefa7967d7aa42e6060e891e0f24b6470cbef72`
- boundary verdict: `a716d3bdd986730046a4b67a26172e4ddee4b02655822037c4672232077078fe`
- plan graph: `2799806b65c2749d9da34855e59d6cc3eaea9d749344e42f8e90c98eb58903c1`

### Shared-state negative control

- 同じgraph evidenceにmanual state write conflictを加え、`write_boundary`＋`state`の2 conflictを保持した。
- state conflictは関与する2 TODOのmanual evidence recordだけを参照する。
- verdictは`intentional_serial`で、`seam_candidate`／`parallel_ready`へ昇格しない。
- plan v1はwrite conflict＋state conflict edgeを持ち、minimum feasible waves 2のままである。

Canonical digests:

- boundary manifest: `d539b016d9109de0ef655318d5c61516ed3184f867b8ce2c9e0848a95fecc74f`
- boundary verdict: `9e91c4442cc7672062a9b42c35eb7328439f27d552b1392f266e73d09f4182a0`
- plan graph: `5fc9761fd34d5c9c0d71886ee27e05560f1ede2ee83d714bee2f3eb8baf47934`

## Verification

- focused red: artifact manifestのmanual provenance未実装とcontrol compiler未実装をそれぞれfailとして確認した。
- focused green: `node --test test/artifact-contracts.test.mjs test/control-compiler.test.mjs`は
  9 pass／0 fail／0 skip。
- static: Task記録のsource／test 4件に加えintegration fileの`node --check`が成功した。
- related integration初回: Codegraph fuzzy candidateをexact symbolへ誤昇格するRC1-B defectを再現して失敗した。
  期待値を緩めず、[ADR 0008](../adr/0008-codegraph-exact-symbol-identity.md)の独立B2修復へ分離した。
- failed-scope related rerun: `node test/integration/control-compiler.integration.mjs`成功。
- post-index: 16 files、208 nodes、835 edges、complete、pending changes／refs 0、mismatchなし。
  `compileControlArtifacts`のcaller／callee／impact、validator impact、affected testを取得した。
- persisted artifact verification: public validator 6件＋canonical digest照合6件、計12 checks成功。
- secret/path scan: artifact directoryに`/Users/`、`/tmp/`、`.git/`なし。
- `git diff --check`成功。

full `npm run ci`は未実行であり、RC1-GのPhase gateへ集約する。

## Residual scope

- `seam_candidate`は変換提案であり、behavior preservationまたはpost-transform parallel readinessを証明しない。
- fixture transform、isolated verifier、post-index、plan v2、plan diff、control／treatment比較はRC1-E／Fに残る。
- arbitrary codebase向け一般compiler、dynamic runtime analysis、performance最適化はRC1-Dの受入範囲外である。
- dotagentsとObserver関連repoはread-onlyのままである。
