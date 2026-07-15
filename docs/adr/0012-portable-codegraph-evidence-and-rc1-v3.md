# ADR 0012: Codegraph evidenceをportable projectionへbindしRC1をv3へ再compileする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v3`
- supersedes as active predecessor: RC1-D／Eのvolatile graph digest artifact
- depends on: ADR 0002、ADR 0009、ADR 0011

## Context

RC1-Fの着手前probeで、同じcontrol base、同じaccepted patch、同じquery setを別々のdisposable worktreeへ適用し、
Codegraph 1.4.1を2回fresh indexした。構造countとtyped outcomeは一致したが、raw outcome集合のdigestは
`b1d0ea49…`と`27aecccd…`で不一致になった。一方、環境依存telemetryを除いたprojection digestは両方とも
`9d959e2a…`で一致した。machine evidence digestは`a10540b2de6169cd695fea2acb10294fa3cae9b5a454f6f36cd3a69305f264a9`である。

差分はstatusの`projectPath`、`indexPath`、`lastIndexed`、`dbSizeBytes`と、query／resolution nodeの`updatedAt`だった。
現`graph_evidence.result_digest`はraw outcome全体をhashするため、同じcode／queryからartifactをbyte-identicalに再生成できない。
これはplan成功条件6への実験反証であり、Fだけをportableにしてcontrolと異なるdigest意味を混在させることもできない。

Codegraph 1.4.1の一次仕様では`CODEGRAPH_DIR`はproject root直下の単一directory nameに限定され、project外へindexを
置けない。`.codegraph-*` siblingはindex／watch対象から除外される。したがってtreatment worktree内のCodegraph DBを
source patchと同一snapshotとして禁止するのでなく、明示したdisposable sensor stateとして分離する必要がある。

## Decision

### Portable graph outcome

`lattice.codegraph_portable_outcome.v1`をCodegraph raw outcomeから作るdigest projectionとして定義する。

- `status.data`から`projectPath`、`indexPath`、`lastIndexed`、`dbSizeBytes`だけを除く。
- query dataとexact resolutionを含む全nested Codegraph nodeから`updatedAt`だけを除く。
- outcome、operation、target、symbol identity、relative file path、line／column、signature、score、caller／callee、impact、
  affected test、index version／state／counts／pending／mismatchは保持する。
- 上記以外の未知fieldは暗黙に捨てない。新しいvolatile fieldが現れ再生成digestを変えた場合はdeterminism gateでfailさせ、
  projection versionを明示更新する。

`lattice.boundary_manifest.v1.graph_evidence[].result_digest`はこのportable projectionのcanonical SHA-256を指す。
raw telemetryは診断用execution evidenceとして保持できるが、portable artifact digestへ混ぜず、絶対pathをcommitしない。

### RC1 predecessor correction

- 既存`artifacts/control/`と`artifacts/treatment/`は歴史証拠として保持し、同じpathで上書きしない。
- portable projectionで`artifacts/control-v2/`を再compileし、そのdigest chainから`artifacts/treatment-v2/`を再発行する。
- 旧D／E taskの実装完了は取り消さないが、旧artifactはRC1-Fのactive predecessor資格を失う。
- active plan topologyへ追記せず、v2をbyte-for-byte archiveして`lattice-research-campaign-1-v3`へ全affected TODOを再compileする。
- v3はRC1-D2（portable control correction）→RC1-E2（transform chain再発行）→RC1-Fのhard dependencyを持つ。

### Treatment index state

RC1-Fはcontrol baseのdetached worktreeへaccepted patchを適用し、固定名`.codegraph-rc1-treatment`を
`CODEGRAPH_DIR`に設定してfresh indexする。`CODEGRAPH_NO_DAEMON=1`、`CODEGRAPH_NO_WATCH=1`、
`CODEGRAPH_NO_UPDATE_CHECK=1`、`DO_NOT_TRACK=1`を固定する。

sensor stateはsource diff／transform snapshotへ含めないが、存在場所、Codegraph version、status、cleanupをreceiptへbindする。
source changed pathはaccepted 3 pathとexact一致し、index前後でpatch bytesが不変でなければrejectする。

## Rejected alternatives

- **raw outcome digestを維持する:** 同じ入力の再実行でartifact digestが変わる実験反証に反する。
- **temp pathを固定する:** index時刻とnode `updatedAt`が残り、並行runも衝突する。
- **全path／timestamp fieldを再帰的に捨てる:** relative source pathや将来fieldまで黙って失い、構造差分を隠す。
- **Fだけportable digestにする:** control／treatmentで`result_digest`の意味が異なる。
- **旧artifact fileを上書きする:** 過去の受入証拠とrefutation chainを破壊する。
- **Codegraph DBをsource patchとして許可する:** scheduler入力とsensor cacheの責務が混ざり、patch scopeを偽る。

## Consequences

- D2／E2のdownstream digestは旧D／Eから変わり、旧transform artifactは新control artifactのpredecessorにならない。
- raw evidenceとportable artifactを分離する追加実装・test・再生成costを負う。
- 2 worktree fresh-indexでraw不一致／portable一致を必須related gateにする。
- Fはsource patch、sensor state、compiled artifactを別receiptとしてcleanupできる。
- Codegraph、dotagents、Observer関連repoのwriter境界は変更しない。
