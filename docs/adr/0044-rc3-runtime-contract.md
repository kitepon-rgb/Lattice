# ADR 0044: RC3 runtime閉ループの契約と所有境界を固定する

- Status: Accepted
- Date: 2026-07-16
- Scope: RC3-A contract Decision（plan `lattice-runtime-rc3-v1`の全Phaseが従うruntime契約）
- Predecessors: [ADR 0043](0043-rc2-v4-phase-gate-support.md)、[製品契約v0](../00_product-contract.md)
- Plan: [RC3 runtime vertical slice計画](../archive/plan_lattice_rc3_runtime_vertical_slice.md)
- Baseline evidence: [RC3 baseline](../evidence/2026-07-16-rc3-baseline.md)
- Superseded in part: Decision 2の`scope_violation`行（現`undeclared_write`）は
  [ADR 0144](0144-prediction-excess-is-not-a-conflict.md)が覆した。1者しか名指していない
  観測はfreezeへ運ばない。**以下の本文は当時の裁定のまま残す**——記録を後から書き換えない。

## Context

RC2はtest内campaignとして、manual witness→boundary graph→bounded exact schedule→隔離seam transform→fresh reindex→
全plan recompileの閉ループをsupportした（ADR 0043）。RC3はこのpipelineをversioned JSONとheadless CLIのruntimeへ出し、
複数executorの実行中diffを観測し、後発競合にaffected-only holdとcarry-overで応答し、plan vN+1へ再compileする。

本ADRは、RC3 source実装より先に、schema名と必須field、event契約、runtime意味論、CLI surface、所有境界、
RC2資産の再利用可否を不変Decisionとして固定する。本ADRの契約に反する実装はrejectし、契約自体の欠陥が
実装で再現した場合は本ADRを追記せず新しいADRで裁定する。

本ADR内のJSON例はnormativeなshape例であり、実測値ではない。`"<sha256:…>"`はSHA-256 hex 64桁を表す。

## Decision 1 — Claim boundary

1. schedulerはRC2と同じ1〜8 TODOの`exact_minimum` claimだけを受理する。producerと独立verifierの一致を必須とする。
2. 9 TODO以上はtyped `NODE_LIMIT_EXCEEDED`とし、feasible planもminimum planも発行しない。feasible-only modeは
   claim taxonomyの変更としてRC3に含めず、将来の新plan versionで扱う。
3. generic front-end／coreはfixture名、既知path、期待conflict、期待waveを入力にも分岐にも持たない。
4. runtime correctnessが主claimであり、wall-clock改善はH1-RC3のclaimにしない。
5. unknown（third-party semantics、dynamic dispatch、Codegraph空／fuzzy結果）を独立性へ丸めず、
   `unknown_requires_evidence`としてdispatch不可にする。

## Decision 2 — Versioned schema所有

RC3は次の10 schemaを新規に所有する。RC2公開済みschema（`lattice.boundary_verdict.v2`、`lattice.plan_graph.v2`、
RC2 artifact manifest系）は同名変更しない。全schemaはexact key、bounded collection、canonical serialization
（sorted key・LF・UTF-8のJSON）、SHA-256 digestを持ち、未知field、欠落field、不正path、過大入力をfail closedにする。

> **訂正（[ADR 0123](0123-runtime-contract-distribution-and-diagnosability.md)）**:
> `run_request.v1`の`codegraph_query_set`は[ADR 0047](0047-codegraph-absorption-and-sensor-ownership.md)の
> Codegraph吸収以後`sensor_query_set`である。`todos` entryは`todo_id`だけを受理し、`task_ref`と`scope`は
> `executor_packet.v1`だけが持つ。`run_request.v1`・`executor_packet.v1`・`executor_receipt.v1`の正本は
> 配布される`docs/schemas/*.schema.json`であり、以下の表ではない。

