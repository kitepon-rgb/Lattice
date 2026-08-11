# co3-plan-status 実施記録

- `plan_carry-removal-retirement.md`: 0.57.3 の公開と Mac／WSL2 配布実測まで完了した実態へ Status を更新。
- `plan_bridge-persistence-recovery.md`: 未了は FOX のオーナー対話 logon を要する `bpr5-fox-install` だけなので、Status を Blocked として理由を明記。
- `plan_bridge-hub.md`: store の固定 `v1` 表記を除き、active version は store が選ぶこと、初期 ToDo の原本は `docs/archive/plan_bridge-hub_tasks.md` にあることを記録。

## 検証

`node bin/lattice.mjs todo verify --plan bridge-hub --json` は reconciled（active 4、tombstone 3）、
`node bin/lattice.mjs todo verify --plan bridge-persistence-recovery --json` は reconciled（active 7、tombstone 1）。
