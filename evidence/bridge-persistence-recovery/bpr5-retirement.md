# bpr5-fox-install 退役記録

## 裁定

2026-08-11、オーナー裁定により`bpr5-fox-install`をLattice製品工程から退役した。

- FOX固有のinstall、更新、junction／registry選択、Startup配線、rollbackはdotagentsの工場展開が所有する。
- これはLattice全ユーザー向けの製品機能ではなく、Lattice側に残すと同じ端末運用を二重管理する。
- Lattice側の一般製品要件であるWindows常駐設定、自己修復、診断、registry配布物はbpr1〜bpr4で完了済み。
- FOXの設定変更、registry install、常駐再起動は本退役作業では実施していない。

## 工程変更

- revision: `rev-91e53aa5c3abca2ff79c789b`
- revision digest: `471bb07a63c3f65fdd0b1db92042b1cf7ee6aa37f79fd062f23544b672e5b59d`
- `bpr5-fox-install`のtask migrationを`removed`とした。
- active taskは6件、excluded tombstoneはbpr5・bpr6の2件。

## 検証

- `node --test test/todo-revision-writer.test.mjs test/todo-revision.test.mjs test/todo-cli.test.mjs`: exit 0。
- `node bin/lattice.mjs todo verify --plan bridge-persistence-recovery --json`: reconciled、snapshot staleなし。
- `node bin/lattice.mjs todo status --json`: active、ready、blockedはいずれも0。
- `git diff --check`: 成功。