| schema | 必須field（top-level） |
|---|---|
| `lattice.run_request.v1` | `schema` `request_id` `repo`（`base_sha`・`root_kind`） `capacity` `todos` `manual_witness` `sensor_query_set` `executor_capability` `claim_mode` `request_digest` |
| `lattice.boundary_manifest.v2` | `schema` `todo_id` `owns` `reads` `writes` `resources` `state_effects` `unknowns` `affected_tests` `graph_evidence` `witness_provenance` `manifest_digest` |
| `lattice.runtime_plan.v1` | `schema` `plan_ref` `plan_epoch` `request_digest` `base_sha` `nodes` `precedence` `conflicts` `capacity` `manifest_digests` `claim` `predecessor_refs` `plan_digest` |
| `lattice.run_event.v1` | `schema` `run_id` `sequence` `previous_digest` `kind` `actor` `plan_epoch` `subject` `payload` `recorded_at` `event_digest` |
| `lattice.executor_packet.v1` | `schema` `packet_id` `todo_id` `task_ref` `scope` `base_sha` `plan_ref` `plan_epoch` `verifier_refs` `forbidden_operations` `context_content_digest` `packet_digest` |
| `lattice.executor_receipt.v1` | `schema` `receipt_id` `executor_handle` `worktree_id` `base_sha` `plan_epoch` `packet_digest` `todo_id` `checkpoint_digest` `observed_diff` `receipt_digest` |
| `lattice.hold_decision.v1` | `schema` `decision_id` `finding` `frozen_prefix_digest` `affected_closure` `hold_set` `continue_set` `evidence_digests` `decision_digest` |
| `lattice.carry_over_witness.v1` | `schema` `witness_id` `todo_id` `predecessor_epoch` `successor_epoch` `invariant_digests` `non_overlap_evidence` `receipt_bindings` `witness_digest` |
| `lattice.epoch_rebind_packet.v1` | `schema` `packet_id` `todo_id` `executor_handle` `worktree_id` `witness_digest` `context_content_digest` `authorized_checkpoint_digest` `old_plan_ref` `new_plan_ref` `new_plan_epoch` `packet_digest` |
| `lattice.runtime_plan_diff.v1` | `schema` `old_plan_ref` `new_plan_ref` `accepted_checkpoints` `invalidated_contexts` `carried_over` `redispatched` `node_edge_diff` `diff_digest` |

- `run_request.v1`の`request_digest`は`request_digest`自身を除くrequest全体のcanonical JSON SHA-256とする（RC2の
  `admission_digest`と同型の自己digest規則）。`runtime_plan.v1`は`request_digest`と`base_sha`を保持し、同一TODO集合を
  持つ別base／別requestへのplan再包装をtyped rejectする。
- `manual_witness`はTODOごとにowned symbol／path、declared read／write path、pathが表現するresource／state／
  external effect、Codegraph query provenance、affected tests、unknownを持つ。空・欠落を独立性へ丸めない。
- `boundary_manifest.v2`の`witness_provenance`は`codegraph | manual_candidate_spec | manual_state_effect`を
  resourceごとに区別する（RC2 provenance規律の継承）。graph evidenceはportable outcome projectionのdigestで
  bindし、raw telemetryを混入させない（製品契約v0の継承）。
- `executor_packet.v1`はdispatch時に発行する唯一のcontext packetであり、executorが受領したcontextの機械正本である。
  `executor_receipt.v1`の`packet_digest`は受領packetへの帰属を表し、これによりdispatch→受領→receiptの因果を
  保存bytesから再計算できる。
- field追加・意味変更はschema versionを上げ、新しいADRで裁定する。v1へのin-place拡張を禁止する。

## Decision 3 — Event store契約

1. event storeはrun単位のappend-only canonical event列とし、`sequence`は0起点の連番、`previous_digest`は直前eventの
   `event_digest`（先頭は`null`）とするdigest chainを持つ。gap、重複sequence、fork（同一sequenceの複数event）、
   digest不一致、未知kindをtyped rejectする。
2. event kindは次のclosed setとする。拡張は`run_event.v2`＋新ADRで行う。

   ```text
   run_initialized, plan_compiled, plan_verified, dispatch_decided,
   executor_dispatched, checkpoint_observed, receipt_recorded,
   conflict_found, intake_frozen, hold_decided, carry_over_witnessed,
   epoch_rebound, context_invalidated, plan_recompiled, intake_resumed,
   receipt_accepted, receipt_rejected, executor_terminal, run_closed
   ```

