# RC1 full CI harness isolation証拠

- 日付: 2026-07-16
- 対象plan: `lattice-research-campaign-1-v6` / RC1-T
- pre-change HEAD: `472fb91d6f3a658e47d0cea8a7224ac00bedad9f`
- predecessor evidence: [RC1 v5 Phase gate](2026-07-16-rc1-v5-phase-gate.md)

## Classificationとscope

F（Phase gateのresource ownership、immutable evidence、canonical source invariantに直結するtest契約）として親が直轄した。
変更は次のintegration test 3件だけで、製品source、fixture、v4／v5 artifactは変更していない。

- `test/integration/control-portability.integration.mjs`
- `test/integration/treatment-recompile.integration.mjs`
- `test/integration/rc1-v4-campaign.integration.mjs`

Latticeだけをwriter scopeとし、dotagents／Observer関連repoは編集していない。remote作成、push、publishは行っていない。

## Characterization

HEAD `88d0654`のfull `npm run ci`は`90 tests / 87 pass / 3 fail / 0 skip`だった。失敗後に3 scopeを直列で
一回ずつ実行し、control portabilityとtreatment recompileは単独green、v4 campaignだけはimmutable root既存在で単独redと確認した。

これにより、前2件は別testのtemporary worktreeをcanonical repo-global集合の増加として誤検出する並列所有権欠陥、後1件は
正規writerの上書き拒否に対してstale integrationがcanonical rootへ再発行する欠陥と識別した。製品挙動の変更は不要だった。

## Codegraph preflight

編集前indexはCodegraph 1.4.1、46 files、1,036 nodes、3,952 edges、pending 0、state completeだった。

- `control-portability.integration.mjs`: 13 symbols、indexed dependent 0。
  `compileInFreshWorktree`のcallerは同file、calleesはGit／Codegraph adapter／control compiler等、impact 2 nodes／1 edge。
- `treatment-recompile.integration.mjs`: 14 symbols、indexed dependent 0。
  `runRc1TreatmentRecompile`のcallerは同integrationとunit test、impact 3 nodes／4 edges。
- `rc1-v4-campaign.integration.mjs`: 5 symbols、indexed dependent 0。
  `writeRc1V4Artifacts`のcallerは同integrationとunit test、impact 3 nodes／4 edges。

3 changed fileに対する`codegraph affected`は`affectedTests: []`、traversed 0だった。しかしchanged file自身がtestであり、
repo-global Git side effectとNode test並列scheduleはgraph未表現であるためmanual unknownとして保持した。空結果を依存なしへ丸めていない。

## Correction

### control portability

canonical repoから`--no-hardlinks`の専用cloneを作り、そのcloneにだけ2つのdetached worktreeを直列作成するよう変更した。
厳密なHEAD、status、worktree集合の前後一致はcloneに対して維持した。canonical repoはHEAD／status不変だけを検証し、他testが
正当に所有するworktreeを本testのcleanup対象にしない。

### treatment recompile

元から専用clone内で実行していたため、cloneのHEAD、status、worktree集合の厳密一致は維持した。canonical repo全体のworktree
集合比較だけを除き、canonical HEAD／NUL-safe status不変を検査する。

### v4 campaign

canonical repoを専用cloneし、clean cloneでcampaignを実行した後、clone内のcommitted v4 artifact rootだけを削除してwriterを
実行する。生成23 payloadのbyte countとSHA-256をclone内で検証する。canonicalのimmutable v4 rootとsourceは読み取りも含め
clone元として扱うだけで、削除・上書きしない。

## Focused gate

3 integrationを同じ`node --test` invocationで並列実行した。

~~~text
node --test test/integration/control-portability.integration.mjs \
  test/integration/treatment-recompile.integration.mjs \
  test/integration/rc1-v4-campaign.integration.mjs
~~~

結果は`3 pass / 0 fail / 0 skip`、約17.19秒だった。

- control portable digest: `a8a3f762471ec685095395fde0d852e60070f6240a031a07667e5d9621aaa35d`
- treatment portable digest: `9d959e2ad40e4e027b0bb62921436d7b3a6e8139b982af976c7a38b1cac5b6f3`
- v4 campaign: 15 checks passed、23 artifact payloadを再発行・byte検証
- 実行後のcanonical worktreeは既存3件だけでtemporary leak 0

3 fileの`node --check`もgreenだった。full `npm run ci`はRC1-Yへ集約し、ここでは再実行していない。

## Post-index

Codegraph syncは3 modified file／69 nodesを処理し、46 files、1,050 nodes、3,984 edges、pending 0、state completeになった。
post-indexのsymbol数はcontrol portability 18、treatment recompile 14、v4 campaign 11で、indexed dependentは各0だった。
`compileInFreshWorktree`のimpactは2 nodes／1 edge、3 fileのaffected testは引き続き空だが、manual unknownは上記どおり保持する。

変更後SHA-256は次である。

- control portability: `50aad3261be3a72df19f65ff76071a39dc2719faec57e1cfd95efded2f47adaa`
- treatment recompile: `83cf86c5dedf0696246b0793a29fc380b9a80266411a97b2f7cbc418b4ca880e`
- v4 campaign: `7c6e12b63a5b6e283ba93879cc2ba68381d2665f4e73ad39fc732661c6ec6504`

## TODO軽量監査

RC1-Tの受入条件6件を一回監査し、専用clone ownership、immutable writer拒否の維持、canonical HEAD／status不変、
parallel focused green、Codegraph post-index、worktree cleanupを確認した。標準経路外の手補正、artifact byte編集、fallback、rollbackはない。
