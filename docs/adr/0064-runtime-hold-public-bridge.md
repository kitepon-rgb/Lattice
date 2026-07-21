# ADR 0064: managed runtimeで競合holdとmulti-epoch再compileを公開する

- Status: Accepted
- Date: 2026-07-21
- Scope: runtime公開契約、durable supervisor、multi-epoch run store、競合treatment、表示binding
- Predecessors: [ADR 0044](0044-rc3-runtime-contract.md)、
  [ADR 0063](0063-ready-frontier-dispatch-contract.md)
- Plan: `aishell-capability-expansion-20260721` / `lattice-runtime-hold-public-bridge-20260721`

## Context

ADR 0044と`src/runtime-hold-recompile.mjs`は、後発競合から
`conflict_found → intake_frozen → hold_decided → carry_over_witnessed →
plan_recompiled → context_invalidated → epoch_rebound → intake_resumed`へ進むproducer coreを持つ。
一方、公開CLIには次の運用境界がない。

1. 利用者又はexecutorが見つけた競合を、保存済み観測へbindして既存runへ投入する入口。
2. 全running executorのwriteをbarrierで止め、Lattice自身が停止を再観測する持続的control plane。
3. vN+1のrequest、plan、manifest、task migrationを保存・検証するmulti-epoch store。
4. seam分割か理由付き直列化を選び、queued eventを失わず新epochへ進む公開導線。

`hold_decided`は止める集合の論理裁定であり、実process／session／worktreeが止まった証拠ではない。
また`todo block`は工程journalの単一task状態遷移で、runtime handle、checkpoint、write lease、epochを所有しない。

独立反証により、外部JSONでhold ackを受ける案と既存`run resume`をmutation化する案は棄却した。
外部ackは停止を捏造でき、resume変更は既存wireと再開確認の意味を壊す。公開bridgeは
**Lattice-owned durable supervisorがcontrol socket越しに停止と再認可を直接確認するmanaged runだけ**に限定する。

## Decision 1 — 既存公開面の互換とmanaged lifecycle

既存のexact argvとresult schemaを維持する。

```text
lattice run start   --request <run-request.json> --executor <adapter>
lattice run observe --run <.lattice/runs/run-id>
lattice run status  --run <.lattice/runs/run-id>
lattice run resume  --run <.lattice/runs/run-id>
lattice run close   --run <.lattice/runs/run-id>
lattice run abandon --run <.lattice/runs/run-id> --reason <reason>
```

- `run start`は従来どおりrun storeを作り`lattice.run_start_result.v1`を返す。supervisorを暗黙起動しない。
- `run observe / status / resume`はread-onlyを維持する。`resume_result.v1`のexact wireと
  `outcome: resumable`を変更せず、store eventを追記しない。
- freeze中又はepoch commit済み・release未完了でも、`run resume`は従来どおり
  `lattice.run_resume_result.v1 / outcome: resumable / dispatchable: []`を返す。新しいtyped errorへ変えず、
  exact key、exit 0、stdout一行をbyte互換に保つ。managedな停止理由と不足条件は`run status`のversioned拡張又は
  managed mutation／control resultだけが所有する。完全activate後は従来どおりfrontierを返す。

新しいruntime exact argvは次の6つだけとする。

```text
lattice run activate  --run <.lattice/runs/run-id>
lattice run finding record --run <.lattice/runs/run-id> --checkpoint <sha256> --input <candidate.json>
lattice run conflict  --run <.lattice/runs/run-id> --finding <sha256>
lattice run hold      --run <.lattice/runs/run-id>
lattice run recompile --run <.lattice/runs/run-id> --input <runtime-recompile-request.json>
lattice run reprocess --run <.lattice/runs/run-id>
```

正規遷移は次とする。

```text
unmanaged run
  → activate（durable supervisor開始）
  → finding record（保存checkpointからfindingを再導出）
  → conflict（保存済みfindingを参照、即時freeze）
  → hold（全running write barrier、停止再観測）
  → recompile（treatment、successor検証、rebind ack、queue replay、epoch activate）
  → reprocess（staged successorのqueued conflictを再評価）
  → resume（read-onlyの再開可能性確認）
```

- `activate`は同一runの二重supervisorを拒否し、停止済みsupervisorは新しいsession nonceで明示再起動する。
- `finding record / conflict / hold / recompile / reprocess`はlive supervisor、control socket、session nonceの三つが
  一致するmanaged runだけを
  受理する。未managed／stale descriptor／socket不一致は`RUN_NOT_MANAGED`で無変更拒否する。
- CLIはmutationを直接行わず、repo rootで解決したUnix domain control socketへversioned requestを送り、
  supervisorがlifecycle lock、event chain、epoch transactionを所有する。
- external JSON hold ack、PIDだけのack、任意socket path、nonce CLI引数、環境変数経由のack注入は公開しない。

## Decision 2 — durable supervisor、adapter controller、control protocol

`run activate`はLattice-owned supervisorをrun storeへbindして起動する。supervisorはCLI子processの寿命から独立し、
同じrunを再操作できるdurable processである。AI hostのthreadやprovider session自体は所有しない。

`lattice.runtime_supervisor_descriptor.v1`のexact fieldは
`schema, run_id, pid, process_start_identity, socket_ref, session_nonce_digest,
protocol_version, activated_at, descriptor_digest`とする。

- `socket_ref`はrun directory配下の固定名`supervisor/control.sock`だけ。symlink、repo外path、既存の非socketを拒否する。
- session nonceはsupervisor起動ごとにCSPRNGで生成し、0600の`supervisor/session`へ保存する。
  descriptorとeventへはdigestだけを保存し、CLI stdout、error、Ganttへnonceを出さない。
- supervisor再接続はPIDだけで判断せず、process start identity、socket peer、session nonce challengeを全て検証する。
- supervisorはexecutor adapterのcontrol capabilityを起動時に取得する。最低interfaceは
  `barrier`, `observeQuiescence`, `rebind`, `observeRebind`, `releaseWriteLease`である。

managed runのadapterはCLI process内の一時objectではなく、versioned adapter controller hostとして登録する。
`lattice.runtime_adapter_controller_descriptor.v1`のexact fieldは
`schema, controller_id, adapter_kind, pid, process_start_identity, socket_ref,
controller_session_nonce_digest, capabilities, heartbeat, descriptor_digest`とする。

- `capabilities`は`lattice.runtime_adapter_capabilities.v1`で、exact fieldは
  `schema, operations, process_observation, worktree_fingerprint, staged_write_lease,
  durable_dispatch, capabilities_digest`。`operations`は`dispatch | observe | barrier | rebind |
  prepare | activate | release | revoke`の重複なしclosed setである。
