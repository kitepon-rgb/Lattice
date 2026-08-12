# spr-01 構造 provenance 修復の完了証跡

## 対象

- plan/task: `structure-provenance-repair-20260812/spr-01`
- structure set digest: `1e86bc2e9701dc2e7e35710af0c0c126dadae7e1871c672914012550ff1c67c1`
- baseline: `a82c405e5d19fac95543a2e3faae14f81e3217f2`
- 実装 commit: `88e3ede69ad628e8010cb03d4eaee3ba15d9833b`

## 実施内容

pre-baseline の strict ancestor かつ現在 HEAD から到達可能な明示 commit を
`supplemental_changesets` として provenance に分離収集し、既存の
baseline..HEAD の `commit_order`・`changesets`・`summary` を不変に保った。
realization の保存、structure compile/finalize、overlay の変更把握まで補足
changesetを同じdigest束縛へ接続した。baseline自身、HEADから到達不能なcommit、
anchor非交差、他task claim済みの拒否は維持した。

変更ファイルは次の7件に限定した。

- `src/todo-cli.mjs`
- `src/todo-store.mjs`
- `src/todo-structure-authoritative-observation.mjs`
- `src/todo-structure-git-adapter.mjs`
- `src/todo-structure-overlay.mjs`
- `test/todo-structure-git-adapter.test.mjs`
- `test/todo-structure-realization.test.mjs`

## 検証

- `node --test test/todo-structure-git-adapter.test.mjs test/todo-structure-overlay.test.mjs`: 20件成功。
- `node --test test/todo-structure-realization.test.mjs`: 10件成功。
  専用worktreeに不足していた `node_modules` と `sensor/dist` は既存Lattice作業treeへの一時リンクで補い、検証後にリンクを除去した。製品ファイルとcompile生成物は変更していない。
- 変更production fileの `node --check`: 成功。
- `git diff --check`: 成功。

## Lattice証跡

`lattice todo structure realize --plan structure-provenance-repair-20260812 --task spr-01 --planned --commit 88e3ede69ad628e8010cb03d4eaee3ba15d9833b` が成功した。

- realization digest: `ad4e0bf194fe193ce906775610e9ee808b0b20f97045efeebe87b02b3e3988a4`
- result digest: `46bbcb5db7f2a8da81cf076ad3e18ff3dedc676b6bfe8a802de2ecb9dd9fea15`

compile時点から保全されている未追跡structure生成物と、todo start/realizeが更新したLattice storeは削除・巻戻ししていない。

## 実artifactへの束縛

以下は元のLattice生成物からbyte-for-byteで固定した、証跡commit内のimmutable snapshotである。
元の生成元pathも併記し、証跡commitの固定SHAだけでbytes・SHA-256・artifact内部の自己digestを再検証できるようにする。

| artifact | SHA-256 | 内部digest / 束縛 |
| --- | --- | --- |
| snapshot `evidence/structure-provenance-repair-20260812/artifacts/v1/structure/binding.json` (source `.lattice/todo/plans/structure-provenance-repair-20260812/v1/structure/binding.json`) | `06187bb5369cd598f432c528956c450c38d23359eacd773a3860995c5a1ba624` | `binding_digest=a7d0b13ad5fd97d7511d8cb34b4f7e57a0b9ff664719f28fbe03f78ce9b583e6`, `compile_artifact_digest=aec9994d3d554eb162d28a2eea1deae9f5398b9707cb339f5b5a7f6120350ae4` |
| snapshot `evidence/structure-provenance-repair-20260812/artifacts/v1/structure/compile.json` (source `.lattice/todo/plans/structure-provenance-repair-20260812/v1/structure/compile.json`) | `b90b0c9b207a685787d48c4497873711ec1ecd517a0fa7fc13a79ecc650b2411` | `artifact_digest=aec9994d3d554eb162d28a2eea1deae9f5398b9707cb339f5b5a7f6120350ae4`, `realization_head_digest=8fa9f30dd230910669d36f2c26b7d037eef41cb672678df4db5d91a689575db8` |
| snapshot `evidence/structure-provenance-repair-20260812/artifacts/v1/structure/realizations/spr-01.jsonl` (source `.lattice/todo/plans/structure-provenance-repair-20260812/v1/structure/realizations/spr-01.jsonl`) | `3a1074298cf98d39bade8336a31eeeb219ca8e11822ae2ffd9d30a935e5585e1` | `realization_digest=ad4e0bf194fe193ce906775610e9ee808b0b20f97045efeebe87b02b3e3988a4`, `commit_oids=[88e3ede69ad628e8010cb03d4eaee3ba15d9833b]` |

共通の構造束縛は `structure_set_digest=1e86bc2e9701dc2e7e35710af0c0c126dadae7e1871c672914012550ff1c67c1`、
`topology_digest=8d36a330031fb94bc609a98fb1b45039295caddcb5d8e00f5ce8a7db4cd567a2`、
baseline=`a82c405e5d19fac95543a2e3faae14f81e3217f2`、compile/current head=`98167ac2e4d242c4b994949ce0258cc918d5cf1a` で一致する。
realize receiptの `result_digest` は `46bbcb5db7f2a8da81cf076ad3e18ff3dedc676b6bfe8a802de2ecb9dd9fea15`。

## 拒否実測への束縛

固定実装SHAを親SHAへ戻した隔離treeで、同じfocused suiteを先行実行した負例を記録する。

- 親SHA `98167ac2e4d242c4b994949ce0258cc918d5cf1a` + adapter/overlay focused test: 19/20。pre-baselineの `supplemental_changesets` 欠落で `strict pre-baseline commit...` が失敗。
- 同じ親SHA + realization focused test: 9/10。正当なpre-baseline commitを `STRUCTURE_REALIZATION_COMMIT_UNREACHABLE` / `realization_commit_outside_baseline_range` で拒否。
- 固定実装SHA `88e3ede69ad628e8010cb03d4eaee3ba15d9833b` では adapter/overlay 20/20、realization 10/10。baseline自身、unreachable、anchor非交差、他task claimのtyped拒否と拒否時store不変を確認した。

この負例は「旧実装が新受入を落とす」ことを先に固定するための隔離read-only実測であり、証跡commitは製品コード・Lattice storeを変更しない。
