# ADR 0025: RC1 v5のsnapshot固定oracle観測を受け入れる

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-O1
- predecessor: [ADR 0023](0023-rc1-v5-behavior-evidence-contract.md)、[ADR 0024](0024-rc1-v5-behavior-envelope-accepted.md)
- characterization commit: `e02a2630c26f168e7a23e1bea5b554d61a1a3c7e`
- source commit: `46cf93cdea04a92ae8decb8f38f65dd0167abe6a`
- evidence: [RC1 v5 full oracle receipt／surface observation受入証拠](../evidence/2026-07-15-rc1-v5-oracle-acceptance.md)

## Context

ADR 0023は、pre／post receiptを観測role、base SHA、oracle、entrypoint content、fixed surface、case resultsへ
bindするschemaを固定した。ADR 0024はさらに、pre surfaceをtransform source snapshot、post surfaceをtransform
output、両receiptをaccepted patchへcross-bindするcausal envelopeを受け入れた。

既存v4 oracle runnerはreceipt identityが不足するだけでなく、同じentrypoint URLをpre／postで再利用する。
temp Git repoでentrypointを変えず、そのdependencyだけを`before`から`after`へ変更したcharacterizationでは、
post callがcached module graphを再利用してpreと同じpassed receiptを返した。entrypoint content query parameterだけでは、
観測したbehaviorをdependency snapshotへ帰属できない。

## Decision

### 1. v4を変更せず、v5観測を別APIにする

既存`runRc1BlackBoxOracle`とreceipt v2は互換面として維持する。RC1 v5の正規観測入口を
`runRc1V5BlackBoxOracle({ repoRoot, oracle, role, baseSha, surfacePaths })`、typed rejectionを
`Rc1V5OracleRejection`とする。

### 2. 各観測をfresh module graphで実行する

pre／postを含む各v5観測はfresh Workerでoracle entrypointをloadする。同じprocessでentrypointだけをcache-bustする
方式をbehavior preservationの証拠に使わない。dependency-only changeもpost観測へ反映されなければならない。

### 3. caller入力と実Git baseを観測へ固定する

oracle descriptorとsurface path listは最初のasync境界前にcloneし、その後のcaller mutationから観測を隔離する。
`baseSha`は文字列として受け入れるだけでなく、観測前と観測後の両方で実repoの`HEAD^{commit}`と一致しなければならない。

### 4. fixed surfaceを実行前後でexact観測する

surfaceはsorted path集合として固定し、各pathの`present | absent`、content digestをcanonical preimageへ含める。
root外path、symlink ancestor／file、special file、oracle input／executorとのtransform scope重複はreceiptを作らず
typed rejectionにする。

oracle直前と直後のsurface digestが違えば`LATTICE_RC1_V5_SURFACE_DRIFT`としてfail closedにする。
surfaceがstableでbehaviorだけが違う場合は観測失敗へ丸めず、全case resultを持つvalidなfailed receiptを返す。

### 5. receipt identityをcausal envelopeへ接続可能にする

receipt v3のself-digestへrole、実base SHA、oracle digest、entrypoint／export、entrypoint content digest、
surface preimage／digest、observation、full case resultsを含める。preとpostが同じbehaviorでもroleまたはsurfaceが違えば
receipt identityは異なる。

RC1-Pはpre receiptのsurface digestをtransform artifactのsource `code_snapshot_digest`へ、post receiptのsurfaceを
exact output snapshotへbindする。O1単体のreceipt生成を、閉ループのbehavior preservation支持とは扱わない。

## Rejected alternatives

- **v4 receiptへfieldを追記する:** 既存artifact byte identityとcaller契約を暗黙に変え、v4 Phase rejectionの再現面を失う。
- **entrypoint URLだけをcache-bustする:** entrypointがimportするdependency module graphを刷新できない実反例がある。
- **callerが渡したbase SHAをそのまま記録する:** 別HEAD上の観測を再封印でき、snapshot帰属を立証できない。
- **oracle実行前だけsurfaceを読む:** 観測中のwriteをstable snapshotとして受け入れてしまう。
- **symlinkを通常fileとしてhashする:** repo外contentやpath置換をallowed surfaceへ混入できる。
- **behavior divergenceをexceptionにする:** 正しいpost観測による挙動変化と観測器の契約違反を識別できない。

## Consequences

- RC1-O1を完了とし、O1のfocused gate `8 pass / 0 fail / 0 skip`、affected 4 fileのrelated gate
  `20 pass / 0 fail / 0 skip`を受け入れる。
- RC1-Pは同一disposable worktree内でpre観測→transform→post観測の順序を固定し、O1 receiptとO2 envelopeを
  accepted transformへ接続する。cross-bind失敗時は再index／recompileへ進めない。
- v4 API、fixture、oracle input、transform、campaign、`artifacts/v4`は変更しない。
- 本DecisionはRC1-P／Q／Rの完了またはH1-v5支持を意味しない。
- Latticeだけをwriter scopeとし、dotagents／Observer関連repoはread-only、remote作成・push・publishは禁止を維持する。