- `heartbeat`は`lattice.runtime_heartbeat_policy.v1`で、exact fieldは
  `schema, interval_ms, ttl_ms, disconnect_revokes_immediately, policy_digest`。
- controller socketは`supervisor/controllers/<controller-id>.sock`だけ。controller自身がsession nonce challengeへ
  応答し、supervisorがprocess identity、capability、socket peerを照合する。外部descriptor fileだけで登録済みにしない。

host registrationはcontrol handshakeからsupervisorが生成する
`lattice.runtime_adapter_registration.v1`で、exact fieldは
`schema, registration_id, run_id, supervisor_session_nonce_digest, controller_descriptor_digest,
registered_operations, registered_at, registration_digest`とする。保存先は
`controllers/<controller-id>/registration.json`。descriptorとregistrationはregular file、0600、self digest一致を必須とする。

- managed runの`dispatch / observe`はすべてsupervisor→登録済みcontroller socketを通る。従来CLI内adapterへ
  直接dispatch／observeする経路との混用を禁止する。
- dispatch eventはcontroller registration digest、controller session nonce digest、write lease digestをbindする。
- observe resultは同じregistrationとdispatch handleにbindし、別controllerからのreceiptを拒否する。
- `run activate`時にadapter controllerを起動又は既存hostへhandshakeできなければ
  `ADAPTER_CONTROLLER_UNAVAILABLE`。in-memory adapterへのfallbackは禁止する。

`run-meta.json.executor_adapter`の文字列だけを実行入口にしない。durable registryのexact pathは
`.lattice/runtime/adapter-registry/registry.json`、launch descriptorは
`.lattice/runtime/adapter-registry/descriptors/<adapter-kind>.json`とする。

`lattice.runtime_adapter_registry.v1`のexact fieldは`schema, entries, registry_digest`、entry exact fieldは
`adapter_kind, launch_descriptor_ref, launch_descriptor_digest`。
`lattice.runtime_adapter_launch_descriptor.v1`のexact fieldは
`schema, adapter_kind, launch_kind, binary_path, binary_digest, binary_identity, argv,
config_ref, config_digest, endpoint, capabilities_digest, descriptor_digest`とする。

- `launch_kind`は`host_binary | existing_endpoint`だけ。binary型は絶対regular executable path、SHA-256
  `binary_digest`、ordered argv、repo内regular config ref＋digestを必須としendpointは`null`。
  `binary_identity`は`null | lattice.macos_binary_identity.v1`のclosed unionで、macOS identityのexact fieldは
  `schema, kind, cdhash, signing_identifier, team_identifier, designated_requirement_digest, identity_digest`、
  `kind`は`macos_codesign`だけ。unsigned binaryは`null`とし、未知identity objectを許さない。
  endpoint型は固定Unix socket refを必須とし、binary／identity／config fieldは`null`、argvは空配列のschema規定値にする。
- activateはregistry self digest、entry、descriptor bytes、adapter kind、capability digest、binary identity又はendpoint peerを
  全て照合してからlaunch／attachする。host binaryは起動直前にpathのfile identity、bytes digest、任意のmacOS identityを
  照合し、exec後にもPIDの実行image path／digest／identityを照合する。両時点の不一致はprocessを停止して
  `ADAPTER_BINARY_IDENTITY_MISMATCH`とし、登録しない。meta文字列はregistry lookup keyにだけ使う。
- 未登録は`ADAPTER_NOT_REGISTERED`、descriptor／binary／config／endpoint不一致は`ADAPTER_LAUNCH_INVALID`。
  PATH探索、basename推測、内蔵adapterへのfallbackは禁止する。

control socket request／responseは`lattice.runtime_control_request.v1`／
`lattice.runtime_control_response.v1`。request exact fieldは
`schema, request_id, run_id, operation, payload, session_nonce, request_digest`、response exact fieldは
`schema, request_id, run_id, outcome, result, control_head_digest, response_digest`とする。
nonceはsocket内だけを流れ、保存するcontrol eventはnonce digestだけを持つ。

supervisor→controller protocolのoperation closed setは
`dispatch | observe | barrier | rebind | prepare | activate | release | revoke`とし、各operationは次のexact documentを使う。

| operation | request schema / exact payload | response schema / exact result |
|---|---|---|
| dispatch | `lattice.adapter_dispatch_request.v1`: `schema, request_id, registration_digest, packet, write_lease, request_digest` | `lattice.adapter_dispatch_response.v1`: `schema, request_id, executor_handle, worktree_id, packet_digest, lease_digest, response_digest` |
| observe | `lattice.adapter_observe_request.v1`: `schema, request_id, registration_digest, executor_handle, expected_epoch, expected_lease_digest, request_digest` | `lattice.adapter_observe_response.v1`: `schema, request_id, observation, observation_digest, response_digest` |
| barrier | `lattice.adapter_barrier_request.v1`: `schema, request_id, registration_digest, barrier_id, reason, running_bindings, frozen_event_digest, request_digest` | `lattice.adapter_barrier_response.v1`: `schema, request_id, barrier_id, quiescence_acks, response_digest` |
| rebind | `lattice.adapter_rebind_request.v1`: `schema, request_id, registration_digest, rebind_packet, staged_lease, request_digest` | `lattice.adapter_rebind_response.v1`: `schema, request_id, rebind_ack, staged_lease_digest, response_digest` |
| prepare | `lattice.adapter_prepare_request.v1`: `schema, request_id, registration_digest, executor_packet, staged_lease, request_digest` | `lattice.adapter_prepare_response.v1`: `schema, request_id, prepare_ack, staged_lease_digest, response_digest` |
| activate | `lattice.adapter_activate_request.v1`: `schema, request_id, registration_digest, committed_epoch_digest, activation_digest, staged_lease_digests, request_digest` | `lattice.adapter_activate_response.v1`: `schema, request_id, ready_ack, observed_pointer_digest, response_digest` |
| release | `lattice.adapter_release_request.v1`: `schema, request_id, registration_digest, release_barrier_digest, activation_digest, gate_generation, staged_lease_digests, request_digest` | `lattice.adapter_release_response.v1`: `schema, request_id, release_ack, armed_lease_digests, observed_gate_generation, response_digest` |
| revoke | `lattice.adapter_revoke_request.v1`: `schema, request_id, registration_digest, reason, lease_digests, request_digest` | `lattice.adapter_revoke_response.v1`: `schema, request_id, revoked_lease_digests, residual_processes, response_digest` |

`packet`、lease、ack、observation、running bindingも本ADR又はADR 0044のversioned exact schemaだけを受ける。
operationとschemaのcross-use、unknown operation、generic object forwardingを拒否する。

