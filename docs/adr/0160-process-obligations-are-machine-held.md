# ADR 0160: 工程に属する義務は機械が持ち、未判定はdispatchを塞がない

- Status: Accepted
- Date: 2026-08-08
- Owners: Lattice
- Extends: ADR 0159、ADR 0128、ADR 0127
- Reaffirms: ADR 0062、ADR 0063、ADR 0049、ADR 0054、ADR 0124

## Context

ADR 0159は「監査待ちが次アクション面に出ない」を直した。本ADRが直すのはその一般形である
——**taskに属さない義務（工程レベルの申し送り、順序制約、調整方式の選択）に、機械の中の
置き場が無かった**。置き場が無いので会話と散文へ落ち、そこでは守られない。

8人月ぶんのToDoを4 workerで走らせた2回の実運用で、同じ形が3件観測された。

- **順序制約が散文にしか無かった。** 「downstream追従（ap08）を先に着地させる」という制約は
  会話の議事へ書かれたが、機械はそれを持っていない。4人の誰も守る仕組みを持たず、
  破断面（publish時点）まで誰も気づかない状態で流れた。
- **witnessが全planの暗黙義務で、帰属が無かった。** 「境界を宣言してcompileする」は全planに
  かかる暗黙の義務だったので、**誰の受入条件でもなかった**。結果、`todo start`のadvisoryが
  `coverage: missing`／`independence_unrecorded`を8件連続で正確に返し続け、8件とも素通りされた。
  常に出ている欄は、常に出ているという理由で読まれない。
- **依存線の無い順序制約は機械が持てなかった。** ある追従taskはhard dependencyを1本も持たず
  起票時からreadyだったが、内容は他の3 taskの結果の**和集合**を必要としていた。機械はこの順序を
  持っておらず、readyだからと着手すれば3分の1だけ知った実装を書くことになった。

いずれも「AIの注意力」や「規範の強さ」の問題ではない。**taskに属さない事実の置き場が
機械の中に無かった**——それだけである。

## Decision

### 1. 工程に属する義務はplan単位noteが持ち、次アクション面がその存在を告げる

`lattice todo note --plan <key>`（`--task`省略）でplan単位noteを書く。plan単位noteは特定のtaskに
属さないので、そのplanの**全taskの`note_context`へ届く**——工程レベルの義務は「次に着手する誰か」へ
届くべきもので、誰が着手するかは書いた時点で分からない。

**plan単位noteはtask noteと別のchain file（`plan-active.jsonl`）へ積む。** 1本のchainに混ぜると、
plan noteを1件書いた時点で旧CLIにとってそのplanのchain全体が壊れたものになる
（`parseCanonicalSegment`は1 eventずつbyte完全一致で検証し、1件でも通らなければchainごと
`NOTE_LOG_CORRUPT`で落とす）。noteの読みは`todo start`の前提条件なので、**旧CLIでstartが通らなくなる**。
storeへ書いたものは戻せないのでrollbackで復旧できない。旧readerは`active.jsonl`と`sealed/*`だけを
読み、plan直下を列挙しないので、別名のfileへ積めば存在に気づかない。

`todo_status_result`の`plan_notes`欄が、**まだ誰も着手していない工程の義務**を出す。`note_context`は
着手した人へしか届かないので、この欄が無いと「誰も着手していない間は、義務がどこにも出ない」窓が残る。

**この欄はnote本文を載せない。** 自由記述Markdown（1件16KiB上限）を載せると`TODO_STATUS_CAPTURE_LIMIT`
（64KiB）をplan数との積で超え、**健全なstoreを`TODO_SCALE_EXCEEDED`で落とす**——「記録するほど
statusが壊れる」面を作らない。ADR 0159 Decision 2が330字のproseを`audit_pending`から落としたのと
同じ判断である。entryが持つのは`{plan_key, plan_note_head_digest, count, latest, next_commands}`で、
`latest`は最新3件の`{event_digest, actor_agent, recorded_at}`まで。**在ることは常に届き、中身は
`next_commands`が指す`note list`へ取りに行く。**

`next_commands`を非空必須にした理由はADR 0159と同じである。欄に出るだけで次の一手が無ければ、
次アクション面として無意味である。

digest欄を`note_head_digest`ではなく`plan_note_head_digest`としたのは、`note_context.note_head_digest`が
task chainのheadを指すためである。**同名は同一性の主張**であり、型がどちらも64hex digestなので、
同名にすると消費側が取り違えてもexact validatorを通り抜ける。

### 2. 調整方式はplan起票後の明示選択であり、選択に帰属が付く

`lattice todo independence mode --plan <key> --set witness|conversation --reason <text>`で、その planを
**witness検証で並列する**か**会話で調整する**かを宣言する。記録はplanへ帰属するjournal event
（`coordination_mode`）として持ち、**actorが「誰が選んだか」の帰属になる**。

