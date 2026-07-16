# RC2 canonical closed-loop campaign

- 記録日: 2026-07-16
- scope: RC2-G canonical execution／immutable artifact／new plan version
- base commit: `2e0cbe90b20baba38177ca1f95e11b0d9e8f0746`
- artifact root: `research/campaigns/rc2/artifacts/v1`
- artifact manifest SHA-256: `7152dfc3eefdc21d560ed4d8f5a25b644345538abdca0ddfda494cca07608ed6`
- hypothesis result digest: `4e9c7d3b076da1a041cac9b2ccd2a668bedac8de58ff7c86c2b80ddbf306ab2a`

## Execution identity and isolation

campaignはclean `HEAD === baseRef`を要求し、67 manifest payloadとmanifest自身の計68 files、約1.2 MiBをatomicに新規発行した。
Codegraphはversion `1.4.1`、executable digest
`2195336610e4d5a571767e066f4224d3f0f6f81bf7e34b3be18e45e87b699ef7`で、12 source identityを保存した。
execution identityのbefore／after digestはともに
`42b7a6b61611d62f176eb0ee615d9d9185fb84315cdf4c64761ad184ff771147`だった。

primary control 2、primary treatment 2、RC1 transfer control 1、treatment 1の計6 runは、それぞれ異なる
isolation instance digestを持ち、各runで`fresh_index: true`、oracle passed、source invariant passed、cleanup passedを保存した。
既存worktree countは各runの前後とも3で、新しいworktreeを残していない。primary query set digestは4 run共通、
RC1 transfer query set digestは2 run共通、全runのCodegraph identity digestも同一である。

primary control 2回のportable aggregate digestは
`baa5fa39cf97d6ed4709806b1f536f6e0cfda396bd7eaba87b13a4cb83539e76`、treatment 2回は
`aeebeccf4d35b08035d34995f12e283563cd7f825993bfec9b9e568c43514d12`へ各条件内で一致した。
control snapshot digestは`457f30c16e72e6404540e20bcd109b21c14f695aaf0b64be65227e73d4d3d54e`、
treatment snapshot digestは`9ffe40234d38cb7d1805586a72cbbee31eda21d806050950ae03649d8baeca2d`で異なり、
treatmentだけがaccepted patch digest
`164472242ac2d40896a891dafec07dd8e04f21502097edf3758b406483c70177`を持つ。

## Control／treatment result

| condition | conflict records | distinct pairs | minimum waves | independent verification |
| --- | ---: | ---: | ---: | --- |
| primary control | 12 | 3 | 3 | verified |
| primary treatment | 0 | 0 | 1 | verified |
| primary partial-state negative | 1 | 1 | 2 | verified |
| primary capacity 2 | 0 | 0 | 2 | verified |
| RC1 transfer control normal | 3 | 1 | 2 | verified |
| RC1 transfer treatment normal | 0 | 0 | 1 | verified |
| RC1 transfer control negative | 4 | 1 | 2 | verified |
| RC1 transfer treatment negative | 1 | 1 | 2 | verified |

third-only conditionは`BOUNDARY_UNKNOWN`を保ち、dispatchable planを発行していない。accepted registry-shard transformは8 path、
11,181 patch bytes、199 review linesで、pre／post fixed oracle 6 casesのdigestは一致した。6 mutation rows × 4 test cellsは
owner dedicated testだけが失敗するpartitionを示し、incomplete transformとscope violationはtyped rejectionかつoutput nullだった。

## Recompile and version barrier

新planは`rc2-delivery-policy-v1`をpredecessorとする`rc2-delivery-policy-v2`で、email／sms／pushの3 TODOを1 waveへ配置した。
plan digestは`716c65de072520b6cfe229345ff3d4e8be0d2a016a9b0439c0e73e3114b4a05d`、27 causal predecessorsを持つ。
plan diffはold plan、agent context、partial patch、monolithic interface assumption、control boundary evidenceの5 contextを失効した。
旧planへtreatment topologyを追記せず、affected TODO全体を新versionへ再compileしている。

RC1 v6 artifact／plan／patch、ADR 0031／0032／0037／0038の9 predecessor copyは、Lattice内sourceとのbyte比較が全件一致した。
RC1 artifactの上書きや再発行は行っていない。

## Verification and hypothesis

別processのdisk-only verifierは保存payloadだけから次の14 checksを全て再計算し、14 pass / 0 failだった。

`exact_artifact_set`、`identity_binding`、`transform_binding`、`fresh_run_binding`、`compiled_conditions`、
`minimum_verification`、`repeat_reproducibility`、`rc1_transfer_binding`、`predecessor_binding`、`version_barrier`、
`cost_arithmetic`、`comparison_recalculation`、`hypothesis_recalculation`、`execution_binding`。

hypothesis evaluationは9 conditions全てpassし、`supported: true`、failed conditions 0だった。campaign内のmeasured stageは50、
aggregate 43,200.066 ms、not measured 0、rejected attempts 2、retry 0、rollback 0である。

未検証範囲はartifact自身が列挙するactual multi-agent wall-clock improvement、保存算術を超えるelapsed attestation、
arbitrary-repository seam success rateであり、成功主張へ含めない。

## Boundary and audit

TODO完了候補の親監査ではmanifest集合、identity、6 runのfresh／cleanup receipt、repeat digest、control／treatment metrics、
typed unknown、transform rejection、predecessor byte identity、version barrier、disk-only 14 checksを実ファイルから再確認した。
Lattice以外のrepoは編集していない。dotagents／Observer関連repoはread-only、remote作成、push、publishは行っていない。