`release_ack`は`lattice.adapter_release_ack.v1`で、exact fieldは
`schema, ack_id, registration_digest, controller_id, run_id, plan_epoch, release_barrier_digest,
gate_generation, armed_lease_digests, supervisor_session_nonce_digest, ack_digest`。
controllerごとに自身が所有するarmed lease v2 exact集合を決定的順序でbindする。gate verifierはack self digest、
全registration集合との一対一対応、controller ID、run／epoch／barrier／generation／session nonce、各controllerの
lease ownershipを再検証し、全ack lease集合のunionがgate armed lease集合とexact一致することを要求する。
ack／registrationの欠落、余剰、重複、別controller流用はgate commit前にfail closedとする。

supervisorのcontrol journalは`lattice.runtime_control_event.v1`のappend-only hash chainとする。top-level exact fieldは
`schema, run_id, sequence, previous_digest, kind, session_nonce_digest, payload, recorded_at, event_digest`、
kind closed setは次とする。

```text
supervisor_activated, controller_registered, controller_heartbeat,
dispatch_routed, observation_routed, barrier_requested, executor_quiesced,
epoch_rebind_requested, epoch_rebind_acknowledged,
epoch_prepare_started, staged_lease_acknowledged, epoch_commit_decided,
global_activation_requested, global_activation_acknowledged,
release_barrier_committed, release_acknowledged, write_gate_committed, lease_revoked,
supervisor_recovery_barrier, staging_superseded,
epoch_activated, supervisor_stopped
```

既存`lattice.run_event.v1`のclosed setと意味は変更しない。runtime control eventは停止／再認可の一次証拠を所有し、
run eventの`hold_decided / epoch_rebound / intake_resumed`は対応control event digestへbindする。

## Decision 3 — conflictは保存済みfinding参照だけ

`run conflict --finding <sha256>`のdigestは、supervisorが既に保存したcheckpoint観測又はfinding artifactの
canonical digestだけを参照する。CLIからfinding本文、TODO集合、path、executor handleを入力しない。

`lattice.runtime_finding_record.v1`のexact fieldは
`schema, finding_id, run_id, plan_epoch, source_checkpoint_digest, observed_event_digest,
finding, recorded_by, finding_digest`とする。

- finding kindはADR 0044のclosed conflict分類だけ。TODO、path／resource、根拠digestを持つ。
- active run、epoch、packet、checkpoint、event prefixとのbindingをsupervisorが再検証する。
- unknown digest、別run／旧epoch digest、未保存本文は`FINDING_UNRESOLVED`又は`STALE_FINDING`。
- 成功時は`conflict_found`と`intake_frozen`を一つのevents置換で保存する。freeze後の新dispatchを拒否する。

findingのdurable pathは`findings/<finding_digest>.json`だけとし、digest名とbody self digestを一致させる。
symlink、非regular file、別digest alias、上書きを拒否する。authoring入口
`run finding record --checkpoint <sha256> --input <candidate.json>`は、candidateをそのまま保存せず、保存済み
checkpoint、active plan／manifest、controller observationからsupervisorがfindingを再導出し、producerと独立verifierの
一致したrecordだけを新規保存する。candidate schema`lattice.runtime_finding_candidate.v1`のexact fieldは
`schema, proposed_kind, todo_ids, path, resource_id, evidence_digests, candidate_digest`である。

## Decision 4 — holdは全running barrierと直接ack

`run hold --run`はsupervisorへactive epochの**全running executor**を対象にbarrierを送る。
affected集合だけでなくcarry-over候補も、epoch barrier中は一度writeを止める。

1. supervisorは各dispatchのexecutor handle、worktree、epoch、packet digest、write lease IDを保存prefixから解決する。
2. `barrier_requested`を保存し、adapterへ同じbindingを持つbarrierを送る。
3. adapterはwrite leaseを失効し、final checkpointをflushする。
4. supervisorがprocess／session状態とworktree fingerprintを再観測する。
5. adapter control socketから直接ackを受け、再観測結果とexact一致した時だけ`executor_quiesced`を保存する。
6. 全runningがquiescedになったprefixへfinal checkpointを取り込み、affected closureとcarry-over witnessを
   producer／verifierで再計算して`carry_over_witnessed`、`hold_decided`をrun eventへ保存する。

`lattice.executor_quiescence_ack.v1`のexact fieldは
`schema, ack_id, run_id, todo_id, executor_handle, worktree_id, plan_epoch, packet_digest,
write_lease_id, barrier_control_digest, final_checkpoint_digest, process_observation_digest,
worktree_fingerprint_digest, supervisor_session_nonce_digest, ack_digest`とする。

- 外部file／stdin／CLI引数からackを読まない。ackはsupervisorと既知adapter間のcontrol channelだけから得る。
- signal送信成功、`acknowledged: true`、チャット発言、PID文字列だけでは停止証拠にならない。
- adapterがbarrier、write lease、停止再観測を実装しない場合は`ADAPTER_HOLD_UNSUPPORTED`。
- 一件でもack不明／不一致なら`HOLD_ACKS_INCOMPLETE`でfreezeを維持し、recompileしない。
- ack後の旧lease write、checkpoint、receiptを観測した場合は`HOLD_ACK_VIOLATED`。新しいhold cycleを要求する。

## Decision 5 — successor requestと競合treatment

`run recompile --input`は`lattice.runtime_recompile_request.v1`だけを受ける。exact fieldは
`schema, request_id, run_id, predecessor_epoch, frozen_event_digest, hold_decision_digest,
mode, reason, successor_request, task_migration, phase_revision, seam_split, intentional_serial,
request_digest`とする。

`mode`は`seam_split | intentional_serial`だけで、非該当側fieldは`null`にする。
`task_migration`は両modeで必須のfull `lattice.runtime_task_migration.v1`である。
`phase_revision`は工程task／edge／sourceを変更する場合にfull `lattice.phase_todo_revision.v3`、変更しない場合だけ
`null`とする。field自体の省略、外部path参照、request digest外の後付けは禁止する。

### seam split

`seam_split`は`lattice.runtime_seam_split.v1`のfull documentで、exact fieldは
`schema, finding_digest, predecessor_task_ids, task_migration_digest,
ownership_diff, edge_diff, verifier_refs, split_digest`とする。

- `successor_request`はfull `lattice.run_request.v2`。v1へfieldをin-place追加せず、exact fieldは
  `schema, request_id, repo, capacity, todos, manual_witness, sensor_query_set,
  executor_capability, claim_mode, predecessor_request_digest, task_migration_digest,
  request_digest`とする。
