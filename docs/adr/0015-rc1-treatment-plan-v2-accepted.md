# ADR 0015: RC1 treatment plan v2と閉ループ結果をacceptする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v3`
- 対象Control: `lattice-rc1-closed-loop-v3` / `RC1-F-treatment-recompile-v3`
- depends on: ADR 0013、ADR 0014

## Context

RC1-D2はportable controlを、RC1-E2は同じcontrol baseへbindされたaccepted seam transformを確立した。核心仮説を識別可能に
判定するには、accepted patchだけをcontrol baseへ加え、同じTODO input、manual evidence、query set、capacity、verifierでfresh
Codegraph indexし、旧planへ追記せず新versionへ全affected TODOを再compileする必要がある。

## Decision

- commit `52870a58b6a8c466d4f6f457dadedea01a6df4c4`のpure treatment compilerとisolated reindex runnerをacceptする。
- runnerのpredecessor chainをcontrol-v2 compilation evidence → E2 execution evidence → accepted transform artifact → raw patch →
  post snapshotの順で検証し、一件でもdriftすればworktree作成前にfail closedとする。
- control base `d2d412800492fbed03febe02abc6dca81c09a88b`へaccepted patchだけを適用したdisposable worktreeをfresh indexし、
  `.codegraph-rc1-treatment`はsource patchと分離してcompiled artifact返却前に削除する。
- normal treatmentのboundary manifest `cc2761d1d2839f8e309a2c7869e8169bdb964ac63e9e017194c3ed0a2878006a`と
  plan `rc1-treatment-v2` / `c3122180b9d1faf95ab49f9a40434b71d9074596548fc57bfe5f07460f1decac`をacceptする。
- `rc1-control-v1`はimmutable predecessorとして保持し、node／edgeを追記しない。plan diff
  `52a816d0c2c4243f103a7eee3c118173ffdb4efb17dc2089a27d5134d10dc7b2`によりold plan、agent context、partial patch、
  interface assumptionを失効する。
- normalは`seam_candidate`／write conflict 1／2 wavesから`parallel_ready`／write conflict 0／1 waveへ変わる。
  hard precedenceは0のまま、post-transform unknownは0である。
- shared-state negativeはpath分離後もstate conflict 1、`intentional_serial`、2 wavesを保持する。構造分離だけで
  semantic independenceを宣言しない。
- この結果は固定fixture内で核心仮説をsupportする。任意repoでの成功率や一般的速度改善率は主張せず、Phase gateのfull CIと
  独立反証が完了するまでResearch Campaign全体を完了扱いしない。

## Accepted identity

- portable treatment outcomes: `9d959e2ad40e4e027b0bb62921436d7b3a6e8139b982af976c7a38b1cac5b6f3`
- normal boundary verdict: `50269f3b6b89d4b3514be5ed24b9cfe0eb9958cd15337bcb74df744d41820acf`
- negative boundary manifest: `778732e8c67ae8fb1123bcd15cdb0c485af26c8a3823e136d171d375e7aaaa11`
- negative plan: `928736dc5a82ebca766304b44f428e19f2b896466d4cb0f2adec49f20fd408a7`
- control／treatment comparison: `44d32a06ea56db357988ccd1f6e0325683b2b3503412716a151934dbb3ebf738`
- execution evidence: `3fafb388fcb034ffe0d89235fd7d151cb3d7ba44d30471246adac9f92dfb7596`

## Rejected alternatives

- **canonical branchへpatchを適用してindexする:** source不変とrollback boundaryを失う。
- **active control planへedge削除を追記する:** immutable plan versionと旧agent context失効を証明できない。
- **post-transform向けにquery setを変更する:** independent variableがseam transformationだけでなくなる。
- **Codegraph sensor directoryをpatch scopeへ含める:** code snapshot、sensor state、compiled artifactの責務を混同する。
- **new symbolsの`ready`だけでparallel判定する:** manual state／effect negativeを見落とす。

## Consequences

- Latticeの最初の細い閉ループはTODO候補 → boundary compile → typed verdict → seam transform → same-query reindex →
  new plan version compile → control比較までmachine artifactで接続された。
- 2 fresh treatment runはraw telemetry digestが異なる一方、portable outcomeと全identity artifactが一致した。
- normalのunknown 0はこの固定query／manual evidenceに対する結果であり、runnerの既存ignored file content-only mutation検出と
  単一fixtureの一般化可能性はresidual unknownとして残る。
- Codegraph、dotagents、Observer関連repoのwriter境界は変更しない。
