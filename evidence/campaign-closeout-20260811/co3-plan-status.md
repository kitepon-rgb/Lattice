# co3-plan-status 実施記録

- `plan_carry-removal-retirement.md`: 0.57.3 の公開と Mac／WSL2 配布実測まで完了した実態へ Status を更新し、ADR 0167のAccepted状態と完了ToDoを反映。
- `plan_bridge-persistence-recovery.md`: 公開面は永続PTYで復帰済みであり、未了は`bpr5-fox-install`のregistry install切替だけである実態へ更新。通常SSHと永続PTYを区別し、訂正済みの「オーナー対話logon待ち」を除去。
- `plan_bridge-hub.md`: 完了状態を反映。store の固定 `v1` 表記を除き、active version は store が選ぶこと、初期 ToDo の原本は `docs/archive/plan_bridge-hub_tasks.md` にあることを記録。

初回commit `b3c9ea78` は、store noteで訂正済みの「オーナー対話logon待ち」を再掲したため未受理とした。
sequence 9でreopenし、note `b8843ad9` の実測（永続PTYで公開面復帰、残件はregistry install切替）へ合わせて訂正した。

## 検証

`node bin/lattice.mjs todo verify --plan bridge-hub --json` は reconciled（active 4、tombstone 3）、
`node bin/lattice.mjs todo verify --plan bridge-persistence-recovery --json` は reconciled（active 7、tombstone 1）。