witnessが全planの暗黙義務だったことが、帰属の無さの原因だった。暗黙の義務は誰の受入条件でもなく、
誰の受入条件でもない作業は行われない。**選択を明示にすることで、選ばなかったことも可視になる。**

`mode=conversation`を選んだplanではwitness系の督促を出さない（選択の尊重）。`mode=witness`のplanだけが
未compileを一級に表出される。**既存planはmode未宣言のまま存続でき、migrationを強制しない。**
変わるのは表出だけである。

`todo_status_result`の`coordination`欄は**宣言済みのplanだけを列挙する。** 未宣言を`mode: null`で
全plan出すと、plan数ぶん常に埋まる列になり、witness `coverage: missing`が辿ったのと同じ
「満杯で始まるので読み飛ばされる欄」になる。未宣言は「`member_heads`に居て`coordination`に居ない」で引ける。

### 3. 未判定はdispatchを塞がない（Protected behavior）

witness setが未宣言（`coverage: missing`）であることは「競合が無い」ではなく「まだ調べていない」である。
未判定を「不可」へ倒すと、ToDoツリー上は並列できるものが多数あるのに工程が止まる。したがって
independence記録の有無は`next_ready`／`active_set`／`dispatch_frontier`（`frontier_digest`を含む）を変えない。

判定済みで競合が宣言されている場合も同じである。競合は`todo start`のadvisoryが伝える助言であって、
frontierからの除外ではない（ADR 0128）。ADR 0062の「Phase監査順とToDo schedulingの分離」と
ADR 0063の並列既定を、判定状態についても継承する。

anchorは`test/todo-dispatch-unjudged.test.mjs`（3件）である。記録なし／記録あり／競合宣言ありの3状態で
dispatch面がbyte一致することを固定し、記録が実際に立っていることを両側で確認してvacuousを防いでいる。

**ADR 0159の非目的との関係**: 0159は「監査状態についてdispatchを変えない」と述べた。0160は
**判定状態について同じことを述べる**。監査状態と判定状態は別の状態であり、どちらもdispatch面へ
流さない、という同型の決定が2つ並ぶ——領域が重なっているのではない。

### 4. 並列候補の逐次判定は導線であって、新しい判定ではない

AIが並列できそうな組を選ぶ→その組だけ境界を宣言してcompileする→機械が可否を返す→否なら次の候補へ、
という進み方を`todo status`が導線として支える。判定機械（compile）と部分宣言の受理は既にあり
（未宣言taskは「未検査」として残るだけ・ADR 0127）、足りなかったのは候補の提示と次コマンドの案内である。

`todo_status_result`の`parallel_candidates`欄が、planごとに`{coverage, unjudged_task_ids,
verified_parallel_groups, serialize_pairs, next_commands}`を返す。**判定する対象が何も無いplanは
entryごと出さない**——空entryは「判定する対象が無い」と「判定が済んだ」を混ぜる。

**新しい判定ロジックを書かない。** 既存のcompile結果を候補視点で並べ直すだけで、推定・判断をLattice内へ
実装しない（所有境界）。候補と判定状態は`dispatch_frontier`の**外**に置く。`dispatch_frontier`は
`validateTodoStatusResult`の中で`next_ready`を引数に取って照合される唯一の欄であり、「この欄は
`next_ready`の関数である」という不変が形に焼かれている。判定状態はそこから決まらないので、中へ入れると
その不変が壊れる。**`frontier_digest`のpreimageは`next_ready`の`(plan_key, task_id)`だけのまま変えない**
——`recommended_parallelism`のような派生値すら入っていない現行の作り方が、既にこの方針を体現している。

### 5. `todo_status_result`を`v6`へ上げ、downstream先行で公開する

ADR 0054・0063の前例に従い、既存versionへのfield in-place追加はしない。上位キーはexactで、
`plan_notes`・`coordination`・`parallel_candidates`がこの順で`audit_pending`と`member_heads`の間に入る。

`session_context.v1`の`todo`フィールドは`todo status`のresultそのものなので（ADR 0131）、v6は
SessionStart面へ追加のbumpなしで届く。**破断面はcommit時点ではなくpublish時点**である——dotagentsが
読むのはglobally installされたlattice CLIだからである。よってdotagentsの消費者（projection・
Control saga・SessionStart hook）を先にv6受理へ動かしてから、Latticeのpublishを行う。

## Consequences

- 工程に属する義務が、着手した人と、まだ誰も着手していない工程の両方へ届く。**「残作業なし」と
  「義務なし」が別の答えになる**——`next_ready`が空でも`plan_notes`は非空でありうる。
