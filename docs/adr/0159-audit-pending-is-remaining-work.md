# ADR 0159: 監査待ちは残作業であり、次アクション面が答える

- Status: Accepted
- Date: 2026-08-08
- Owners: Lattice
- Extends: ADR 0147、ADR 0148
- Reaffirms: ADR 0062、ADR 0063、ADR 0049、ADR 0054

## Context

全Lattice管理projectで、Phase終端の終端監査をAIが高頻度で失念する。原因は規範でも注意力でもなく、
statusの応答構造にある。

終端監査gate自体はADR 0147/0148で実装済みで、健全に動く。phase無しplanにも暗黙の`terminal-audit`
Phaseが合成され、`gate_ready`→`reviewing`→`accepted`（evidence slot必須・git blob検証）か明示の
`closed_unaudited`以外では閉じられない。

しかしAIが「次は何をするか」を問い合わせる面が、監査待ちを一切返していなかった。

- `lattice status --json`は全task done時に`next_action: {"reason": "no_ready_task"}`を返した。
  機械が「残作業なし」と答える以上、AIは正しくそれを信じて完了報告する。
- `lattice todo status --json`（`lattice.todo_status_result.v4`）の上位キーは`active_set`／`next_ready`／
  `dispatch_frontier`／`blocked`／`member_heads`だけで、監査欄が無かった。`src/todo-status.mjs`には
  `gate_ready`への言及がゼロだった。
- 監査待ちが現れるのは`todo phase status`（呼ぶ動機の無いdrilldown）と`todo done`結果のadvisoryだけ。
  複数worker運用では最後のToDoを閉じたworkerがadvisoryを受け取り、完了判断をする統括はstatusしか
  見ないので、助言が判断者へ届かない。

規範を強めても直らない。**機械が持たない義務は、散文に置いても守られない。**

## Decision

### 1. 監査待ちPhaseは残作業であり、statusがそう答える

監査待ち（`gate_ready`／`reviewing`／`rejected`）のPhaseが存在する限り、statusの応答は
「未監査＝未完了」と答え、次に打つコマンドまで案内する。「待っているものがある」ことを
知っている面が黙るのをやめる、という一点だけの決定である。

判断が着いた終端状態（`accepted`／`closed_unaudited`）は含めない。まだpending taskが残る
`active`も含めない——監査の地点へ到達していない。この状態集合は`src/todo-audit-pending.mjs`が
単独で所有し、status面・工程図・dashboardが同じ定義を読む。集合を各面へ書き写さない。

### 2. `todo_status_result`を`v5`へ上げ、`audit_pending`欄を持つ

ADR 0054・0063の前例に従い、既存versionへのfield in-place追加はしない。上位キーはexact 9キーで、
`audit_pending`は`blocked`と`member_heads`の間に入る。

各entryはexact 6キー`{plan_key, phase_id, phase_status, implicit, required_evidence_slots, next_commands}`。
task entryと紛れないよう`status`ではなく`phase_status`とする。`required_evidence_slots`は
Phase定義（phase無しplanでは暗黙の`terminal-audit`）から取り、statusの側で再導出しない。
`next_commands`は非空必須とする——監査待ちなのに次の一手が空なら、次アクション面として無意味である。

**人間向けの長文proseをこの欄へ入れない。** 2000件の上限との積で64KiBのcapture limitを超え、
健全なstoreを`TODO_SCALE_EXCEEDED`にする。proseは`todo phase status`と`todo done`のadvisoryに留め、
この欄は機械可読な`next_commands`で持つ。CLIのstdoutは1行のversioned JSONというADR 0049の公理を守り、
テキストモードを新設しない。人間向け表示はdashboard／工程図ヘッダだけへ出す。

その人間向け表示では、**出す文字列の側を有界にする**。幅は有限であり、CSSの省略に頼ると
監査待ちの札が操作系の場所を奪う。本文は件数と先頭1件に限り、全件は`title`が持つ。

### 3. `lattice status`は`state`を変えず、`next_action.reason`で答える

`state`は`ready`のまま変えない。閉じたenumでhostが分岐に使うため、値を増やすと
`project_status.v2`となり全消費者のexhaustive switchが壊れる。信号は`next_action.reason`が持つ。
`reason`はopen stringなので`project_status.v1`のbumpは不要である。

**`next_action`の優先順位は`active_run` > `next_ready` > `audit_pending` > なし。** ready frontierが
在る間はADR 0063の並列開始コマンドを最優先する——ここを監査で上書きするとdispatchが再直列化し、
ADR 0063が作った並列既定を壊す。監査待ちは`audit_pending`欄に常在するので、順位を下げても消えない。

`next_ready`の段は既に2つのreasonへ分かれている（1件なら`next_ready_present`、複数なら
`parallel_frontier_present`）。`audit_pending`はその両方より後段であり、既存の分岐を増やさない。

案内するcommandは**verbatim実行可能で読み取り専用**の`todo phase status --plan <key>`とする。
`phase review`は`--reason <text>`のplaceholderを含みjournalを書き換えるので、next_actionへ置かない。
`todo phase status`の結果には既に両分岐のguidanceが載っている。

### 4. v5化の前にdownstream消費者を先に追従させる

ADR 0054のprotocolである。dotagentsの消費者（projection・Control saga・SessionStart hook）を
先にv5受理へ動かしてから、Latticeのpublishを行う。dotagentsが読むのはglobally installされた
lattice CLIなので、破断が起きるのはcommit時点ではなくpublish時点である。

## Consequences

- 全taskがdoneでも監査が着くまで、statusは「残作業なし」と答えない。AIが正しく機械を信じたまま
  完了報告する経路が閉じる。
- `todo_status_result`を**exact key検証**している消費者はv5への追従が必要になる。既存hostのうち
  「知っているkeyだけ読む」ものは影響を受けない。
- exact pinの消費者は、publishまでの間installed CLI（v4）を`version_mismatch`として拒否する。
  downstream先行protocolとexact pinの組み合わせから必然的に生じる窓であり、typedかつfail-visibleである。
- `dispatch_frontier`と`frontier_digest`は監査状態で動かない。監査が進んでも並列配置は変わらない。

## 非目的

- **状態機械を変えない。** 新しいPhase状態も新しい遷移も作らない。
- **dispatch／task readinessを変えない。** ADR 0062・ADR 0147裁定5の不変条件を維持する。
  `next_ready`／`active_set`／`dispatch_frontier`はPhaseの監査状態遷移で不変である。
- **何もblockしない。** これは可視性と次アクションの修正であって、gateの追加ではない。
- **監査の中身を採点しない。** Latticeが見るのはaccept記録の存在だけである（ADR 0148を継承）。

## Protected behavior

- ADR 0062「Phase監査順とToDo schedulingの分離」
- ADR 0063の並列既定と`--parallel-frontier`宣言
- ADR 0049「CLIのstdoutは1行のversioned JSON」
- ADR 0147の暗黙`terminal-audit` Phaseと`implicit`表示
- ADR 0148の`closed_unaudited`と`todo phase baseline`
