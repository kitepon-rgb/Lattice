# Lattice

Latticeは、codebaseの境界を観測・変換し、multi-agent開発の並列TODO graphを生成する
schedulability compilerです。

現在はbootstrap段階です。実装状況は[docs/plan_lattice_rc4_dotagents_dogfood.md](docs/plan_lattice_rc4_dotagents_dogfood.md)、製品思想は
[PLAN.md](PLAN.md)、公開予定contractは[docs/00_product-contract.md](docs/00_product-contract.md)を参照してください。

## 開発

```bash
npm test
npm run check
npm run ci
codegraph status .
spotter doctor
codex-sidecar diagnostics --project . --preset auditor --json
```

Node.js 22.13以上を使用します。CodegraphとSpotterはproject単位で初期化し、生成stateの所有境界を守ります。

TODO工程storeの読取は`lattice todo status`、検証は`lattice todo verify`、表示生成は
`lattice todo gantt`を使います。状態を書き込む`start / block / unblock / done / evidence promote / reopen`
では、監査actorとして次の3環境変数をすべて設定してください。

```bash
export LATTICE_TODO_ACTOR_HOST=<host-id>
export LATTICE_TODO_ACTOR_SESSION=<session-id>
export LATTICE_TODO_ACTOR_AGENT=<agent-id>
```

正確なargv、evidence descriptor、result wireは
[ADR 0056](docs/adr/0056-todo-authoring-transitions.md)を参照してください。
