# 持ち越し欠陥①③の修理（todo-cli.mjs）

P0障害対応（commit 29b69a3付近）で発見した4件の持ち越し欠陥のうち、①INTERNAL_FAILURE
詳細欠落と③verify事前フック死をtodo-cli.mjsで修理した。②stable-readのSTORE_BUSY隠蔽は
tsumugi(commit 301219b)、④gantt serveの失敗固着もtsumugi(commit e33442c、着手範囲)。

## 修理内容

### ①INTERNAL_FAILURE詳細欠落

`runTodoCli`内3箇所（`--schema --json`早期パス・`dashboard remove`早期パス・メイン
dispatchの汎用catch）が、typed error以外の予期しない例外を全て
`{code:'INTERNAL_FAILURE', message: error?.constructor?.name ?? 'Error'}`——
つまりconstructor名だけ（例:「Error」）に丸めており、実際のerror.messageもstackも
失われていた。P0障害の最初の兆候（`todo start`が`{"code":"INTERNAL_FAILURE","message":"Error"}`
としか返さず、実因(manifest_journal_head_mismatch)を掴むのにtodo-store.mjsを直接
importして手動でreadTodoStoreを叩く必要があった）はこれが直接原因。

共通helper `internalFailure(stderr, error)` を追加し3箇所を統一: `message`は
`error.message`（無ければconstructor名にfallback）、`detail`に`error_name`と
stackの先頭6行（`stack_excerpt`）を含める。ローカルCLIの自分のstderrであり、
untrusted audienceへ晒す応答面ではないため、実message・stackを出すことに
セキュリティ上の懸念はないと判断した。

### ③verify事前フック死

`runTodoCli`のメインdispatchが`gantt`/`dashboard adopt`/`migrate --dry-run`を除く
**全todoサブコマンド**の実行前に`ensureActiveProjectDashboard`（`readTodoStoreStable`を
内部で呼ぶ）を無条件で呼んでいた。storeがmanifest/journal不整合になると、この事前フックが
先に`STORE_BUSY`で落ち、`todo verify`——store不整合を診断するために存在する
read-onlyコマンドそのもの——が、まさに自分が診断すべき状況で到達不能になっていた
（P0障害で実際に踏んだ）。

`verify`を`gantt`/`dashboard adopt`/`migrate --dry-run`と同じ除外リストへ加えた。
`verify`はdashboard登録という副作用を必要としない診断コマンドであり、既存の除外3件と
同じ理由（この前提条件はコマンド自体の仕事と無関係）で除外する設計が一貫している。

## 検証

- `node --test test/todo-cli.test.mjs`: 25/25 green（この環境=WSL/drvfsは
  spawnSyncベースのtestが1件あたり数秒〜93秒かかり合計432秒——累積的に遅いだけで
  タイムアウトではない。個別test実行で確認済み、初回のtimeout 60/150/300sは
  この累積時間に届いていなかっただけと判明した）。
- `node --test test/todo-cli-schema-command.test.mjs`: 7/7 green。
- `node scripts/check-syntax.mjs`: green（159 files）。
- `node scripts/verify-product-reachability.mjs`・`verify-cli-surface.mjs`: green。

## commit対象

`src/todo-cli.mjs`・`evidence/bridge-hub/carryover-defects-1-3.md`。
