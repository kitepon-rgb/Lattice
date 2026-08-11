# co2 bpr6退役記録

- `bridge-persistence-recovery`を`rev-83d2c41d5f7cd5d57810bb0b`へ改訂。
- `bpr6-offline-notice`をsource cutoverで除外し、`bpr5-fox-install`を含む他の生きた工程は保持。
- canonical revisionを`node bin/lattice.mjs todo revise`で受理。
- focused revision/CLI tests: 69件成功。
- 設計メモの指示どおり、インストール版CLIではなくsource treeのCLIを使用。