- `task_migration.entries`は旧task全件を`carry | replace | split | retire | stay`の一つへexact mappingし、
  successor task、理由、evidence digestを持つ。欠落task、孤立successor、重複mappingを拒否する。
- `ownership_diff`と`edge_diff`はadded／removedのexact集合を持つ。seam対象の競合資源が分割後も交差する、
  又はshared state／external effectをpath分割だけで解消扱いする場合は`SEAM_SPLIT_UNPROVEN`。
- producerとは独立したverifierがsuccessor request、plan、manifest全件、migration、ownership、edge、finding解消を
  fresh sensor evidenceから再計算し、完全一致しなければstageしない。

### intentional serial

`intentional_serial`は`lattice.runtime_intentional_serial.v1`、exact fieldは
`schema, finding_digest, todo_ids, resource_id, stay_todo_id, reason, serial_digest`とする。

- findingの当事者とresourceをexact維持し、同時dispatch不能なconflictとしてsuccessor planへ残す。
- seam分割費用が高い場合の片側stayは`stay_todo_id`へ明示し、task migrationでも当該taskを`stay`、
  その他の当事者を`carry | replace`へexact mappingする。precedenceへの偽装、競合削除、無理由直列化は禁止する。
- `successor_request`はfull v2で、task集合を維持し、finding conflictをexactに含む。

### lpg-028工程revision受入

seam split又はintentional serialがLattice工程task／edge／sourceを変える場合、runtime successorだけを先行activateしない。
同じrecompile requestの`phase_revision`はfull `lattice.phase_todo_revision.v3`を持ち、TODO store transactionのcommit receiptを
epoch bundleへbindする。v3 exact fieldは
`schema, project_id, plan_key, predecessor, desired_plan, runtime_task_migration, task_migration, phase_migration,
source_inventory, reconciliation, source_cutover_batch, revision_digest`とする。

- `runtime_task_migration`はrecompile requestのfull `lattice.runtime_task_migration.v1`とcanonical bytesがexact一致する。
  `task_migration`はTODO store用arrayで、各entry exact fieldは`from_task_id, to_task_id, state_policy`。
  runtime entryからpredecessor順に決定的変換し、`carry | stay`は同一IDへ`carry`、`replace`は唯一のsuccessorへ
  `reset_pending`、`retire`は`removed / removed`、`split`はlexicographic先頭successorへ`reset_pending`とし、
  残りのsplit successorは新規taskとしてmigration rowを持たない。carryでmetadata reconciliationが必要な場合だけ
  `carry_reconciled_metadata`を使い、根拠なしのstate policy選択を拒否する。
- `task_migration_digest`はcanonical TODO arrayのdigest、`runtime_task_migration_digest`はfull runtime documentのdigest。
  reconciliationとrevision digestは両方をbindし、一方から他方を暗黙導出して保存を省略しない。

- `source_inventory`はactive source全件とexcluded tombstone全件を列挙し、task migration後の全taskを一意に覆う。
- `reconciliation`はpredecessor reconciliation、inventory、desired plan、task／phase migration、cutover batch digestをbindする。
- `source_cutover_batch`はlive Markdown checkboxをarchive／non-checkbox replacementへ移す全operationを持ち、
  source bytes digest、archive ref、replacement、batch digestをexact検証する。
- plan、journal genesis、snapshot、source image、archiveをtransaction stagingへfsyncし、cutover recovery barrierを耐久化、
  source／archiveを公開した後、manifest CASを最後のcommit pointにする。各crash pointは同じrevision digestだけで
  roll-forward／cleanupでき、別revision retry、部分source公開、Markdown再取込へfallbackしない。
- `lattice.source_cutover_receipt.v1`はDecision 10のexact fieldを持ち、全cutover operationをordered `entries`へ
  一対一で列挙する。各entryはtask／disposition、original／staging／published／archive ref、replacement、
  staged／published／archived line bytes digestをbindする。top-levelはrevision／batch、全archive root list digest、
  cleanup barrier bindingをself digestで束縛する。単一source fieldへ潰さず、同一fileの複数lineも別entryで保持する。
  `published_state`は`source_and_archive_published`だけ。validatorはregular fileの実bytes digest、path、batch operation、
  inventory、revision digest、cleanup bindingを再読照合する。部分公開、staging残存とcleanup完了の矛盾、別revision receipt、
  bytes差替えはrecovery requiredとしてfreezeし、same-digest transactionだけroll-forward又は未公開stageをcleanupできる。
  cleanup bindingのdigest対象は`lattice.source_cutover_cleanup_binding.v1`のexact
  `schema, revision_digest, staging_ref, cleanup_state`で、committed receiptでは`cleanup_state=cleanup_complete`だけを許す。
- runtime epoch commitはphase revision manifest commit receiptとsource cutover cleanup確認後だけ許す。
- 既存`phase_todo_revision.v2`へdesired v5 plan、TODO task migration、phase migrationを投影して
  validator／apply primitiveを再利用できるが、これは下位primitive検証だけでありv3 identityのcommit証拠ではない。
  v3 authoring transactionはfull v3 revision bytesをrevision imageへ保存し、既存full
  `lattice.todo_event.v4` genesisの`revision_digest`、manifest memberの`active_revision_digest`、phase commit
  receiptの`revision_digest`を
  **同じv3 revision digest**へexact bindする。v2 projection digestをv3 digestとして扱ったりreceiptだけv3へ
  差し替えたりする実装を拒否する。
  snapshotは既存full `lattice.todo_snapshot.v2`をv4 genesisからreplayして生成する。manifestだけはmemberへ
  revision bindingがないため`lattice.todo_manifest.v2`へversion bumpし、top-level exact fieldはv1同様
  `schema, project_id, repositories, members, manifest_digest`、member exact fieldは
  `plan_key, active_plan_version, active_revision_digest, plan_ref, journal_ref, snapshot_ref,
  topology_digest, journal_head_digest`とする。readerはplan、v4 eventのactor／recorded_at／previous digest／payload、
  state migration／phase state migrationを既存validatorとreplay規則で検証し、snapshot v2とmanifest v2を
  filesystem全体で照合する。独自の最小event／snapshot objectは保存しない。

state `carry | stay`のedge比較はID migration後のtyped tuple集合で行う。incoming hard dependency、join、
phase accept dependencyはpredecessorとsuccessorで**exact一致**を要求する。outgoing tupleはsuccessorがpredecessorの
**monotonic superset**であることを要求し、既存outgoing edgeの削除を禁止する。新しいsuccessor制約の追加は許可する。
incoming差分、outgoing edge削除、edge kindの
付替えはcarryでなく`replace | split`を要求し、暗黙carryを拒否する。

