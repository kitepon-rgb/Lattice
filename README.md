# Lattice

Latticeは、codebaseの境界を観測・変換し、multi-agent開発の並列TODO graphを生成する
schedulability compilerです。

現在の工程状態はdotagents Lattice storeの`lattice-factory-integration` plan、RC4完了記録は[docs/archive/plan_lattice_rc4_dotagents_dogfood.md](docs/archive/plan_lattice_rc4_dotagents_dogfood.md)、製品思想は
[PLAN.md](PLAN.md)、公開予定contractは[docs/00_product-contract.md](docs/00_product-contract.md)を参照してください。

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
Codegraph runtimeや旧cache/dataへfallbackしません。Spotterはproject単位で生成stateの所有境界を守ります。

どのrepoでも、Latticeの導入状態はdirectoryの有無を推測せず、最初に次のtyped discoveryで判定します。

```bash
lattice status --json
```

`state`は`uninitialized | ready | active_run | invalid`のいずれかです。`uninitialized`は
正常な未初期化状態で、`next_action`が正規の初期authoring入口を返します。初回planは
`lattice.plan_create_input.v2`のcanonical JSON+LFを用意し、次で作成します。

```bash
lattice plan create --schema-version 2 --json
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
Phase付きplanではToDo完了は軽量確認までで、`todo phase review`後にrequired evidenceを束縛した
`todo phase accept`が成功するまで後続Phaseを解放しません。Phase状態は
`lattice todo phase status --plan <key>`、閲覧中に進捗が更新される工程表は
`lattice todo gantt serve --port 0`で確認できます。live viewerはloopback-only、read-onlyです。
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
