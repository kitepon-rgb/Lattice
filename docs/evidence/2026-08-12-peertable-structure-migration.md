# Peertable logical_dataflow.v0 → ToDo structure v1 移行証拠

- Date: 2026-08-12
- Task: sg14
- Source fixture: `test/fixtures/todo-structure/peertable-logical-dataflow-v0.json`
- Scope: 秘密除去済みfixtureだけ。Peertable live repo、room、credential、絶対pathは未使用

## 変換結果

- 未完了ToDo 16件をplan境界ごとのstructure set 9本へ変換した。
- `outcome`、`receives`、`organizes`、`emits`、`failures`、`first_live_e2e`、`non_goals`を
  v1のoutcome、constant input、operation、final product output、失敗、初回実測、非目標へ移した。
- v0にはcode path／symbolが無い。推定で埋めず、16件全てを
  `logical_dataflow_v0_has_no_code_path_or_symbol`として列挙し、v1 `code_anchors`は空にした。
- 全9 setがruntimeの`explainTodoStructureSet`を通過した。

## finding位置と収束

`peertable-task-announcements-20260811`の`a2 → a3`へ意図的に次を入れた。

- ToDo hard dependency欠落
- producer `task-started-v1`／consumer `task-completed-v1`のshape不一致

compilerは`STRUCTURE_DEPENDENCY_MISSING`を`a2`・`a3`へ、
`STRUCTURE_CONTRACT_MISMATCH`を`a2/emit-01`・`a3/announcement-in`へ束縛した。
hard dependencyとconsumer shapeを修正するとplannedは`consistent`へ収束した。

さらに`a2`へrealizationとcommit provenanceを与え、done状態でfinal overlayを再compileした。
最終verdictは`consistent`、`task:a2`は`realized`、data sinkは`task:a3`を指した。

## 実測

`node --test test/todo-structure-fixture.test.mjs`: 4/4 green。