## Decision 6 — multi-epoch storeとatomic activation

managed run storeのexact layoutは次とする。epoch 1もdirectoryへ格納し、activate完了時点でactiveである。

```text
.lattice/runs/<run-id>/
  run-meta.json
  request.json                  # epoch 1互換alias
  plan-compile-result.json      # epoch 1互換alias
  events.json
  control-events.json
  committed-epoch.json
  release-epoch.json
  queued-events.json
  findings/
    <finding-digest>.json
  controllers/
    <controller-id>/
      descriptor.json
      registration.json
  leases/
    <lease-id>.json
  staging/
    <transaction-id>/
      epoch-bundle.json
      prepare.json
  epochs/
    00000001/
      epoch-bundle.json
    00000002/
      epoch-bundle.json
  supervisor/
    descriptor.json
    session
    control.sock
    write-gate.json
    controllers/
      <controller-id>.sock
```

`lattice.run_meta.v2`のexact fieldは
`schema, run_id, executor_adapter, run_event_schema, control_event_schema,
epoch_bundle_schema, created_plan_digest, meta_digest`とする。mutable active epochをmetaへ複製しない。

`lattice.runtime_epoch_bundle.v1`のexact fieldは
`schema, run_id, plan_epoch, request, plan, manifests, executor_packets, rebind_packets,
plan_diff, task_migration, treatment, phase_revision_digest, phase_revision_commit_receipt,
predecessor_bundle_digest, bundle_digest`とする。
epoch 1では`rebind_packets, plan_diff, task_migration, treatment, phase_revision_digest,
phase_revision_commit_receipt, predecessor_bundle_digest`を`null`、
successorでは契約に応じたfull documentを必須にする。

`lattice.phase_revision_commit_receipt.v1`のexact fieldは
`schema, project_id, plan_key, plan_version, revision_digest, committed_member_digest,
active_plan_digest, journal_genesis_digest, reconciliation_digest, source_cutover_receipt_digest,
committed_at, receipt_digest`とする。保存先はrevision plan directory内のimmutable
`.lattice/todo/plans/<plan-key>/<plan-version>/phase-revision-commit-receipt.json`だけとし、対応する
`source-cutover-receipt.json`と共にmanifest member CASと同じtransactionで耐久化する。
global mutable manifest digestはreceipt identityへ含めない。receiptはcommitted member、version、revision、
reconciliation、source cutover receiptをbindし、同revision digestでのretryはこのexact pathを再読する。
transactionはplan／journal／snapshot／source公開証拠、source cutover receipt、phase commit receiptの順にstageして
fsyncし、manifest member CASを最後のcommit pointにする。CAS前receiptはorphanで非committed、CAS後はimmutable。
CAS成功直後・runtime bundle stage前にcrashしても、same revision digest retryはreceiptを再読・全binding検証してから
bundle stageへ進み、TODO transactionを別bytesで再実行しない。
recompile requestの`phase_revision`が`null`ならbundleの両phase fieldも`null`。非nullなら、request digest検証後に
同じrevision bytesをTODO transactionへapplyし、manifest commit receiptを再読・検証してからだけbundleをstageする。
bundleの`phase_revision_digest`、receipt revision digest、committed member／version、active plan／journal／cutover receipt digestのどれかが
不一致なら`PHASE_REVISION_COMMIT_MISMATCH`でepoch commitを拒否する。

`lattice.committed_epoch_pointer.v1`のexact fieldは
`schema, run_id, plan_epoch, plan_ref, bundle_digest, activation_run_event_digest,
activation_control_event_digest, pointer_digest`とする。
`lattice.release_epoch_barrier.v1`のexact fieldは
`schema, run_id, committed_epoch_pointer_digest, plan_epoch, activation_digest,
controller_ready_ack_digests, staged_lease_digests, gate_generation, release_digest`とする。

- epoch directory名、request、plan epoch、plan ref、全manifest／packet key集合をexact一致させる。
- activateは既存v1 storeのepoch 1 artifactを再検証してbundle化し、`run_meta.v2`とpointerを発行する。
  既存request／compile artifact aliasはbytesを変えず、既存start／observe／resume consumerを維持する。
- epoch bundleはtemporary directoryへ書き、全fileをfsync、directoryをfsync、rename、親`epochs/`をfsyncする。
- successorは最初から`epochs/`へ置かず`staging/<transaction-id>/`へ耐久化する。queue clearと全staged lease ack前の
  staging directoryはactiveでもepoch履歴でもない。
- commitは検証済みstagingを`epochs/<epoch>/`へdirectory renameしてfsyncし、run／control eventをfsyncし、
  pointer temporary fileをfsync→rename→run directory fsyncする。その後だけ全controllerへactivation readyを要求する。
- `committed_epoch`はcommitted pointer、bundle、`epoch_commit_decided` control eventの三者一致から導出する。
  `active_epoch`はさらに中央write gate、`epoch_activated`、`intake_resumed`が一致した場合だけsuccessorへ進む。
  `fully_activated`は全controller release ackをbindした中央write gate commit後だけtrue。epoch 1はactivate時のcontrol eventと既存plan eventへbindする。
- crashでtemporary directoryだけが残れば削除可能。bundleだけならorphanとして非active。同digest retryだけ再利用する。
  commit eventまでありpointerが旧値なら、supervisor recoveryが全証拠を再検証してpointerをroll-forwardする。
  pointerだけ先行する書順は禁止し、不一致中はdispatchを拒否する。directory最大値や旧planへのfallbackは禁止する。
- `status / observe / resume / event verify / close / abandon`は全epoch bindingを検証する。epoch 1 planだけで
  successor eventを検証済みと報告してはならない。

## Decision 7 — rebind、queued replay、再開

recompile開始条件は全running executorの`executor_quiesced`である。supervisorはsuccessorを独立verifyしてbundleをstageし、
旧contextを全失効する。再開はprepare、committed pointer＋全controller ready、release ack収集、中央write gate commitの
四段階で行う。

- affected TODOはquiescedのままsuccessor packetをcontrollerへprepare dispatchし、実行不能なstaged write leaseだけを得る。
- carry-over TODOもbarrier中はquiescedのまま。carry-over witness成立後、adapterへepoch rebind packetと新write leaseを送り、
  adapterの直接ackをsupervisorが再観測した場合だけ`epoch_rebind_acknowledged`を保存する。ack前にwriteを再開させない。
- rebind ackのexact schema`lattice.executor_epoch_rebind_ack.v1`は
  `schema, ack_id, run_id, todo_id, executor_handle, worktree_id, predecessor_epoch,
  successor_epoch, predecessor_packet_digest, rebind_packet_digest, new_write_lease_id,
  supervisor_session_nonce_digest, ack_digest`を持つ。
