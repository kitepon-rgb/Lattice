# companion-atomic-repair-edge 証跡

## 実施

- 新commandは追加せず、既存の`lattice todo migrate --input <repo-relative-extraction.json>`が公開済み`lattice.todo_extraction.v3`と新しいv4を受理する。v3の理由付きcross-plan hard dependency契約は維持し、v4だけにconnection-onlyとcross-plan edge高々一件を追加した。
- 新planを伴う入力は、plan artifactとtarget plan-scoped edgeを同じtransactionにstageする。未完transactionはreadで成功表示せず`STORE_RECOVERY_REQUIRED`を返し、同じ入力のretryだけがpre-activationのartifact削除またはmanifest可視transactionのedge確定を一度だけ行う。
- v4の`tasks: []`かつ既存planをsourceとする一件のcross-plan hard dependencyは、同じtyped入口で新planを作らずtarget edgeだけをatomic writeする。既存の存在・方向・terminal・cycle検証を再利用した。
- process停止で残る`.write.lock`は、上記二つのcross-plan writerだけがPID付きlockと一意なrecovery claimで回収する。live claimのうち作成時刻が最古の一つだけをleaderとし、owner停止で残ったclaimは次のretryが除去する。leaderはlockを再読しdead PIDを確認してから置換し、競合者は`STORE_WRITE_CONFLICT: store_locked`となる。通常writerは従来どおり空lockの取得だけである。
- migrate resultは`lattice.todo_migrate_result.v4`へ上げ、通常移送も`companion: null`を常在させた。companion接続時はrepair、target、reason、接続後frontier、次の操作を同fieldへ返す。dry-runは`lattice.todo_migrate_dry_run_result.v2`で、normal／connection-onlyを`connection_only` booleanで区別する。

## 最終試験

worktree内で次を実行し、すべて成功した。

- `node --test test/todo-migration-companion.test.mjs` — 20/20 pass。v3 reasoned cross-planの維持、v4 normal／companion／既存task-only、v1/v2のactual・dry-run拒否、marker durable前の停止、visible activation rollback、transaction durable以後の四つの新plan crash stage、connectionOnlyの停止前後、recovery claim owner停止後の再retry、二者同時stale-lock回収を含む。
- `node --test test/todo-migration.test.mjs test/todo-store.test.mjs test/todo-cross-plan-dependency.test.mjs test/todo-cli-schema-command.test.mjs test/todo-design-memo.test.mjs test/plan-scope-review.test.mjs` — 117/117 pass。
- `npm run check` — syntax check 171 files pass。
- `git diff --check` — pass。

worktreeに依存をinstallせず、canonical repoの既存`node_modules`を試験中だけ一時symlinkして実行した。試験後にsymlinkは撤去した。

## 変更ファイル

- `src/todo-migration.mjs`
- `src/todo-store.mjs`
- `src/todo-cli.mjs`
- `src/plan-scope-review.mjs`
- `docs/schemas/lattice.todo_extraction.v4.schema.json`
- `docs/01_integration-package.md`
- `docs/todo-extraction-v1.md`
- `test/todo-cli-schema-command.test.mjs`
- `test/todo-design-memo.test.mjs`
- `test/todo-migration.test.mjs`
- `test/todo-migration-companion.test.mjs`
- `evidence/minimal-plan-repairs-20260813/ldr-06-companion-input-scaffold.md`
- 本証跡ファイル

共有作業中の`.lattice`状態ファイルは対象commitへ含めない。
