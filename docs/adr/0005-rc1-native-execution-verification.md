# ADR 0005: RC1のcodex-native入口をexecution-verifiedとして受け入れる

- Status: Accepted
- Date: 2026-07-15
- Scope: 現sessionの`codex-native@v1 / native-subagent / current-parent` executor envelope
- Related: [ADR 0004](0004-rc1-control-admission-correction.md)、
  [execution verification contract](../evidence/2026-07-15-rc1-native-execution-verification-contract.md)

## Context

ADR 0004はrouting smokeを`execution-verified`へ丸めず、known budgetを持つcontinuation Control内で
read-onlyの実Taskを完遂・回収・acceptしてからwrite laneを解放すると定めた。

Control `lattice-rc1-closed-loop-v3`で次を実行した。

- Task: `RC1-X-native-execution-verification-v3`
- Worker Run: `RC1-X-native-execution-verification-run-01`
- Assignment: `RC1-X-native-execution-verification-assignment-v3`
- Agent path: `/root/rc1_codegraph_adapter`
- operation digest: `61910c7e6d5ed9752fe1caa51d9fef8a37fe46c1b27c616c80aaed9d8d181a58`
- Delegation Packet digest: `6f118c047193290d34308926c5f6a04109707e736fab1c40e9e0a0571762e2e2`
- accepted result digest: `7606d702e5f3536634e80f94e11e5880a517423e5938a7db79ac2d3bf98e505c`
- report wrapper SHA-256 at parent inspection:
  `5caf9562d9456865aa5ff596f2a8ba3c5dd03e8da7850ce2972e3d3a569b7512`

Runはplacement `eligible / reasons=[]`、reservation、admission、Packet生成、`agents.followup_task` dispatch、
structured Worker Report回収の順を通った。ReportはRC1-B契約を`ready`とし、具体的矛盾や検証不能条件なし、
empty query／affected testsをindependenceへ丸めないfail-loud契約を確認した。開始・終了時の
`git status --short`は空で、repo変更はなかった。

初回Reportの`claims`はobject配列で、Control exact schemaが要求するstring配列に違反していた。親はimportせず、
同じRun／agentへschema correctionを返した。子は4件のbounded stringへ修正し、claims canonical JSONのSHA-256を
result digestとして再計算した。親の独立再計算も`7606d702...`で一致し、3 validationは全件passed、
`changed_paths=[]`だった。Controlのstrict `worker-report-import`はrevision 11で成功した。

## Decision

1. 最終ReportとRun resultを親acceptする。初回schema違反は隠さず、本ADRへ実行上のreworkとして残す。
2. 次のexact executor envelopeを、現sessionの期限付きRegistry observationで`execution-verified`として扱う。
   - adapter: `codex-native`
   - contract: `v1`
   - instance: `current-parent`
   - handle schema: `codex-native.agent-path.v1`
   - workflow: `native-subagent`
3. このstageが証明するのは、routing済みagentへPacketを渡し、実Taskを完遂し、相関済みstructured reportを
   回収し、schema failureへ同一Runのfollow-upで収束できることまでである。
4. `workspace.write` capabilityはrouting observationとTask Packetで別に要求し、実効sandboxがscopeを強制すると
   主張しない。write Taskは専用detached worktree、非交差write scope、Control admission、親のdiff／focused test
   acceptanceを引き続き必須とする。
5. RC1-B／RC1-Cは、新しいexecution-verified observationを参照するplacement dry-runが
   `eligible / reasons=[]`になった場合だけdispatchする。

## Rejected alternatives

- 初回Reportを親が黙って正規化する: Worker Reportの責任主体とrework証拠が失われる。
- strict import成功だけで内容をacceptする: schema相関と研究findingの正しさは別なので、親の実読とdigest再計算が必要。
- read-only実行からsandbox強制まで証明したと扱う: 書込隔離の実測ではなく、能力境界を過大主張する。
- execution verificationを工場全体または将来sessionへ恒久一般化する: registryは期限付きのexecutor observationである。

## Consequences

- `codex-native` write配置に必要なControl stageを、routing smokeではなく実Taskの完遂・回収で満たせる。
- 初回Report schema違反による1回のreworkを介入費へ数える。
- write Taskの正しさ、scope遵守、test greenは各Runのparent acceptanceまで未証明のまま残る。
- dotagentsとObserver関連repoはread-onlyのままで、Lattice以外へwriter scopeを広げない。