- `lattice.runtime_write_lease.v1`のexact fieldは
  `schema, lease_id, run_id, todo_id, plan_epoch, packet_digest, controller_registration_digest,
  supervisor_session_nonce_digest, state, ttl_ms, issued_control_digest, lease_digest`。
  prepare時の`state`は`staged`だけで、controllerはstaged leaseによるread／write／process開始を拒否する。
- release ackで生成するarmed leaseは`lattice.runtime_write_lease.v2`とし、exact fieldは
  `schema, lease_id, run_id, todo_id, plan_epoch, packet_digest, controller_registration_digest,
  supervisor_session_nonce_digest, state, ttl_ms, issued_control_digest, release_barrier_digest,
  gate_generation, lease_digest`。`state`は`armed`、release barrier digestと次generationを必須とする。
  v1 staged documentのfieldをin-place追加せず、v2 self digestへ置換した全armed lease集合を中央gateがbindする。
- affectedのprepare dispatch ackとcarryのrebind ackが**全件**揃うまでrun event `epoch_rebound`を一件も保存しない。
  missing／unknown ackはfreeze維持。affected又はcarryの一部だけを再開する部分成功は禁止する。

freeze中に到着したfinding、checkpoint、receipt、adapter eventはsequence付きqueueへ保存し、捨てない。
新epoch dispatch前に全件をsuccessor plan／manifest／packetへ対して順にreplayする。

- stale receiptはreject eventへ変換する。
- final checkpointはbarrier ack bindingへ取り込む。
- replayしたfindingがsuccessorでも競合ならsuccessor epochを`intake_frozen`のままにし、committed pointerを進めず、
  新しいhold cycleを要求する。findingを「旧epoch由来」として握り潰さない。
- queueが空で全staged ack済みの場合だけepoch directoryを確定し、全carryのrun event `epoch_rebound`を一batchで保存し、
  `epoch_commit_decided`、committed pointerの順に耐久化する。この時点では`intake_resumed`を保存せず、
  pointer commitより前にも後にも中央write gate commitまではleaseを有効化しない。
- pointer commit後、supervisorは同一`activation_digest`を全controllerへ`global_activation_requested`として送り、
  controllerはpointer／session nonce／epoch／packet／lease setを再検証して**ready ackだけ**を返す。
  activation ackが全件揃ってもleaseはstagedのままで、read／write／process開始を禁止する。
- 全ready ackをbindした`release-epoch.json`をatomic commitし、同じrelease digestと次の`gate_generation`を
  全controllerへ送る。controllerはstaged leaseを`armed`へ遷移させるrelease ackを返すが、中央gate capabilityは
  無効なままでread／write／process開始を拒否する。ready ack不足ではrelease barrierを書かない。
- supervisorは**全controller release ack**を回収した後だけ、`supervisor/write-gate.json`をgeneration単位で
  temporary file fsync→rename→supervisor directory fsyncする。この一回の中央commitが全armed leaseを同時に
  有効化する唯一の点である。controller別active flag、最後のbroadcast、各controller local clockを有効化点にしない。
  controllerのwrite／process開始は毎回full central gate verifierを呼び、gateの全bindingと自身を含む全armed
  lease v2集合を再検証する。schema名やgenerationだけを見るshort pathは禁止し、一項目でも不一致なら拒否する。
- `lattice.supervisor_write_gate.v1`のexact fieldは
  `schema, run_id, plan_epoch, gate_generation, release_barrier_digest, controller_release_ack_digests,
  armed_lease_digests, previous_gate_digest, committed_at, gate_digest`。全ack集合とlease集合を決定的順序でbindする。
  verifierはexact keysとself digestに加え、run ID、committed plan epoch、直前generation＋1、直前gate digest、
  committed release barrier digest、全armed lease digestのexact集合を照合する。各lease documentも同run／epoch／
  controller registration／release barrier membershipを持ち、lease v2の`supervisor_session_nonce_digest`が
  expected active supervisor session nonceとowning registrationのnonceの両方へexact一致することを再検証する。
  stale generation、別run／epoch、
  lease欠落／余剰、self digest／chain不一致のどれでもgateを無効としてfreezeを維持する。
  verifier入力のregistrationはsummaryでなくfull `lattice.runtime_adapter_registration.v1` document、controllerも
  full `lattice.runtime_adapter_controller_descriptor.v1` documentだけを受ける。両self digest、registration run／
  expected supervisor session nonce、controller descriptor digest、descriptorから導くcontroller ID、ack registration digestを
  chain検証する。ackの`supervisor_session_nonce_digest`もexpected active supervisor sessionとexact一致必須。
  stale nonce、registration bytes／digest不一致、descriptor差替え、summary objectへの縮退をfail closedで拒否する。
  gate commit後に`write_gate_committed`、`epoch_activated`、最後に`intake_resumed`を同じdurable event batchへ保存する。
  一つでもrelease ack不足ならgate generationを進めず、全controllerで旧generationを維持する。
- committed pointerから中央write gate commitまでの観測は`committed_epoch=successor / active_epoch=predecessor /
  fully_activated=false`へ帰属し、successor runtime receiptとして受理しない。中央gate commit後の観測だけをsuccessor
  active epochと新leaseへ帰属させる。
- managed runのepoch状態は`lattice.managed_epoch_state.v1`で公開し、exact fieldを
  `schema, run_id, committed_epoch, active_epoch, fully_activated, committed_pointer_digest,
  release_barrier_digest, state_digest`とする。release前の`release_barrier_digest`は`null`。
  既存`run status` v1へfieldを足さず、managed controlのversioned result又はmanaged run用status extensionだけが
  このdocumentを返す。
- `run recompile`成功後、既存`run resume`はread-onlyで`resumable`を返す。

queued conflictでstaged successorが止まった場合、`run reprocess --run`だけが同じstaging transactionとqueue headを
再検証する。競合が解消済みならproducer／verifier一致後にprepareを再開する。残存なら
`QUEUED_CONFLICT_REMAINS`とfinding digestを返しfreezeを維持する。別successorが必要なら旧stagingを
`staging_superseded` control eventで終端して、新digestの`run recompile`を要求する。`run resume`やdirectory走査で
stagingを暗黙採用しない。

## Decision 7a — heartbeat、socket断、supervisor restart

- supervisor heartbeatはregistration、session nonce、単調増加sequence、lease set digestへbindする。
- controllerはheartbeat TTL超過又はsupervisor socket切断を検知した瞬間、active／staged leaseを全てlocal revokeし、
  processをbarrier状態へ戻す。再接続までwriteを許可しない。wall clock逆行をTTL延長へ使わない。