3. runtime stateは保存event prefixからのprojectionとしてのみ再構成する。可変summary、executor自己申告、
   in-memory stateを証拠にしない。全dispatch／hold／continue／invalidate裁定は、保存planと直前event prefixだけから
   producer非依存のverifierが再計算できなければならない。
4. 時刻（`recorded_at`）は診断情報であり、順序・受理判定の根拠にしない。順序judgementはすべてevent `sequence`で行う。
5. event payloadへcredential、token、cookie、prompt全文、無関係な会話を保存しない。redaction契約はRC3-Cで
   testとして固定する。executor受け渡しはopaque handleとboundedなtyped evidenceに限定する。
6. genesis event例:

   ```json
   { "schema": "lattice.run_event.v1", "run_id": "run-001", "sequence": 0,
     "previous_digest": null, "kind": "run_initialized",
     "actor": "lattice-runtime", "plan_epoch": 0,
     "subject": { "kind": "run_request", "ref": "request.json" },
     "payload": { "request_digest": "<sha256:…>" },
     "recorded_at": "2026-07-16T00:00:00.000Z", "event_digest": "<sha256:…>" }
   ```

## Decision 4 — minimum waveとready frontierの分離

compile時`minimum_feasible_waves`は構造metricであり、runtimeはこれを同期barrierとして実行しない。

- runtimeはevent（accept、terminal、hold、rebind）ごとに、未完了nodeのhard predecessor充足、現在running集合との
  conflict不在、実capacityを再評価し、条件を満たすready frontierからdispatchする。
- 各dispatchは`dispatch_decided` eventとして、その時点のrunning集合、hold集合、capacity、根拠digestを保存する。
- expected example: precedence `T1→T3`のみ、conflictなし、capacity 2、minimum waves 2のとき、T1がacceptedになった
  時点でT2がまだrunningでもT3をdispatchできる。T2完了を待つ実装は本契約違反としてrejectする
  （wave barrier偽装の検出はRC3-Bでexpected-red固定）。

## Decision 5 — path／resource bindingとconflict分類

1. git diff（isolated worktreeのcheckpoint diff）をwriteの一次sensor、Codegraphをsymbol／edge／impact／affected testの
   構造enrichmentとして使う。Codegraphの空結果、fuzzy解決、index lagを「依存なし」へ丸めない。
2. observed diffの各pathは、declared write path（exact／prefix）とmanual resource／state／effect witnessへcross-bindする。
   bindingの結果は次のclosed conflict分類を持つ。

   | kind | 条件 | 応答 |
   |---|---|---|
   | `observed_write_conflict` | running TODO間で同一path／generated artifactへのwrite overlap | affected closure hold |
   | `semantic_conflict_unknown` | 別pathだが同一resource／state／invariant witnessへ到達 | evidence acquisitionまたはhold |
   | `effect_conflict_unknown` | 同一external effect／H surface witnessへ到達 | evidence acquisitionまたはhold |
   | `scope_violation` | declared write scope外へのwrite | offender＋affected closure hold |
   | `stale_context` | active plan epoch・packet帰属と不一致なdispatch／receipt | typed reject |

3. expected example: T1が`src/a.mjs`（declared）と`src/c.mjs`（undeclared）を変更した場合、`src/c.mjs`は
   `scope_violation`。`src/c.mjs`がT2のdeclared writeなら同時に`observed_write_conflict`をT1×T2へ記録し、
   両findingを別eventとして保存する。silent mergeしない。

## Decision 6 — intake freezeとaffected closure

1. conflict発見時、runtimeは`intake_frozen` eventで観測済みevent prefix（`frozen_prefix_digest`）を固定し、
   そのprefixだけからaffected closureを計算する。
2. freeze中の後着eventは取りこぼさず順序付きでqueueし、`intake_resumed` eventでqueued件数とともに次のprefixへ
   編入する。freeze中eventをclosure計算へ遡って混入させない。
3. affected closureはfinding起点に、conflict edge、hard predecessor依存（下流）、同一resource witnessの
   到達集合として計算し、`hold_decision.v1`へfinding、hold集合、continue集合、根拠event digestを保存する。
4. 無関係TODO（closure外）の継続は無条件ではなく、Decision 7のcarry-over witnessを必須とする。

