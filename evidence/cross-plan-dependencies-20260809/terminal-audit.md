# plan跨ぎ依存 終端監査資料

## 対象

- plan: `cross-plan-dependencies-20260809`
- topology digest: `cf97f3bfa73d37d72ebf27614f30a354b9e989248900e79d58854cf20a14d710`
- cp1 source / done: `7fbc063` / `101fcb0`
- cp2 source / done: `963d27a` / `ab87bc4`
- cp3 source / done: `a52b64b` / `1df3176`
- cp4 source / done: `8cf3bed` / `389bbbe`
- CI修正: `1faee295c1d316fd1028157af824e4734654ba8c`

各ToDoの実装・局所検証・受入観測は同ディレクトリの`cp1.md`から`cp4.md`に固定した。

## store整合

`node bin/lattice.mjs todo verify --plan cross-plan-dependencies-20260809 --json`を実行した。

- exit: 0
- journal head: `25429c6ec2f38c9d5bf4a9ce730e2ffabce9275b5703b088a7220eaa1b975f62`
- through sequence: 8
- snapshot stale: false
- result digest: `958b6d7d88fa5b3b4523e1dff1a1fdcd77a66bef1df581e7c1308f992dcc1de1`

全4 ToDoはdoneで、phase-less planの終端監査は`gate_ready`である。

## 自動検証

cp4完了後のcross-plan全経路と既存plan内依存のfocused regression:

```text
LATTICE_DASHBOARD_AUTOSTART=0 node --test \
  test/integration/todo-cross-plan-dependency.integration.mjs \
  test/todo-cross-plan-dependency.test.mjs \
  test/todo-cross-plan-status.test.mjs \
  test/todo-ready-frontier.test.mjs \
  test/todo-status.test.mjs \
  test/todo-store.test.mjs \
  test/todo-gantt-cross-plan.test.mjs \
  test/todo-gantt-layout.test.mjs \
  test/todo-gantt-nested.test.mjs \
  test/todo-gantt-scope.test.mjs \
  test/todo-gantt-render.test.mjs
tests 152 / pass 152 / fail 0

npm run check
syntax check passed: 150 files
```

完全gate `npm run ci` の初回実行は、開始時HEAD `389bbbe` でproduct test 1550件中2件が失敗した。

- `test/todo-cli.test.mjs`: start助言のexact key期待だけが現行契約の
  `scope_expansion_recommendations`を欠いていた。期待を1行更新して`1faee29`へコミットした。
- `test/runtime-work-order-controller.test.mjs`: private regular file待機の時間依存失敗だった。
  同fileを修正なしでfocused再実行し、2回連続greenを確認した。

修正後は次を実行してgreenだった。

```text
node --test test/runtime-work-order-controller.test.mjs test/todo-cli.test.mjs
tests 27 / pass 27 / fail 0

npm run check
syntax check passed: 150 files
```

その後、cleanな完全SHA `1faee295c1d316fd1028157af824e4734654ba8c` から`npm run ci`を再実行した。

- exit: 0
- product test: 1550 / pass 1550 / fail 0
- sensor test: green
- syntax/static check: green
- CLI surface check: green
- open questions check: green
- reachability check: green
- todo store verify: green

## 実ブラウザ受入

cp3とcp4で別々の一時repoを使い、公開CLIと実ブラウザで受け入れた。

- plan跨ぎedgeはproducer/consumerの`project_id`・`plan_key`・`task_id`完全identityで1本だけ描画された。
- producer未完了時、consumerはpendingでも先行着手済みin-progressでも入力待ちとして表示された。
- producer完了後、ブラウザを開いたままSSE更新だけでproducer cardが完了へ変わり、consumer詳細の前提工程も完了へ変わった。
- CLI statusでも同じ更新によりconsumerの`unmet_dependencies`が空になった。
- browser tabとserve processを終了し、一時repoをTrashへ移して元pathの不存在を確認した。

## 監査者への確認点

実装者りんは終端Phaseのreview/acceptを行わない。独立監査では、cp1からcp4のsource diff、上記の
store headとCI SHA、ready解錠、Gantt live更新を再確認し、findingが無い場合だけevidenceを束縛して
acceptする。
