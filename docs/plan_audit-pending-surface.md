# 監査待ちPhaseを「次アクション面」へ一級で表出する

Lane: Orchestrated（多段の受入連鎖・複数repo書込調整・裁定証跡）
状態と依存の正本はLattice store（plan key `audit-pending-surface`）。本書は散文だけを持つ。

## 背景

全Lattice管理projectで、Phase終端の終端監査をAIが高頻度で失念する。原因は規範でも注意力でもなく、
statusの応答構造にある。

終端監査gate自体はADR 0147/0148で実装済みで、健全に動く。phase無しplanにも暗黙の`terminal-audit`
Phaseが合成され、`gate_ready`→`reviewing`→`accepted`（evidence slot必須・git blob検証）か明示の
`closed_unaudited`以外では閉じられない。

しかしAIが「次は何をするか」を問い合わせる面が、監査待ちを一切返さない。

- `lattice status --json`は全task done時に`next_action: {"reason": "no_ready_task"}`を返す。
  機械が「残作業なし」と答える以上、AIは正しくそれを信じて完了報告する。
- `lattice todo status --json`（`lattice.todo_status_result.v4`）の上位キーは`active_set`／`next_ready`／
  `dispatch_frontier`／`blocked`／`member_heads`だけで、監査欄が無い。`src/todo-status.mjs`には
  `gate_ready`への言及がゼロである。
- 監査待ちが現れるのは`todo phase status --plan <k>`（呼ぶ動機の無いdrilldown）と`todo done`結果の
  advisoryだけ。複数worker運用では最後のToDoを閉じたworkerがadvisoryを受け取り、完了判断をする
  統括はstatusしか見ないので、助言が判断者へ届かない。

## 目的

監査待ちPhaseが存在する限り、statusの応答が「未監査＝未完了」と答え、次のコマンドまで案内する。

## 非目的

- 状態機械を変えない。新しいPhase状態も新しい遷移も作らない。
- dispatch／task readinessを変えない。ADR 0062・ADR 0147裁定5の不変条件を維持する。
- 何かをblockしない。これは可視性と次アクションの修正であって、gateの追加ではない。
- 監査内容を採点しない。

## 決定

- 人間向け表示はdashboard／ganttヘッダだけへ出す。CLIのstdoutは1行のversioned JSONというADR 0049の
  公理を守り、テキストモードを新設しない。
- `state`は`ready`のまま変えない。閉じたenumでありhostが分岐に使う。信号は`next_action.reason`が持つ。
- `next_action`の優先順位は`active_run` > `next_ready` > `audit_pending` > なし。ready frontierがある間は
  並列開始コマンドを最優先するADR 0063を崩さない。監査待ちは`audit_pending`欄に常在するので消えない。
- wire schemaは`lattice.todo_status_result.v4`から`v5`へbumpする。ADR 0054・ADR 0063の前例に従い、
  既存versionへのfield in-place追加はしない。
- v5化の前にdotagents側の消費者を先に追従させる。ADR 0054のprotocolである。

## ToDo

各項目の詳細な実装方針と受入条件は、Lattice storeの各taskのdesign memoが持つ。

- ap01: Phase定義アクセサのexport
- ap02: 監査待ち判定の共有モジュール
- ap03: `todo_status_result` v5と`audit_pending`欄
- ap04: `lattice status`のnext_action
- ap05: dashboard／ganttヘッダの監査待ち表示
- ap06: 監査待ち表出のE2E test
- ap07: ADR 0159と公開契約の更新
- ap08: dotagents側消費者のv5追従

## 受入ゲート

全ToDoがdoneになった時点では完了ではない。`npm run ci`がgreenであること、本repoの実storeで
`lattice status --json`が監査待ちを指すことを実測し、証跡を固定した上で終端監査をacceptして閉じる。