## Decision 7 — 全plan失効とcarry-overの両立（epoch rebind）

「affected-only hold」と「全plan version barrier」は次の規則で同時に成立する。**plan・context・epochは全TODOで
一斉に失効し、例外なくvN+1へ移る。継続できるのはTODOの実行状態だけであり、それも内容同一性と非交差を
保存bytesから再証明できた場合に、新epochへの再認可（epoch rebind）として行う。**

### 7.1 context content digest

`context_content_digest`は、executor packetからplan帰属field（`packet_id` `plan_ref` `plan_epoch` `packet_digest`）を
除いたcontent projection（`todo_id` `task_ref` `scope` `base_sha` `verifier_refs` `forbidden_operations`）の
canonical JSON SHA-256とする。plan epoch／refはpacket全体digest（`packet_digest`）にだけ入る。これにより
「rebindはcontent不変・epochだけ更新」をdigestで機械検査でき、content digestへepochが混入して全TODOが
carry-over不能になる誤実装と、epochを無視してstale packetを同一視する誤実装の両方をrejectできる。

### 7.2 carry-over witness

carry-over witnessは少なくとも次を保存bytesから再証明する。一件でも証明不能なら当該TODOもholdし、
新contextでredispatchする（fail closed、`hold_decision.v1`へ理由を残す）。

- TODO input、boundary manifest、validator、executor packetの`context_content_digest`の不変（`invariant_digests`）。
- accepted checkpoint／seam transformのchanged scopeと当該TODOのdeclared read／write／state／effectの非交差。
- hard predecessor、conflict、capacity、affected test契約の新plan同値。
- 当該TODOの全recorded receiptがdispatch記録（executor handle、worktree、base、packet digest）へ帰属すること。
- frozen prefix内に当該TODOの未処理conflict findingがなく、frozen prefix外に当該TODOの
  `checkpoint_observed`／`receipt_recorded` eventが存在しないこと（event sequenceで判定）。

### 7.3 epoch rebind packet

carried-over TODOへは`epoch_rebind_packet.v1`を発行する。`context_content_digest`は不変のまま、
`new_plan_ref`／`new_plan_epoch`だけを更新し、対象executorの`executor_handle`／`worktree_id`と、
frozen prefix内で非交差を証明した最終checkpoint（`authorized_checkpoint_digest`）へbindする。
rebindは`epoch_rebound` eventとして保存する。redispatch TODOには通常の新`executor_packet.v1`を発行し、
rebind packetと混用しない。

### 7.4 receipt受理規則（帰属はevent順序で判定する）

- receiptは`executor_handle` `worktree_id` `base_sha` `plan_epoch` `packet_digest` `checkpoint_digest`のbindingを
  必須とし、欠落をtyped rejectする。帰属照合の基準は当該TODOのdispatch記録（`executor_dispatched`／
  `epoch_rebound` eventが保存したhandle・worktree・packet digest）であり、executor自己申告ではない。
- 「rebind前」「rebind後」は生成時刻でなくevent storeの`sequence`で判定する。vN epoch receiptを受理できるのは、
  その`receipt_recorded`（または対応する`checkpoint_observed`）がfrozen prefix内にあり、carry-over witnessの
  `receipt_bindings`が当該checkpointをbindする場合だけである。
- frozen prefix外（freeze後着・rebind後着を含む）のvN epoch receiptは、到着順・生成主張によらず`stale_context`で
  rejectし、accepted outputを0件とする。
- `epoch_rebound`以後、carried-over TODOのreceiptは`new_plan_epoch`とrebind packetの`packet_digest`を必須とし、
  checkpoint lineageが`authorized_checkpoint_digest`から連続することを要求する。lineage不連続はtyped rejectとして
  affected closureをholdへ戻す。

### 7.5 expected examples