- `todo_status_result`を**exact key検証**している消費者はv6への追従が必要になる。「知っているkeyだけを
  読む」消費者は影響を受けない。追従前のexact pin消費者は、publishまでinstalled CLIを
  `version_mismatch`として拒否する（downstream先行protocolとexact pinの組み合わせから必然的に生じる
  typedかつfail-visibleな窓）。
- **調整方式の宣言とplan noteは、wireの版ズレではなくstore formatの前方非互換である。** `coordination_mode`
  eventを1件でも書いたplanは、旧CLIから`todo status`も`todo start`も通らなくなる（journal読みは
  `validateTodoEvent`がfalseを返した時点でそのplanごと`STORE_CORRUPT`にし、部分的に読み飛ばす経路を
  持たない——壊れを黙って飛ばす形にしないため）。**wireは版を戻せば済むが、storeへ書いたものは戻らない。**
  宣言していないplan・plan noteを持たないplanは無傷である。
- plan単位noteは別chainなので、旧CLIはその存在に気づかずtask noteだけを従来どおり返す。
- `dispatch_frontier`と`frontier_digest`は、判定状態でもplan noteの有無でも動かない。

## 非目的

- **観測や作業の担当割りを機械化しない。** 「このplanの終端監査は誰が見るか」を機械へ持たせると、
  担当が死んだことを機械が検知できず、永久ロックになる。事実の記録はplan noteが持ち、担当の調整は
  卓の宣言が持つ。**記録と調整を同じ機構に混ぜない。**
- **宣言の中身を採点しない。** Latticeが見るのは宣言の存在と構造だけである（ADR 0148の継承）。
  宣言が実態と合っているかは宣言者の責任であり、機械はそれを評価しない。
- **未判定・未宣言で何もblockしない。** これは可視性と帰属の修正であって、gateの追加ではない。
- **dispatch／task readinessを変えない。** ADR 0062・0063・0159の不変条件を維持する。
- **状態機械を変えない。** 新しいPhase状態も新しい遷移も作らない。

## Protected behavior

### 未判定はdispatchを塞がない

witness setが未宣言（`coverage: missing`）であることは「競合が無い」ではなく「まだ調べていない」である。
未判定を「不可」へ倒すと、ToDoツリー上は並列できるものが多数あるのに工程が止まる。したがって
independence記録の有無は`next_ready`／`active_set`／`dispatch_frontier`（`frontier_digest`を含む）を変えない。

判定済みで競合が宣言されている場合も同じである。競合は`todo start`のadvisoryが伝える助言であって、
frontierからの除外ではない（ADR 0128）。ADR 0062の「Phase監査順とToDo schedulingの分離」と
ADR 0063の並列既定を、判定状態についても継承する。

### 継承する不変

- ADR 0062「Phase監査順とToDo schedulingの分離」
- ADR 0063の並列既定と`--parallel-frontier`宣言、`frontier_digest`のpreimage
- ADR 0049「CLIのstdoutは1行のversioned JSON」
- ADR 0127の部分witness受理（未宣言taskは「未検査」として残る）
- ADR 0159の`audit_pending`と次アクション面の優先順位

## 未決

1. **start済みの相手へnoteを押し出す経路が無い。** `note_context`は`todo start`の応答にしか載らないので、
   既にstartした人へ後から貼ったnoteは、その人が`todo show`／`note list`を自発的に叩かない限り届かない。
   起票直後の運用ではstartが後から来るので実害が出にくいが、長く走るtaskへ後から義務を足す場面では
   届かない。**発火条件**: 「貼ったのに読まれなかった」plan／task noteが実運用で1件観測されたら着手する。
2. **`lattice status`（`project_status.v1`）にplan noteが出ない。** `session-context`の`todo`には出るが、
   `lattice status`は`next_action`を導出するだけでtodo本体を載せないため、そこだけを読む消費者には
   届かない。出すには`project_status.v2`が要り、`state`のenumを増やさない方針（ADR 0159 Decision 3）と
   併せて設計する必要がある。**発火条件**: `lattice status`だけを読むhost統合が1件現れたら、または
   plan noteを`next_action`の優先順位へ入れる要求が出たら着手する。
3. **常駐processの「生きているが応答できない」を登録簿が表せない。** ADR 0157はdaemonの生死を
   pidごとの記録で持つことを決めたが、記録が答えるのは「生きているか」だけである。実際に、pidも
   port（LISTEN）もdescriptorもすべて正常を示したまま、HTTPを返せないdashboard daemonが観測された
   （poll周期1秒に対しstore読みが5秒を超え、event loopが追いつかない状態）。**発火条件**:
   同じ無応答が通常運用（1〜2 sessionの規模）で1件観測されたら着手する。
