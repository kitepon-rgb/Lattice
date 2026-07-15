# RC1 native execution verification contract

- Date: 2026-07-15
- Control: `lattice-rc1-closed-loop-v3`
- Task ID: `RC1-X-native-execution-verification-v3`
- Assignment ID: `RC1-X-native-execution-verification-assignment-v3`
- Agent path: `/root/rc1_codegraph_adapter`
- Classification: A
- Effect: read-only
- Role: implementer

## Objective

RC1-Bの実装を始める前に、固定済みCodegraph adapter契約、query set、fixture preflightを実読し、
実装者が一意に解釈できない矛盾、未定義のtyped outcome、検証不能な受入条件があるかを監査する。
指摘がなければ、読んだ範囲と反証した候補を示して`ready`と報告する。価値のないrouting echoだけを返さない。

## Read scope

- `AGENTS.md`
- `PLAN.md`
- `docs/00_product-contract.md`
- `docs/plan_lattice.md`
- `docs/evidence/2026-07-15-rc1-implementation-boundaries.md`
- `docs/evidence/2026-07-15-rc1-fixture-boundary-preflight.md`
- `research/campaigns/rc1/inputs/query-set.json`
- `research/fixtures/dispatch-record/src/dispatch-record.mjs`
- `test/research-dispatch-record.test.mjs`

## Write scope

なし。repo、worktree、Codegraph index、git stateを変更しない。Worker Reportは親が指定するrepo外の一時pathだけへ返す。

## Required result

structured Worker Reportに次を含める。

1. `ready`または`needs-correction`の結論。
2. 実読した契約とfixtureのpath。
3. 実装を誤らせる具体的な矛盾／不足。なければ、検討して棄却した反対仮説。
4. `exit 0`非JSON、empty query、empty affected tests、stale／unresolvedの扱いがfail-loudかの確認。
5. repoを変更していないことと、実行したread-only command。

## Success conditions

- Delegation PacketとWorker ReportのTask／Run／assignment／operation digestが一致する。
- reportがschema validationを通り、親が回収・実読・acceptanceを記録できる。
- `git status --short`のTask前後差分が0である。
- 指摘は実ファイルの矛盾、論理破綻、非検証可能な条件に限定し、価値判断やscope縮小を混ぜない。

## Non-goals

- RC1-Bを実装しない。
- test、formatter、Codegraph mutation commandを実行しない。
- dotagents、Observer関連repo、他のLattice fileを編集しない。
- routing smokeをexecution successとして再報告しない。

このfile全体のSHA-256をWorker Runの`operation_digest`とする。結果は別evidenceへ保存し、この契約fileは変更しない。