```json
{ "case": "carry-over-accept",
  "given": "T3はvN(epoch 1)でrunning。T1×T2のlate conflictでintake_frozen(seq 41)。",
  "witness": { "todo_id": "T3", "predecessor_epoch": 1, "successor_epoch": 2,
    "invariant_digests": { "todo_input": "<sha256:…>", "boundary_manifest": "<sha256:…>",
      "validator": "<sha256:…>", "context_content": "<sha256:…>" },
    "non_overlap_evidence": ["hold_decision#seq44", "checkpoint_diff#T3-c2"],
    "receipt_bindings": [{ "receipt_id": "T3-r1", "checkpoint_digest": "<sha256:…>",
      "recorded_sequence": 38, "within_frozen_prefix": true }] },
  "rebind": { "todo_id": "T3", "executor_handle": "scripted-exec-3", "worktree_id": "wt-t3",
    "authorized_checkpoint_digest": "<sha256:…>", "new_plan_epoch": 2 },
  "then": "epoch_rebound(seq 47)後、T3はepoch 2で継続。T3-r1(seq 38)はwitness binding経由で受理。" }
```

```json
{ "case": "witness-single-field-corruption",
  "given": "上と同一。ただしwitnessのinvariant_digests.validatorが保存bytesの再計算と不一致。",
  "then": "carry-over不成立。T3をhold_setへ移し、hold_decision.v1へ理由kind
           carry_over_unprovableを記録。新contextでredispatchする。" }
```

```json
{ "case": "post-freeze-stale-receipt",
  "given": "T3がepoch 1のreceipt T3-r2を提出し、そのrecorded_sequenceがfrozen prefix外(seq 49)。",
  "then": "witness bindingの有無によらずstale_contextとしてtyped reject。
           receipt_rejected eventを保存し、accepted outputへ数えない。" }
```

```json
{ "case": "post-rebind-lineage-break",
  "given": "rebind後、T3がepoch 2 receiptを提出したが、checkpoint lineageが
            authorized_checkpoint_digestから連続しない。",
  "then": "typed rejectし、T3をaffected closureとしてholdへ戻す。" }
```

### 7.6 seamとserial

切断可能な競合はpredeclared seam treatment contractへ、切断不能な競合はintentional serialへ送る。
intentional serialはunordered conflictのまま保持し、precedence edgeへ偽装しない。

## Decision 8 — CLI surface

`bin/lattice.mjs`へ次を加算実装する。既存`--version`／`doctor --json`の挙動を変更しない。

```text
lattice plan compile --request <run-request.json>
lattice plan verify  --request <run-request.json> --plan <plan.json>
lattice run start    --request <run-request.json> --executor <adapter>
lattice run observe  --run <run-directory>
lattice run status   --run <run-directory>
lattice event verify --run <run-directory>
```

- stdout: versioned JSONのみ。成功時もsummary booleanでなくartifact refとdigestを返す。診断・進捗はstderr。
- exit contract: 0=成功、1=typed契約失敗（stderrへtyped error JSON 1行）、2=usage違反（未知command／引数）。
- unknown field、欠落field、不正path、過大入力、stale epochはfail closed。
- `--executor`省略時の暗黙provider fallbackを持たない。CLIはprovider sessionを所有せず、adapterのopaque handleだけを保存する。
- exact argument contract（引数の重複・余剰の拒否を含む）はRC3-Bのcharacterizationで固定する。

## Decision 9 — executor adapter境界

1. adapter interfaceはprovider非依存とし、dispatch、observe、checkpoint、hold request、terminal reportの
   状態遷移だけを契約する。決定論的scripted executorがprimary実験の実行体である。
2. 全executorはdisposable isolated worktreeだけへ書く。canonical worktreeへの直接write、commit、push、
   branch切替、merge、rebase、reset、stash、他者変更revertを禁止する。
3. dispatchは必ず`executor_packet.v1`を伴い、receiptはpacket digestへ帰属する（Decision 7.4）。
4. provider固有handleはopaqueに保存し、timeoutは`unknown`として同一handleで回収する。同一taskの重複dispatchを
   拒否する。process exitだけでterminal成否を判断しない。
5. actual multi-agent dogfood（RC3-I）はH gate（オーナー承認）とControl予算の下でだけ行い、targetは
   Lattice-owned disposable dogfood fixture repoとする。Lattice自身・dotagents・Observerをdogfood writer targetにしない。

## Decision 10 — event／artifact rootの所有境界

