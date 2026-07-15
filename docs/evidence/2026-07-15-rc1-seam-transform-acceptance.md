# RC1-E seam transform acceptance evidence

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v2` / RC1-E
- Control: `lattice-rc1-closed-loop-v3` / `RC1-E-seam-transform-v3`
- Contract: [RC1-E seam transform](2026-07-15-rc1-seam-transform-contract.md)
- Decision: [ADR 0011](../adr/0011-rc1-seam-treatment-same-base-accepted.md)
- classification: F。介入acceptance、artifact因果鎖、canonical source不変を親が裁定した。

## Outcome

control compilation evidenceの`head`を唯一のbaseにして再実行し、accepted seamと2 rejection controlをstrict artifactへ固定した。
canonical Lattice worktreeにはpatchを適用していない。

| artifact | status／kind | canonical digest | canonical bytes |
|---|---|---|---:|
| `transform-artifact.json` | accepted | `7a667a1885928acd13b514e6bc10a68f5254392276561298c2b6d2544b374a4b` | 2237 |
| `scope-rejection-artifact.json` | rejected / `scope_violation` | `6ec29efa14624850a77b2f45ee30691d7befc17e1af75fb6b5d68b1d56d085af` | 1377 |
| `behavior-rejection-artifact.json` | rejected / `behavior_verification_failed` | `00863e9f9ca71557ab108ed6eb005aced3efc726df8cbcaa0a488a8041209bef` | 1818 |
| `execution-evidence.json` | execution receipt | `0bed655995aea812b81d06c39076d880130d64edf053f40a6ef34fd854372c8a` | 2170 |

Machine artifactは`research/campaigns/rc1/artifacts/treatment/`に置いた。JSON file byteはreview用pretty encodingであり、表の
digest／bytesはparsed payloadのLattice canonical serializationを指す。

## Causal binding

- experiment base: `d2d412800492fbed03febe02abc6dca81c09a88b`
- executor implementation: `d2887f22fbb5f5c42cac797bf92927b47ab3ab4d`
- control compilation evidence digest: `30054f77c0673f610752bb352ab159b22524d0374ca271672b7422c55b928ba2`
- boundary manifest: `033481a45c95cef9a80caa38abefa7967d7aa42e6060e891e0f24b6470cbef72`
- boundary verdict: `a716d3bdd986730046a4b67a26172e4ddee4b02655822037c4672232077078fe`
- control plan: `2799806b65c2749d9da34855e59d6cc3eaea9d749344e42f8e90c98eb58903c1`
- query set: `c20c16da335826e1b5e692f6628cb83b6173ee30dd1ee60a1bf3b1d71dc69892`
- pre-transform code snapshot: `cbe59c4a21540fbe1b391b6c3c14e1c5f2228190ad19e32249a01c0241b539aa`

caller `baseRef` override、evidence headの不正SHA、control artifactとのdigest driftは隔離実行前にfail closedとなる。
accepted／rejected artifactのsource baseはすべてexperiment baseと一致した。

## Intervention and verification

- changed pathはallowed pathとexact一致する3件: `dispatch-channel.mjs`、`dispatch-label.mjs`、`dispatch-record.mjs`。
- raw patch: `research/campaigns/rc1/artifacts/treatment/seam.patch`、SHA-256
  `acefad450f77906d21e1712c710c1ed91e199d9607d7c6703e8378abeb1f92af`、2815 bytes。
- detached control-base worktreeで`git apply --check` passed。
- characterization: `node --test --test-reporter=dot test/research-dispatch-record.test.mjs`、exit 0。
- verifier receipt digest: `893cbf613d0b15a87c3d98638ec371a568dd204a0fe0f8eaf1a17e624d493e7d`。
- post-transform snapshot digest: `7ce1695afcab0a91949753b4085233b333ecd03d1f5fabf22b1d4db4ff8d5d36`。
- acceptedを2回実行し、artifactとraw patchがbyte-identical。実測は391.739 ms／280.538 ms。
- scope rejectionは65.065 ms、behavior rejectionは158.83 ms。両方とも返却patchは`null`。
- 各run後にcanonical HEAD／status／fixture contentと開始時のworktree集合が不変、cleanup passed。

## Gates

- focused: `node --test test/artifact-contracts.test.mjs test/isolation-runner.test.mjs test/seam-transform.test.mjs`
  → 19 pass / 0 fail / 0 skip。
- related: `node test/integration/seam-transform.integration.mjs`
  → accepted、scope rejection、behavior rejection、source不変、cleanup passed。control baseは`d2d4128…`。
- syntax: task対象7 source／test fileがpass。最後に変更した`test/seam-transform.test.mjs`も再確認してpass。
- full `npm run ci`: RC1-Gへ集約したため未実行。
- Codegraph post-index: 1.4.1、19 files、302 nodes、1191 edges、pending added／modified／removedは全0、
  pending refs 0、worktree mismatchなし。

shared-state negative controlを直接focused testへ追加し、normal control以外はseam executionへadmitされないことを確認した。

## Refutation and rework

最初のexploratory treatmentは`103c9677c36c9753bfc2974424f1ac2070ef7bba`をbaseにしていた。control観測baseとの不一致により
独立変数がseam patchだけにならないため、artifactを採用せず削除した。fixture digestの一致だけではCodegraph corpus driftを
排除できないという反証を受け、ADR 0011のsame-base bindingへ設計変更した。

machine evidence生成では、最初の呼出しがtool-side string interpolationで実行前に失敗し、次の呼出しは既存worktree数を1とした
誤った自己チェックでtransform前に停止した。既存3 worktreeは削除せず、最終実行は開始時／終了時のporcelain集合一致を検証した。
この手補正はartifact内容の再構成ではなく、最終runは正規`runRc1SeamTreatment`を4回実行して結果から直接生成している。

## Residual unknown and boundary

- canonical sourceの新規／削除ignored pathは検出するが、既存ignored fileのcontent-only mutationは現runnerのpath snapshotでは
  検出できない。RC1-Gの安全性評価へ明記して持ち越す。
- 単一fixtureから一般的な速度改善率、未知repoへの変換成功率は主張しない。
- RC1-Fのreindex／recompile／comparisonは未実施であり、本evidenceは閉ループ全体の成功を意味しない。
- dotagentsとObserver関連repoはread-onlyを維持し、remote作成、push、publishは実施していない。
