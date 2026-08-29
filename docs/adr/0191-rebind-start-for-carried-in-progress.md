# ADR 0191: carryされたin-progress ToDoの再束縛入口 `todo start --rebind`

- status: accepted
- date: 2026-08-29

## 文脈

runtime intake（pull run）は、現plan_versionのjournalにある同一actorのliteral start
eventだけをstart束縛として受け、reopen/carry/importからの推定はしない（設計意図）。
plan reviseでin-progress ToDoをcarryすると、start束縛は旧version側に残るため、
改訂後のrunへのintakeは`TASK_START_BINDING_UNSUPPORTED`で恒久に拒否される。
一方タスクは既にin-progressなので`todo start`も打てず、**改訂を跨いだ進行中工程の
正規再開経路が存在しなかった**（実被弾 2026-08-29: evidence-2改訂後、担当席が
recollect-breadthを再開できず憲法どおり停止を宣言、卓が停止した）。

## 決定

`lattice todo start --plan <key> --task <id> --rebind --reason <text>` を追加する。

- in-progressのタスクにだけ適用でき、pending等は`TASK_START_BINDING_UNSUPPORTED
  (rebind_requires_in_progress)`で拒否する
- task状態・開始時刻は変えず、現plan_version・現actorのstartイベント
  （`start_mode: "rebind"`）をjournalへ積み、start束縛だけを更新する
- 推定はしない——束縛の更新は常にこの明示コマンドによる
- advisory・independence gateは初回startで済んでいるため再適用しない

## 帰結

- v0.67.5で出荷。focused test（start→revise carry→rebind成功／pending拒否）を追加
- 改訂を跨ぐ再開の席側手順: `todo start --rebind` → `run intake`