1. run event store・executor packet／receipt・state projectionは`research/runs/rc3/<run-id>/`へ置く（Lattice所有）。
2. immutable campaign artifactは`research/campaigns/rc3/artifacts/<version>/`へatomic no-overwriteで発行する
   （RC2 artifact規律の継承）。RC2 canonical artifact v1〜v4へは追記も変更もしない。
3. 両rootはtarget repoのCodegraph coverageとsource snapshot identityへ混入させない。具体的には:
   - RC3-Bで`codegraph.json`のtracked exclusionへ`research/runs/`を加え、`codegraph files`照合の
     integration testを先行させる。`codegraph.json`のbytesは既存契約どおりexecution identityへbindする（ADR 0040）。
   - RC3 campaign artifact内のsource・patch・executable・fixture bytesを含むpayloadは、既存exclusion glob
     `research/campaigns/**/artifacts/**/identity/`が覆う`identity/`配下だけへ保存する。identity外へは
     canonical JSON（digest・metric・receipt）だけを置く。この規則自体をcoverage testで固定し、
     JSON非index挙動への暗黙依存を残さない。
4. run identityとplan identityへはportable outcome projectionのcanonical digestだけを入れ、absolute path、
   index時刻、DB byte sizeを混入させない（製品契約v0の継承）。
5. 新規runtime production moduleは`npm run check`の列挙へ漏れなく加える（成功条件28。列挙漏れは既知の罠）。

## Decision 11 — RC2 fixture／adapter再利用の裁定

実コード（`src/rc2-delivery-policy-transform.mjs`、`src/rc2-delivery-policy-oracle.mjs`、`src/isolation-runner.mjs`、
`research/fixtures/delivery-policy-registry/`、`test/rc2-delivery-policy-fixture.test.mjs`）を読んだ上で、
**無改変での条件付き再利用（加算bind）** と裁定する。

確認した事実:

- `runRc2DeliveryPolicyOracle({repoRoot})`はrepoRootパラメタ化済みで、entrypointを固定相対path
  `research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs`として解決する。
- `runIsolatedTransform({repoRoot, baseRef, allowedPaths, …})`は汎用で、protected fingerprint対象は
  当該repoの`src`／`test`である。
- `runRc2DeliveryPolicySeamTransform({repoRoot, baseRef, candidateSpec})`はrepoRootパラメタ化済みだが
  layout束縛を持つ。pre-transform surface検査（`SURFACE_PATHS`×`CURRENT_PATHS`）は、fixture entry・
  shared test（`test/rc2-delivery-policy-fixture.test.mjs`）・oracle（`src/rc2-delivery-policy-oracle.mjs`、
  bytesがaccepted candidateの`fixed_oracle.source_digest`＝`c68a7ff9…`と一致必須）の3 pathの存在と、
  残る6 transform path（3 policy module＋3 dedicated test）の不在を要求する。transformは8 pathを書き、
  うちfixture entryとshared testは書換え、6 pathは新規作成である。
- shared testのimportは全て相対pathで、Lattice絶対pathへの依存はない。
- transform artifactは`source.adapter`を`{ path: 'src/rc2-delivery-policy-transform.mjs', digest: <実行中moduleの
  bytes digest> }`として保存する。adapter bytesは実行側（Lattice）のmoduleから計算される。

裁定:

1. RC3 dogfood disposable repoは、fixture entry・oracle・shared testの3点をbyte-identicalに同一相対pathへ
   複製したgit init済みclean treeとして、RC3-Dで新規実装するscaffold（RC3-owned builder、tmpdir配下、
   Latticeのworktreeにしない）で作る。この複製上でRC2 oracle／isolation-runner／transform adapterを無改変で使う。
2. transform artifactのprovenanceは2つのnamespaceへ明示分離する。`source.adapter`（および実行runner）は
   **Lattice source base commit**へ束縛されたLattice-repo相対pathとして解釈・検証し、fixture entry・oracle・
   shared test・changed pathsは**target disposable repoのbase**へ束縛する。RC3 campaign artifactは両namespaceの
   base commitを別fieldで保存し、target repo内に存在しないadapter pathをtarget相対として検証する誤りと、
   検証を省略して別rootのbytesを同一視する誤りの両方をrejectする。RC2 adapterは無改変のまま、この解釈を
   RC3 campaign artifact側の契約として固定する。
