# RC2 transform Codegraph observability correction

- 記録日: 2026-07-16
- scope: Lattice only
- predecessor transform source SHA-256: `2aba4096dcb067a82a1aa0f579d329a4156a28da974cc4c2f5f60e5dc294a32d`
- corrected transform source SHA-256: `9a781aadb90d16b4318f43cafda8b03b0eb7249c9b3a6ebb612a79a7492eb720`
- characterization commit: `471cf81`
- correction commit: `586e5dd`

## Reproduction

RC2 campaign focused gateはprimary treatment compileで
`email-policy/composition-entry exact callee linkが観測されない`をfail-loudした。
accepted writerを一時cloneへ適用してfresh Codegraphを作ると、
`resolveDeliveryPolicy`のcalleeは`hasExactInputKeys`と`RESOLVERS`だけで、
`resolveEmailPolicy | resolvePushPolicy | resolveSmsPolicy`はdirect calleeに含まれなかった。
各resolver自身のexact query、dedicated testからresolverへのlink、composition testからentryへのlinkはreadyだった。

原因はCodegraphの空結果ではなく、transformが3 resolver呼出しを`RESOLVERS`定数内のarrowへ隠したことだった。
front-endのexact callee条件は緩めず、composition entry内の3 explicit branchからresolverを直接呼ぶよう訂正した。

## Codegraph boundary

source編集前に明示`codegraph sync .`を実行し、76 files、1953 nodes、7525 edges、pending changes 0を確認した。
`ENTRY_SOURCE`は`src/rc2-delivery-policy-transform.mjs`のexact constantで、callerは`WRITER_FILES`、calleeは0、
impactは`ENTRY_SOURCE -> WRITER_FILES -> applyRc2DeliveryPolicyTransform`だった。
`runRc2DeliveryPolicySeamTransform`のcallerはtransform test、RC2 campaign、`runTransforms`で、
`codegraph affected src/rc2-delivery-policy-transform.mjs`はtransform testとcampaign testを返した。

## Gates

- integration characterization before correction: 0 pass / 1 fail。唯一のfailureは
  `resolveEmailPolicy direct callee link`不在。
- integration focused after correction: 1 pass / 0 fail。fresh status complete、pending 0、coverage、
  entry／3 resolver exact query、3 direct calleeを実Codegraphで確認。
- transform focused after correction: 5 pass / 0 fail。deterministic 8-path writer、pre/post oracle、
  6x4 mutation matrix、typed rejection、source invariant、cleanupを維持。
- campaign focused after correction: callee validationを通過し、後続のartifact string boundでfail-loud。
  したがって本correctionのblockerは解消し、後続failureとは分離する。

旧transform implementation evidenceは当時のsource digestを記録するhistorical evidenceとして改変しない。
RC2 canonical campaignはcorrected source bytesから新しいadapter digest、patch digest、output snapshotを作る。

## Safety incident and recovery

初回診断でtemp cloneを作った後、transform関数へclone pathを渡さずcanonical Lattice cwdを渡したため、
exact allowlist 8 pathsが作業treeへ一時適用された。直ちに停止し、tracked 2 pathsをHEAD blobから
`apply_patch`で復元、生成されたuntracked 6 pathsを削除した。2 tracked pathは`git hash-object`と`HEAD:<path>`が一致し、
6 generated pathsは不存在、`git status`は着手前から存在した`src/rc2-campaign.mjs`と
`src/rc2-artifact-set.mjs`だけへ復帰した。その後Codegraphを明示syncした。

再診断ではtransform関数とCodegraphの両方へtemp cloneの絶対pathを明示した。
dotagents／Observer関連repoへのwrite、remote、push、publishは行っていない。
