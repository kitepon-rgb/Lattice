# ADR 0125 — executor adapter registryへ公開CLIから到達する

- Status: Accepted
- Date: 2026-07-25
- Extends: [ADR 0123](0123-runtime-contract-distribution-and-diagnosability.md)
  （配布契約とtyped診断）
- Preserves: [ADR 0044](0044-rc3-runtime-contract.md)（managed runtime activation契約）

## Context

`lattice run activate`は対象repoの
`.lattice/runtime/adapter-registry/registry.json`とlaunch descriptorを必須とする。一方、
これらを書けるのは内部moduleとtest fixtureだけであり、npm利用者が使える公開CLIは存在しなかった。
0.12.23で`ADAPTER_NOT_REGISTERED`へ必要pathと登録済み一覧を追加しても、利用者がそのpathへ正当な
成果物を書く道は無い。`scripted`・`isolated-worktree`・`actual-agent`のいずれを選んでも、
実dispatchより前のadapter未登録で停止する。

registryとlaunch descriptorのwire contractは既に
`src/runtime-controller-protocol.mjs`が所有している。ここでvalidatorを緩めたり、利用者へ
SHA-256や自己digestの手計算を移すと、公開面を増やす代わりに正本を分裂させる。

また、host binaryのmacOS codesign identityは実行時に再観測される。登録時に観測不能だった事実を
`binary_identity: null`だけで隠すと、利用者はidentity bindingが無いことを成功結果から判別できない。

## Decision

1. 公開入口を`lattice run adapter register --input <descriptor.json>`と
   `lattice run adapter list --json`に固定する。登録入力schemaは
   `run adapter register --schema --json`で返す。
2. 入力契約`lattice.runtime_adapter_registration_input.v1`を`docs/schemas/`へ置き、
   `package.json`の`files`へ明記する。配布物に無い契約を公開契約と呼ばない。
3. 利用者入力は登録意図だけを持つ。共通fieldは`schema`・`adapter_kind`・`launch_kind`である。
   `host_binary`は`binary_path`・`argv`・`config_ref`、`existing_endpoint`は`endpoint`を追加する。
   binary/config/capabilities/descriptor/registryの全digestと固定capabilitiesはCLIが導出し、
   入力へdigest fieldを受理しない。
4. 導出したlaunch descriptorとregistryは、activationと同じ
   `validateAdapterLaunchDescriptor`・`validateAdapterRegistry`を通過した場合だけ書く。
   validatorとwire contractは変更しない。
5. registry更新は専用lock内で現在値を読み、同じ`adapter_kind`を追加または差し替え、
   byte順で昇順に整列し、自己digestを再計算する。descriptorとregistryはcanonical JSONを
   temporary fileへfsyncした後にrenameし、directoryもfsyncする。同じkindの再登録結果は
   `created`ではなく`replaced`と明示する。
6. macOSの`host_binary`登録では既存の`observeMacosBinaryIdentity`を使う。観測成功時はidentityを
   descriptorへbindする。非macOSまたは観測失敗時は`binary_identity: null`とし、登録結果の
   `binary_identity_observation`を`not_observed`にしてreasonとmessageを返す。
   `existing_endpoint`は`not_applicable`とする。
7. register/listはそれぞれ`lattice.runtime_adapter_register_result.v1`・
   `lattice.runtime_adapter_list_result.v1`のversioned JSONを返し、自己digestを持つ。
   registry未作成のlistだけは正常な空配列とする。registry、descriptor、両者のdigest bindingが
   壊れている場合は`lattice.cli_error.v2`の`ADAPTER_REGISTRY_INVALID`とdetailでfail closedにする。

## 非目標

- adapter controller binary自体を配布しない。公開CLIはhostが用意したbinaryまたはendpointを、
  activation正本が検証できるdurable descriptorへ変換する面である。
- `run start --executor`の既知adapter集合を増やさない。将来のadapter追加とregistry wire contractを
  分離するため、登録入力の`adapter_kind`は既存identifier contractに従う。
- registryとlaunch descriptorの既存schema version、exact key、自己digest規則を変更しない。
- 登録時にcontroller handshakeを実行しない。endpoint/processの生存とcapabilities一致は
  `run activate`がnonce challengeを含めて検証する。

## Consequences

- npm利用者は公開CLIだけでadapter成果物を作り、`ADAPTER_NOT_REGISTERED`より先のcontroller
  activationへ到達できる。
- 利用者が手計算するdigestは0件になる。binary/config bytesを変更すればactivation時の再観測で
  fail closedになり、登録時の値を暗黙に更新しない。
- listはregistryの存在だけでなく全descriptor bindingを検証してから要約を返すため、壊れたstoreを
  「未登録」の空集合へ丸めない。
- `test/runtime-adapter-registry-cli.test.mjs`がschema配布、digest導出、冪等差替え、identity fallback、
  typed失敗を固定し、`test/integration/runtime-adapter-cli.integration.mjs`が公開CLIだけの
  `git init`から`run activate`までを実測する。
