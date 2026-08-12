# cpe-01 実装証跡

## 対象

stale になった Peertable の `u1 → a6` cross-plan edge 1 本を、旧 journal の
bytes を変更せず append-only の rebind event で現在の source topology に再束縛する。
今回の受入範囲は、旧 event の endpoint/digest 一致、source topology の更新、effective
edge が 1 本であること、store status の再読可否に限定した。revision `next_action` や
広い negative case は対象外とした。

## 実装

- `cross_plan_dependency_rebind` event を追加し、旧 event と旧 endpoint/topology を
  `supersedes` / `previous_from` / `previous_to` に保持する。
- rebind 中だけ、指定された旧 event と endpoint に一致する stale binding を読み取りで
  許容し、それ以外の stale binding は従来どおり拒否する。
- 公開 CLI に `todo dependency rebind` を追加し、rebind receipt と frontier 差分を返す。
- gantt の effective projection でも superseded event を除外する。
- bell の実適用で判明した公開 CLI の入口不足を補うため、`TODO_COMMAND_NAMES` に
  `dependency` を追加した。

## focused test

次のテストを実行し、すべて成功した。

```text
node --test test/todo-cross-plan-rebind.test.mjs
  3 passed, 0 failed

node --test test/todo-cross-plan-dependency.test.mjs test/todo-cross-plan-rebind.test.mjs test/todo-store.test.mjs
  78 passed, 0 failed

node --test test/todo-gantt-cross-plan.test.mjs test/todo-gantt-nested.test.mjs
  10 passed, 0 failed

node --test test/artifact-contracts.test.mjs test/cli-help.test.mjs test/todo-revision.test.mjs test/todo-revision-set.test.mjs
  29 passed, 0 failed
```

`git diff --check` も成功した。

## 実 Peertable smoke

bell の room 報告 [996] により、同じ worktree の source CLI から Peertable store へ
実適用されたことを確認した。対象は次の event と topology である。

```text
old event:
9224f85fee0edb7bc55fb2b41aed54c26c18f0008741b30358458f19f0a8da6
old source topology:
fb65fc35c79687a76bbf9edfd659f41155ee616999189dfed46dbe9641acef51
current source topology:
16cd9906a4c6a588df1b358cc0a62cec17cc3fb986e307aad0151d91019f4654
target topology:
f416f8751d31e9cbec482ef10f556a656b7ffe7b5d7b20b82cff125f9b5a2b43
revision:
rev-1fa4743088866f37c40f106b
```

smoke の結果は、旧 event `9224f85f…da6c` を supersede する新 event
`4fc03425…1ab3` が append され、effective edge は `u1 → a6` の 1 本、store status は
復旧し、その後 `u1` を Lattice で done にできた、というものだった。旧 journal event を
書き換えずに status を読める状態へ戻せたことが受入条件を満たす。

## 変更境界

Peertable 本体および Peertable store はこの席から変更していない。実適用は bell が
Peertable 側で行った。revision `next_action` などの拡張は実装していない。
