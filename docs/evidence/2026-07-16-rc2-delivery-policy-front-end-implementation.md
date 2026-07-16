# RC2 delivery policy boundary front-end実装

- 日付: 2026-07-16
- Control: `lattice-rc2-bounded-graph-v1` revisions 73〜74
- Task: `RC2-E6-delivery-policy-front-end-implementation-v1`
- characterization commit: `6e8994bc6632d5e5cc7b66d2d12ae5c4df2b0b4d`
- Codegraph preflight commit: `757675e`
- source commit: `504d0c63677f819f87106fc7043fe1475fa1a9c6`
- source commit tree: `31b1f358c0cc6ed99ca111f8cb564a12c1bc3bac`
- governing Decision: [ADR 0036](../adr/0036-rc2-delivery-policy-witness-and-test-seam.md)

## Implemented boundary

`src/rc2-delivery-policy-front-end.mjs`は次のexact API一件だけを公開する。

```text
compileDeliveryPolicyBoundaryBundleV2({
  planInput,
  candidateSpec,
  manualEvidence,
  querySet,
  sourceSnapshot,
  codegraphEvidence,
}) -> normalized_boundary_bundle.v2
```

front-endはplan、verdict、condition、mode、保存済みconflict、期待wave数を受け取らず、返さない。入力から次を検査して
`compileBoundaryObservationV2`へprovenance付きobservation setだけを渡す。

- accepted candidate digest、plan anchor／outcome、candidate／plan／manualのTODO集合、6 oracle caseのexact partition。
- candidate内の全query referenceとquery setのexact／exhaustive一致、operation／target binding。
- 9 path source snapshotのexact current／proposed topologyと、両topologyで不変なfixed oracle source digest。
- portable outcomeのquery-set digest、各outcome digest、full aggregate preimage、fresh Codegraph status、snapshot-bound affected結果。
- exact symbol／path解決。fuzzy nameまたはfuzzy pathはreadyへ昇格しない。
- proposed topologyではcomposition entryから3 resolver、各dedicated testからowner resolver、composition testからentryへの
  exact callee link。
- structural resourceの`codegraph`と`manual_candidate_spec` provenance、state／effect／dynamic resourceの
  `manual_state_effect` provenance。Codegraph側のresource digestはmode判定に使用したquery／impact／link outcomesを結合する。

source SHA-256:

```text
b863d08b097a77d82dbd998f08b852c7b2f38bf527dc8eb8ee9a0bc1cbbd71f3  src/rc2-delivery-policy-front-end.mjs
```

## Characterization result

同じfront-endとgeneric schedulerを使ったfocused testの結果は次のとおりである。

| observation | resources | conflict records | distinct pairs | minimum waves |
|---|---:|---:|---:|---:|
| current control | 4 | 12 | 3 | 3 |
| proposed treatment | 12 | 0 | 0 | 1 |
| proposed partial-state negative | 13 | 1 | 1 | 2 |
| proposed capacity 2 | 12 | 0 | 0 | 2 |

third-only dynamic unknownは`BOUNDARY_UNKNOWN`でplanを返さなかった。candidate oracle digest、query-set reference、manual TODO集合、
portable per-query digest、snapshot oracle digest、fuzzy exact-name/pathの6種を一件ずつ壊した入力はすべてfail-loudになった。
これらはsynthetic portable preimageを使うfront-end characterizationであり、RC2-Gのprimary fresh runまたはbehavior-preserving transform
acceptanceを先取りしていない。

## Codegraph postflight

source追加後に`codegraph sync .`を明示実行し、1 file／49 nodesを追加した。同じsource bytesのsource commit後にもstatusを再確認した。

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

- exportはrequested nameと`src/rc2-delivery-policy-front-end.mjs:1020`へexact一致し、export済み。
- source path queryは同pathのexact file nodeを先頭に返した。test内の`FRONT_END` fuzzy candidateをexact file nodeと混同していない。
- direct callerは`test/rc2-delivery-policy-front-end.test.mjs:224`の`invoke`一件。
- direct calleeは既存`validatePlanInput`、`digestArtifact`、`compileBoundaryObservationV2`を含む14 functions＋1 constant。
- impact depth 2はexport、caller、test fileの3 nodes／2 edges。
- affected testは`test/rc2-delivery-policy-front-end.test.mjs`一件、traversed 1。
- planned source不在に由来したexport／path／caller／callee／impact／affectedのbootstrap unknownは閉じた。

Codegraph単独ではcandidateのsemantic ownership、oracle byte identity、後続transformのbehavior preservationを証明しない。このunknownは
snapshot／digest bindingを加えた上で、RC2-Fの隔離oracle／mutation matrixとRC2-Gのfresh repeated runへ保持する。

## Verification and scope

```text
node --check src/rc2-delivery-policy-front-end.mjs: pass
git diff --cached --check -- src/rc2-delivery-policy-front-end.mjs: pass
node --test --test-reporter=spec test/rc2-delivery-policy-front-end.test.mjs:
  14 pass / 0 fail / 0 skip
```

- `focused`: 14 pass／0 fail／0 skip。正常4条件、typed unknown、query exact/exhaustive、6 corruption rejection、注入field禁止を含む。
- `related`: Codegraph affected testはfocusedと同じ一件なので上記greenを再利用した。
- `full`: 未実行。RC2 source収束後のPhase gateへ集約する。
- Control finalizationの初回は存在しないcommand alias `task-finalize`を指定して`INVALID_INPUT`になり、revisionは73のまま
  変化しなかった。正規command `task-finalize-record`へ同じtask IDを渡し、revision 74でfinalizeした。
- source commitの変更は新規front-end一件だけ。既存generic core、candidate、test、RC1 artifactは変更していない。
- dotagents／Observer関連repo write、remote作成、push、publish: 0。