- supervisorもcontroller heartbeat TTL超過を`CONTROLLER_HEARTBEAT_EXPIRED`としてfreezeし、dispatch／observe結果を拒否する。
- supervisor restartは必ず新session nonceを発行する。旧nonceへbindしたlease、ack、heartbeat、control responseは無効。
- restart後はstore上runningと全controller観測集合の和へ`supervisor_recovery_barrier`を送り、全件quiescenceを
  再証明してからのみleaseを再発行する。一件でもcontroller不達又は状態不明ならfreezeを維持する。

## Decision 7b — managed close／abandon

既存`run close / abandon` argvとresult wireは維持するが、managed runでは必ずsupervisorへproxyする。
supervisorは全controllerへbarrierとlease revokeを送り、process／worktreeを再観測し、全ack後だけ`run_closed`を保存する。

- `close`は従来の全TODO complete条件も維持する。
- `abandon`もlease revokeを省略しない。controller不達は`MANAGED_SHUTDOWN_INCOMPLETE`でfreezeを維持し、
  runをclosedに見せない。
- CLIがsupervisor不達時にunmanaged close pathへfallbackしたり、socket/sessionを先に削除したりしない。
- run close event耐久化後に`supervisor_stopped`を保存し、socket、session、controller hostを順に回収する。

## Decision 8 — TODO／Gantt overlayの明示binding

runtimeと工程ToDoの対応は暗黙推測しない。明示bindingがある場合だけTODO status／project別Ganttへ
`held | carry_over | redispatch | runtime_frozen` overlayを表示する。

`lattice.todo_runtime_binding.v1`のexact fieldは
`schema, project_id, plan_key, task_id, run_id, runtime_todo_id, binding_evidence_digest,
binding_digest`とする。同一task／runtime TODOの重複又は別run二重bindingを拒否する。

bindingのdurable layoutはgit trackedな
`.lattice/todo/runtime-bindings/<plan-key>/<task-id>/journal.jsonl`と`snapshot.json`だけとする。
journal event `lattice.todo_runtime_binding_event.v1`のkindは`bind | unbind`、todo actor、sequence、previous digest、
full binding又はtarget binding digest、reason、event digestを持つ。snapshotは破棄可能投影で、journalが正本である。

authoring exact argvは次とする。既存todo actor 3環境値、store lock、canonical writer、Git evidence検証を継承する。

```text
lattice todo runtime bind --plan <key> --task <id> --run <.lattice/runs/run-id> \
  --runtime-task <id> --evidence <descriptor.json>
lattice todo runtime unbind --plan <key> --task <id> --reason <reason>
```

- bindingなしのruntime状態は`run status / observe`だけに出す。
- overlayは表示投影であり、TODO journalの`pending | in-progress | blocked | done`を変更しない。
- generic `todo block/unblock`とruntime holdは非同期の別状態機械のまま。片方のeventをもう片方のackに使わない。
- Ganttはproject URL／session分離を維持し、別projectのbindingやrunを混ぜない。

## Decision 9 — fail-closed code

少なくとも次をtyped errorとしてfail closedに扱う。入力／precondition検証で検出した場合はstore無変更で拒否する。
barrier送達後のack不足・違反又はqueued replayで新事実を観測した場合は、既に得たcontrol／run evidenceとfreezeを
保存して停止するが、successor epochをactiveにせずdispatchもしない。この安全側の証拠追記を部分成功扱いしない。

| code | 条件 |
|---|---|
| `RUN_NOT_MANAGED` | live supervisor／socket／session bindingがない |
| `ADAPTER_CONTROLLER_UNAVAILABLE` | versioned controller hostを登録できない |
| `ADAPTER_NOT_REGISTERED` | durable registryにadapter kindがない |
| `ADAPTER_LAUNCH_INVALID` | launch descriptor／binary／config／endpoint binding不正 |
| `ADAPTER_BINARY_IDENTITY_MISMATCH` | 起動直前又はexec後のbinary digest／macOS identity不一致 |
| `CONTROLLER_HEARTBEAT_EXPIRED` | heartbeat TTL超過又はsocket断 |
| `RUN_FROZEN` | freeze中の新managed mutation／controller dispatch要求（既存read-only resumeには使わない） |
| `FINDING_UNRESOLVED` | supervisor保存済みfinding digestでない |
| `STALE_FINDING` | 別run／旧epoch／旧packetへ属するfinding |
| `ADAPTER_HOLD_UNSUPPORTED` | adapterがbarrier・write lease・停止再観測を持たない |
| `HOLD_ACKS_INCOMPLETE` | 全running quiescence ackが未充足 |
| `HOLD_ACK_VIOLATED` | ack後に旧leaseで活動した |
| `SEAM_SPLIT_UNPROVEN` | migration／ownership／edge／fresh evidenceが不成立 |
| `INTENTIONAL_SERIAL_INVALID` | finding当事者又はconflictを維持しない |
| `EPOCH_REBIND_INCOMPLETE` | carry-over adapterの直接rebind ackが不足 |
| `EPOCH_BUNDLE_CONFLICT` | 同一epochへ異なるbundleをstage |
| `PHASE_REVISION_COMMIT_MISMATCH` | request phase revisionとTODO commit receipt／bundle bindingが不一致 |
| `EPOCH_ACTIVATION_INCOMPLETE` | managed recompile／reprocessでready ack、release ack又は中央gate commitが不足 |
| `QUEUED_CONFLICT_REMAINS` | replay後もsuccessor conflictが残る |
| `MANAGED_SHUTDOWN_INCOMPLETE` | managed close／abandonのlease revoke ack不足 |

lock競合は`RUN_BUSY`、control timeoutは`unknown`であり、同じrequest IDを同じsupervisorへ再照会する。
別run作成、external ack、`todo block`、旧epoch plan、directory最大値へのfallbackは禁止する。

## Non-goals

- AI hostのthread、sub-agent、provider sessionをLatticeが所有・生成すること。
- unmanaged executorを停止済みと推測すること。
- 任意processをOS security boundaryとして強制停止できると主張すること。
- seam splitを自動生成し、費用や意味を無視して常に並列化すること。
- TODO journalとruntime control journalを同じ状態機械へ統合すること。

## Decision 10 — nested exact schema規律

本ADRの「exact」はtop-levelだけでなく全nested objectへ再帰適用する。自由形objectを証拠へ入れない。