3. accepted seam条件（campaign第7条件）のpredeclared treatmentは、RC2 accepted candidate witness
   （epoch `delivery-policy-semantic-v2`、candidate digest `4cc5d7bb…`、oracle source digest `c68a7ff9…`）と
   無改変adapterで実行する。digest bindingがscaffold上で不成立なら、それはtyped rejectionであり、
   accepted seam条件を黙って削る理由にしない。bind不能が契約として再現する場合はRC3-owned
   fixture／oracle／predeclared treatmentを加算設計し、本ADRを追記せず新Decisionで裁定する。
4. RC2 fixtureだけでは満たせない次はRC3-ownedとして加算する（RC2資産の変更0）。
   - 第二のfixture topology（成功条件4の2-topology要件）とそのoracle。
   - seamを持たないirreducible shared-state要素（intentional serial条件用）。
   - 8 campaign条件のTODO集合、manual witness、注入script、正解affected／hold／continue集合。
5. RC1／RC2のsource module、test、canonical artifactへの変更は0とする。RC3 fixture追加は
   `research/fixtures/`配下の新規directoryだけで行う。

## Rejected alternatives

- **waveを同期barrierとして実行する**: 独立TODOを最遅TODOへ直列化し、H0-dを自ら成立させる。
- **affected TODOだけ失効し、planを部分的に生かす**: version barrierが崩れ、stale contextの受理経路を作る。
  全失効＋rebind再認可だけが両立を説明する。
- **carry-overを旧context packetの継続利用として実装する**: 内容同一でもepoch境界の帰属が曖昧になり、
  rebind前後のreceipt規則を機械検査できない。
- **receipt受理を生成時刻・到着時刻で判定する**: 生成時刻はexecutor自己申告でありbytesから検証できない。
  event sequenceだけが判定基準である（Decision 7.4）。
- **context digestへplan epochを含める**: rebindで必ずdigestが変わり、全carry-overが機械的に不成立になる。
  content projectionの分離（Decision 7.1）が正しい。
- **event storeをmutable summary＋随時再構築にする**: 裁定の再計算可能性（成功条件21）を失う。
- **RC2 transform adapterをdogfood用に改造する**: RC2 canonical witnessとのdigest bindingを壊し、
  accepted seam条件の証拠力を失う。複製scaffoldへの無改変bindが正しい。
- **event kindをopen setにする**: 未知kind拒否（成功条件22）と矛盾する。拡張はversionとDecisionで行う。

## 反証記録

本ADR草案は受入前に、異provider read-only refuter（codex-sidecar `opinion`、`gpt-5.6-sol`×high、
Control worker run `RC3-A-adr-refutation-run-01-v1`、実行ログdigest `3cadf1d2f4e62fce5fa4280de1edec2859c6a1b1ad6a60af84d3794ace589784`）で
一回反証した。refuterは8件のP1 objection（rebindの原子的帰属境界の欠落、executor packet schemaの欠落、
context digest不変条件の自己矛盾、receipt順序predicateの判定不能、request／plan binding不足、
pre-transform surface記述の実コードとの矛盾、adapter provenance namespaceの未分離、RC3 artifact rootの
exclusion不足）を返し、親が全件を実コード・契約bytesと突き合わせて実在・価値ありと裁定し、受入前の
本版へ反映した（Decision 2・3.4・7.1〜7.5・10.3・11.2に対応）。棄却したfindingは0件。scope縮小を要求する
findingは0件だった。親Fable（統括自身）による自己相談は独立反証に数えていない。

## Consequences

- RC3-B以降の全実装は本ADRのschema名・必須field・意味論・所有境界に従う。実装中に契約欠陥が再現した場合は
  本ADRを追記せず、新しいADRとcorrection versionで裁定する。
- 本ADRはactual multi-agent dogfoodの成功、任意repo一般化、9 TODO以上のscheduler、自動ownership／seam発見を
  何もsupportしない。それらの裁定はRC3-J以降のPhase gate Decisionが行う。
- dotagents／Observerへの導入配線、remote作成、push、publishは本Decisionの効果に含めない。
