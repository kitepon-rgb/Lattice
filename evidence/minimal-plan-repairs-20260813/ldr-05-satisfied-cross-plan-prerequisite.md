# ldr-05-satisfied-cross-plan-prerequisite

## 実施内容

既存の `cross_plan_dependency` event を再利用し、完了済みsourceから未完了targetへの後付け依存を受理するようにした。sourceの完了記録が前提充足の証拠となるため、新しい証拠台帳や完了状態の不変化機構は追加していない。target完了時の拒否、topology binding、重複、cycleの検証は維持した。

## 変更ファイル

- `src/todo-store.mjs`
- `test/todo-cross-plan-dependency.test.mjs`
- `evidence/minimal-plan-repairs-20260813/ldr-05-satisfied-cross-plan-prerequisite.md`

## 最終試験

```text
ln -s ../lattice-test-result-20260813/node_modules node_modules && node --test test/todo-cross-plan-dependency.test.mjs test/integration/todo-cross-plan-dependency.integration.mjs
```

結果: 終了コード0、6 tests passed、0 failed。worktreeへ依存をinstallせず、既存の隣接worktreeのnode_modulesを一時参照し、試験後にsymlinkを削除した。

確認内容:

- 完了済みsourceを前提としてcross-plan dependencyへ接続できる。
- 接続後も未完了targetはpendingのままで、不必要にblockされない。
- 完了済みconsumerは従来どおり拒否される。
- 通常のcross-plan接続、重複、stale binding、cycle、公開CLI、Gantt／解錠integrationがgreenである。