| schema | nested exact shape |
|---|---|
| `lattice.process_start_identity.v1` | `schema, platform, pid, started_identity, identity_digest` |
| `lattice.macos_binary_identity.v1` | `schema, kind, cdhash, signing_identifier, team_identifier, designated_requirement_digest, identity_digest` |
| `lattice.runtime_conflict_finding.v1` | `schema, kind, todo_ids, path, resource_id, evidence_digests, finding_digest`（非該当path/resourceは`null`） |
| `lattice.runtime_task_migration.v1` | `schema, entries, migration_digest` |
| migration entry | `predecessor_task_id, disposition, successor_task_ids, reason, evidence_digests` |
| phase TODO migration entry | `from_task_id, to_task_id, state_policy` |
| `lattice.phase_revision_commit_receipt.v1` | `schema, project_id, plan_key, plan_version, revision_digest, committed_member_digest, active_plan_digest, journal_genesis_digest, reconciliation_digest, source_cutover_receipt_digest, committed_at, receipt_digest` |
| `lattice.source_cutover_receipt.v1` | `schema, project_id, plan_key, plan_version, revision_digest, source_cutover_batch_digest, entries, archive_root_list_digest, published_state, cleanup_binding_digest, receipt_digest` |
| source cutover receipt entry | `operation_index, task_id, disposition, source_ref, staging_ref, published_ref, archive_ref, replacement, staged_source_bytes_digest, published_source_bytes_digest, archived_source_bytes_digest, entry_digest` |
| `lattice.source_cutover_archive_root_list.v1` | `schema, roots`。root entry exact fieldは`archive_ref, entry_digests` |
| `lattice.source_cutover_cleanup_binding.v1` | `schema, revision_digest, staging_ref, cleanup_state` |
| `lattice.runtime_write_lease.v2` | `schema, lease_id, run_id, todo_id, plan_epoch, packet_digest, controller_registration_digest, supervisor_session_nonce_digest, state, ttl_ms, issued_control_digest, release_barrier_digest, gate_generation, lease_digest` |
| `lattice.adapter_release_ack.v1` | `schema, ack_id, registration_digest, controller_id, run_id, plan_epoch, release_barrier_digest, gate_generation, armed_lease_digests, supervisor_session_nonce_digest, ack_digest` |
| `lattice.todo_manifest.v2` member | `plan_key, active_plan_version, active_revision_digest, plan_ref, journal_ref, snapshot_ref, topology_digest, journal_head_digest` |
| `lattice.supervisor_write_gate.v1` | `schema, run_id, plan_epoch, gate_generation, release_barrier_digest, controller_release_ack_digests, armed_lease_digests, previous_gate_digest, committed_at, gate_digest` |
| `lattice.runtime_ownership_diff.v1` | `schema, added, removed, diff_digest` |
| ownership entry | `resource_id, owner_todo_id, access_kind` |
| `lattice.runtime_edge_diff.v1` | `schema, added, removed, diff_digest` |
| edge entry | `from_todo_id, to_todo_id, kind`（`hard_dependency | conflict`） |
| `lattice.runtime_queue.v1` | `schema, run_id, frozen_epoch, entries, queue_digest` |
| queue entry | `sequence, kind, subject_digest, artifact_digest` |
| `lattice.runtime_observer_identity.v1` | `schema, kind, controller_registration_digest, executor_handle, identity_digest`（非executorはnullable fieldを`null`） |
| `lattice.runtime_binding_target.v1` | `schema, project_id, plan_key, task_id, run_id, runtime_todo_id, target_digest` |
| `lattice.runtime_control_operation.v1` | `schema, operation, run_ref, artifact_digest, expected_epoch, expected_queue_digest, operation_digest`（非該当fieldは`null`） |
| `lattice.runtime_control_result.v1` | `schema, operation, outcome, event_head_digest, control_head_digest, active_epoch, staged_epoch, unmet, result_digest` |
| `lattice.runtime_control_event_payload.v1` | `schema, operation, controller_registration_digest, todo_id, epoch, packet_digest, lease_digest, artifact_digest, payload_digest`（非該当fieldは`null`） |

全collectionは上限、重複禁止、決定的順序をschema validatorで検査する。nested objectの未知field、欠落、null代用、
異version混在はtyped rejectし、後方互換のためのsilent field dropを行わない。
`runtime_control_request.payload`、`runtime_control_response.result`、全control event `payload`は上表のversioned exact
documentだけを受ける。任意object、adapter固有blob、未知operationを包んで通すescape hatchは設けない。

## 既知の罠

- affectedだけを止めると、carry-over候補がepoch barrier中にwriteしてwitnessを破る。
- signal送信成功は停止観測ではない。process identity、write lease、worktree再観測がすべて要る。
- 外部JSON ackはdigestが正しくても「誰が観測したか」を証明しない。
- epoch bundleを書いただけでactiveにすると、directory走査がevent chainより強い第二正本になる。
- queued findingをresume後に処理すると、新epoch dispatchとの競合窓が開く。
- shared state／external effect競合はpath seamだけで解消したと扱わない。

## Verification

1. characterizationはvalid disposable Git repoと実run storeで、既存start／observe／status／resume wireと
   read-only store bytes不変を固定する。
2. 実装前characterizationはactivate／conflict digest／hold／recompileが未公開であることと、
   external ack形がusage拒否されることを固定し、実装waveでsuccess／typed failure期待へ反転する。
3. managed protocol fakeは、全running barrier、nonce／epoch／packet／write lease binding、外部ack入口なし、
   carry rebind ack前write禁止を固定する。
4. 実装はsupervisor再接続、unsupported adapter、ack欠落／違反、v1→epoch1 activation、全fsync順、
   crash recovery、queue replay再競合をfocused testで検証する。
5. integrationは`seam_split`と`intentional_serial`、carry-overとredispatch、actual adapter停止／再起動を各1件通す。
6. Phase gateで関連／全test、npm packed artifact、公開版global CLI、AIShell実repo競合fixtureを確認する。

## Consequences

- 既存run利用者のstart／観測／read-only resumeを壊さず、必要なrunだけmanaged controlへ昇格できる。
- 競合時は全running writeを止め、独立作業は実証済みepoch rebind後にcarry-overできる。
- seam分割が有利なら工程構造をfull successor requestへ反映し、費用過大なら片側stayを理由付きで選べる。
- runはepochを跨いで同じidentityと証拠chainを保ち、明示bindingのある工程だけ動的表示へ重ねられる。

## Characterization evidence

- `test/runtime-hold-public-contract.test.mjs`
  - disposable repoのvalid run storeによる既存CLI互換とread-only確認。
  - managed公開verbとexternal ackが現状未実装であること。
  - hold/recompile producer coreの存在。
  - managed protocol fakeの全running barrier／直接ack／rebind境界。
  - TODO blockとruntime holdのclosed event set分離。
