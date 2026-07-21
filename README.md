# Lattice

Latticeは、codebaseの境界を観測・変換し、multi-agent開発の並列TODO graphを生成する
schedulability compilerです。

現在の工程状態と完了証拠の正本は、このrepoのLattice storeです。文書の役割と現行導線は
[docs/README.md](docs/README.md)、製品思想は[PLAN.md](PLAN.md)、公開contractは
[docs/00_product-contract.md](docs/00_product-contract.md)を参照してください。

CLIの全体像は`lattice --help`、各公開namespaceの正規構文は
`lattice <plan|run|event|todo|sensor|factory-diagnostics|runtime-errors> --help`で確認できます。
個別操作は`lattice <namespace> <subcommand> --help`または`lattice help <namespace> <subcommand>`で
正規optionをstore非依存に確認できます。

## 開発

```bash
npm test
npm run check
npm run ci
lattice sensor sync . --json
spotter doctor
codex-sidecar diagnostics --project . --preset auditor --json
```

Node.js 22.13以上を使用します。境界観測は配布物に同梱したLattice sensorだけを使い、PATH上の
廃止済みruntimeや旧cache/dataへfallbackしません。Spotterはproject単位で生成stateの所有境界を守ります。

どのrepoでも、Latticeの導入状態はdirectoryの有無を推測せず、最初に次のtyped discoveryで判定します。

```bash
lattice status --json
```

`state`は`uninitialized | ready | active_run | invalid`のいずれかです。`uninitialized`は
正常な未初期化状態で、`next_action`が正規の初期authoring入口を返します。初回planは
新規planはPhase監査とToDo schedulingを分離する`lattice.plan_create_input.v3`のcanonical
JSON+LFを用意し、次で作成します。既存v2/v4は互換契約として維持されます。

```bash
lattice plan create --schema-version 3 --json
```

```bash
lattice plan create --input .lattice/plan-create.json
```

`invalid`をMarkdown fallbackへ丸めず、`next_action`に従ってstoreを診断してください。
discoveryと初期transactionの不変条件は
[ADR 0058](docs/adr/0058-project-discovery-and-initial-authoring.md)が正です。

TODO工程storeの読取は`lattice todo status`、検証は`lattice todo verify`、表示生成は
`lattice todo gantt`を使います。topology/source reconciliationは
`lattice todo revise --plan <key> --input <canonical-revision.json>`、Phase付きplanは
`lattice todo revise-phase --plan <key> --input <canonical-phase-revision.json>`でsuccessor発行します。
cross-plan topologyを同時に切り替える場合は
`lattice todo revise-set --input <canonical-revision-set.json>`を使い、Phase revisionを含む集合は
`lattice.todo_revision_set.v3`で通常revisionと混在できます。
Phase付きv5 planでは、通常ToDoの開始順はToDo DAGだけで決まり、Phase前後関係は重監査の順序だけを
制御します。特定ToDoがPhase受理を本当に必要とする場合だけ`phase_accept_dependencies`で明示します。
`lattice todo status --json`の`dispatch_frontier`はready全件を同時dispatchする既定を示します。
readyが複数なら最初のstartに`--parallel-frontier`を付け、subsetだけを直列着手する場合は
`--override-reason <reason>`で理由を残します。

```bash
lattice todo start --plan <key> --task <id> --parallel-frontier
lattice todo start --plan <key> --task <id> --override-reason <reason>
```

`--parallel-frontier`はhostへ並列dispatch方針を宣言する開始gateです。Lattice自身がAI hostのagentを
起動するものではなく、実際のdispatchはhostが行います。宣言後もready全件が着手されたかは
`active_set`と`next_ready`で観測できます。
ToDo完了は軽量確認までで、所属ToDoが全てdoneになったPhaseは`gate_ready`となり、`todo phase review`後に
required evidenceを束縛した`todo phase accept`で重監査の判断を記録します。監査回数やPhase数を自動追加する
機能ではありません。Phase状態は
`lattice todo phase status --plan <key>`、閲覧中に進捗が更新される工程表は
`lattice todo gantt serve --port 0`で確認できます。live viewerはloopback-only、read-onlyで、
`/projects/<project_id>/`というproject固有URLを返します。別projectからそれぞれ起動すれば、独立port・独立SSE経路で同時表示できます。
静的工程表は`lattice todo gantt status`で`current / stale / missing`を確認でき、HTMLまたは
digest付きsidecarの欠落・改ざんはtyped failureになります。
状態を書き込む`start / block / unblock / done / evidence promote / reopen / revise / revise-phase / revise-set`
では、監査actorとして次の3環境変数をすべて設定してください。

```bash
export LATTICE_TODO_ACTOR_HOST=<host-id>
export LATTICE_TODO_ACTOR_SESSION=<session-id>
export LATTICE_TODO_ACTOR_AGENT=<agent-id>
```

正確なargv、evidence descriptor、result wireは
[ADR 0056](docs/adr/0056-todo-authoring-transitions.md)を参照してください。
