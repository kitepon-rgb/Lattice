# RC2 delivery policy transform source前Codegraph preflight

- 観測日: 2026-07-16
- 対象commit: `111e2d4`
- 対象Task: `RC2-F0-delivery-policy-transform-contract-preflight-v1`
- Decision: [ADR 0037](../adr/0037-rc2-delivery-policy-transform-transaction.md)

## Index identity

`codegraph sync .`は`Already up to date`を返した。直後のstatusは次のとおりである。

| field | value |
|---|---:|
| Codegraph | `1.4.1` |
| files | 71 |
| nodes | 1672 |
| edges | 6501 |
| pending changes | added 0／modified 0／removed 0 |
| worktree mismatch | `null` |
| index state／pending refs | `complete`／0 |
| reindex recommended | `false` |

## Planned source／test

| query | raw structural result | disposition |
|---|---|---|
| `query runRc2DeliveryPolicySeamTransform` | `[]` | planned runnerは未存在。bootstrap unknown |
| callers／callees／impact of planned runner | 全て`Symbol ... not found` | 0件ではなく未観測 |
| `query applyRc2DeliveryPolicyTransform` | `[]` | planned writerは未存在。bootstrap unknown |
| `query src/rc2-delivery-policy-transform.mjs` | `[]` | exact source path absent |
| affected planned source | tests 0／traversed 0 | source未存在なのでlinkage unknown。no affected testではない |
| `query test/rc2-delivery-policy-transform.test.mjs` | `[]` | planned characterization path absent |
| affected planned test | 同test一件／traversed 0 | self-targetだけでsource dependencyはまだ未接続 |

source追加後に明示syncし、2 exports、source path、caller／callee／impact、affected testを再観測するまでunknownを閉じない。

## Existing isolation boundary

`runIsolatedTransform`は`src/isolation-runner.mjs:260`のexact exported async functionへ解決した。

- direct callers: RC1 v4/v5 transform、legacy seam transform、RC1 v4/v5 fresh index、RC1 v6 behavior binding、2 test filesを含む14 nodes。
- direct callees: source capture、snapshot capture、verifier、snapshot不変、source不変を担う8 functions。
- impact depth 2: 22 nodes／38 edges。
- path-level affected tests: isolation runner、RC1 v4/v5 transform／campaign、v4 characterization、v6 campaign／compatibility、legacy seamの9件。

RC2 adapterはこのfunctionを呼ぶが、既存isolation runner自体は変更しない。したがってRC2-Fのfocused testでは新adapter testを走らせ、
既存9 affected testsのfull回帰はPhase gateへ集約する。isolation runnerを変更する場合だけこの判断を再度開く。

## Fixed oracleとfixture boundary

`runRc2DeliveryPolicyOracle`は`src/rc2-delivery-policy-oracle.mjs:88`へexact解決した。

- direct callerは既存fixture test file一件。
- direct calleesはentrypoint解決、fresh child process、receipt parse、expected digest、fixed case tableを含む7 nodes。
- impact depth 2はoracle＋fixture testの2 nodes／1 edge。
- path-level affected testは`test/rc2-delivery-policy-fixture.test.mjs`一件。

`resolveDeliveryPolicy`はmonolithic fixtureの`delivery-policy-registry.mjs:33`へexact解決し、impact／affectedはいずれも既存fixture testへ
接続した。shared fixture test path queryは同fileのexact nodeに加えfront-end test内の同名constantも返したため、file path／qualified name exact
candidateだけを採用する。

RC2 transformはoracle sourceをread-only fixed surfaceとして使い、fixtureとshared testをallowed path内で変更する。Codegraphはこの時点で
future shard、dedicated test、mutation sensitivity、behavior preservationを証明しない。

## Unknownとtest policy

未解消unknownは次である。

1. planned writer／runner／source／testが未存在で、post-source caller／callee／impact／affected relationを観測できない。
2. proposed 3 resolverと3 dedicated testのexact nodes／linksはtransform適用前なので存在しない。
3. Codegraphはfixed oracle byte identity、6-case test ownership、mutation後のexact restore、canonical repo cleanupを証明しない。

1はcharacterization／source追加後postflight、2は隔離treatmentのfresh index、3はsnapshot／oracle／mutation matrix／source invariantで閉じる。
空、absent、affected 0をindependenceへ丸めない。

- test: 未実行。source／test bytesを変更していないdocs-only Taskである。
- full CI: 未実行。RC2 Phase gateへ集約する。
- dotagents／Observer関連repo write、remote作成、push、publish: 0。
