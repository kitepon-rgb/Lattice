# Phase `lattice-codegraph-removal` fresh dogfood と full gate

- 対象: plan `phase-control-live-gantt` / revision `rev-aaf251c169b577e1b85dbf35`
- 実施日: 2026-07-25
- 実施commit: `5ad3fb8`（= `origin/main`）
- 使用成果物: registry公開版 **@quolu/lattice 0.12.11**（repo内のdev buildではない）

## 1. fresh dogfood

旧dataを持たないrepoに対し、公開版をclean installして工程管理を一周させた。

### 環境

```
npm init -y && npm install @quolu/lattice@0.12.11 --prefer-online
node node_modules/@quolu/lattice/bin/lattice.mjs --version  -> 0.12.11
target: aishellのfresh clone 657 files、.lattice を削除して旧data無しにした
```

### typed discovery（未初期化 → ready）

```
lattice status --json
  state: "uninitialized"
  can_create_plan: true
  next_action.command: "lattice plan create --input .lattice/plan-create.json"
  next_action.input_schema: "lattice.plan_create_input.v3"
```

`plan create --schema-version 3 --json` がJSON Schemaを返し、それに沿って作成した入力で
`plan create` が成功。直後の `status --json` は `state: "ready"` / `active_plans: 1` へ遷移した。
**未初期化projectの入口が、返された`next_action`だけで閉じることを確認した。**

### sensor（Lattice所有）

```
lattice sensor init . --json  -> {"provider":"lattice","sensor_owner":"lattice",
                                  "sensor_version":"0.7.3-lattice.1","status":"ok"}  real 6.22s
lattice sensor sync . --json  -> status ok
```

### 工程の進行

`d-001 -> d-002 -> d-003 -> d-004` の直列planを作り、d-001〜d-003をevidence付きでdoneにした。
`next_ready` が `[d-001]` → `[d-004]` へ正しく前進した。

### 工程図の表示縮退（本waveの新機能）

生きた工程が残っている状態での既定表示:

```
plan: d-001(done) -> d-002(done) -> d-003(done) -> d-004(pending)

--scope live (既定) : 描画3 node、folded_task_count=2
                      描画されたtask_id: d-003, d-004, ~folded:0
--scope all         : 描画4 node、folded_task_count=0
```

**生きた工程 `d-004` と、その直接の前提 `d-003` は展開したまま残り、
その先の死んだ枝 `d-001`・`d-002` だけが1つの畳み込みノードへ入る。**
設計どおりの挙動を、公開成果物・fresh環境・生きたplanで確認した。

Lattice自身のstore（35 ToDo全done）では `--scope live` が 4 node / folded 35、
`--scope all` が 35 node / 37 edge。総数表示は `35 ToDo` のまま保たれる。

### dogfoodで拾った使い勝手の指摘（欠陥ではない）

`todo done --plan <key> --task <id> --evidence <file>` の `--evidence` は、
成果物そのものではなく **evidence descriptorのJSON**（`evidence_id` / `repo_id` / `path` /
`git_blob_oid` / `content_digest` / `media_type` / `anchor_digest`）を要求する。
生ファイルを渡すと `INVALID_JSON / json_parse_failed` になる。`--help` の記載
（`--evidence <file>`）からはこの区別が読めない。動作は仕様どおりで欠陥ではないが、
初見での躓きどころとして記録する。

## 2. full gate

```
$ npm run ci
  product tests : ℹ tests 723 / pass 723 / fail 0
  sensor tests  : Test Files 139 passed | 3 skipped (142)
                  Tests 2192 passed | 37 skipped (2229)
  check         : node --check 全対象 通過
  check:project-identity : 通過
  exit = 0
```

commit `5ad3fb8`（`origin/main` と一致、working tree clean）で取得。

## 3. release smoke（公開版・global install）

```
registry : 0.12.11    global CLI : 0.12.11
```

- 工程図 既定: 4 node / folded 35 / renderer `lattice.todo_gantt_renderer.v9`
- 工程図 `--scope all`: 35 node
- `gantt status`（`--scope all`生成物）: `current`（scope違いによる誤stale無し）
- carried done `reopen`: 成功
- `todo status --json | head`: writerExit=0 ×3
- 通常実行のJSON出力: 無傷

## 4. 本記録が担保しない範囲

- dashboard自動起動（lpg-033）とsetup wizardのport排他bind（lpg-034）は再実行していない。
- 公開URL `lattice.kitepon.dev` の到達性は **本日時点で502** であり、
  別紙 `2026-07-25-phase-control-live-gantt-adversarial-review.md` の第3節に原因と切り分けを記載した。
  本dogfoodはlocalhost／LAN内で完結しており、公開経路の到達性は含まない。
