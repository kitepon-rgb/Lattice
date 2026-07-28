# 保守・裁定待ちbacklog

会話やhandoffに置くと次のsessionで消える「次の一手」を、Lattice storeの工程として保持する台帳。
ここにあるのは**まだ着手していない**課題であり、着手時にscopeを裁定してから進める。
大物（campaign級）は着手時に専用planを起こし、ここのToDoはその起票をもって完了とする。

工程状態の正本はLattice storeの`backlog` plan。本書は各課題の背景と入口を持つ。

## 課題の背景

### 1. plan_lattice_ganttの残checkbox 8件の裁定

[docs/plan_lattice_gantt.md](plan_lattice_gantt.md)に未消化checkboxが8件残っているが、
対応するstore plan（`phase-control-live-gantt`）は35 task全done。8件はcutover前の古い記述で、
storeに存在しない。中身は「authoring CLI実装」「SessionStart hook接続」「cutover gate」など、
**現在は実在する機能**が多く、別campaignで実現済みなのに文書だけ残った疑いが濃い。
「dotagents側アクセス配線」はdotagents所有の可能性がある。1件ずつ実態と照合し、
完了済みは完了へ、dotagents所有はdotagentsへ、未実現だけを残す裁定が要る。裁定後は
文書をarchiveへ退避する。

### 2. 実変換campaignの起票（PLAN.md第4層の後半）

`seam_candidate → code transform → re-analyze → new plan version`の**実変換**
（隔離worktreeでの実行）。seam-binding campaignで実データの`seam_candidate`が出せる状態に
なったので着手条件は揃った（[実行記録](evidence/2026-07-27-concern-declaration-first-candidate.md)）。
campaign級なので、着手時に専用planを起こす。`bounded-seam.mjs`のcaller assertion問題の解消も
このcampaignが所有する（plan_seam-proposal非目標より持越し）。

### 3. evidence receiptの複数path解決（ADR 0133 Open question 1）

同名symbolが複数fileにあると、`lattice.seam_proposal.v1`の`evidence.queries[]`が
`resolved_path`を単数しか持てないため`unknown`へ潰れ、`within`で絞る余地が無い。
実データで`tio-009:summarizeIndependence`が該当。解くには公開contract（evidence契約）の
版上げが要る。頻度を見てから、と裁定済みだが、2件目が出たら着手する。

**裁定済み（2026-07-27・[ADR 0134](adr/0134-ambiguous-symbol-receipt-narrowed-by-declared-resource.md)）。**
「2件目まで待つ」を改めて実施した。詰まっているのは頻度ではなく、正直な宣言から候補が出る
唯一の実例がこの1件で、ここが通らない限り実変換campaignの入力が探り宣言に依存し続けるためである。
`lattice.seam_proposal.v2`の`candidate_paths`で曖昧さを記録し、宣言した資源で絞る。
[実行記録](evidence/2026-07-27-honest-declaration-first-candidate.md)。

### 4. bridge daemonのdescriptor読み取りretry

bridge daemonのdescriptor読み取りにretryが無く、起動と同時に読むとraceで落ちる。
maintenance級の欠陥修理。

### 5. ADR 0132 Open questions 2〜4の再裁定

複数の非劣位候補を持つ`candidate_set` v2（OQ2）、`verification` digestを契約側で締めるか（OQ3）、
新規fileだけを作るToDoの独立性判定（OQ4）。いずれも「実データの蓄積後に裁定」と決めてある。
OQ4は新module・新doc・新test追加という実開発ToDoのかなりの割合が判定対象外になる実害があり、
再裁定の優先候補。

**裁定済み（2026-07-27・[ADR 0135](adr/0135-readjudicating-seam-proposal-open-questions.md)）。**
OQ2は保留を維持しつつ発火条件を「`multiple_incomparable_candidates`が実データで1件出たら着手」へ
明文化。OQ3は同型問題を所有する実変換campaign（課題2）へ移した。OQ4は判定対象にすると決め、
自動導出でなく宣言とした——実装は下記`creation-boundary`工程が持つ。
測定中に判定反転の欠陥を1件見つけて修理した（[実行記録](evidence/2026-07-27-bk-005-open-question-readjudication.md)）。

## 工程

工程の状態・依存・完了証拠はLattice storeの`backlog` planが正本。以下は対応表である。

- [x] plan_lattice_ganttの残checkbox 8件を実態と照合して裁定する
- [x] 実変換campaignを起票する
- [x] seam evidence receiptの複数path解決を裁定する
- [x] bridge daemonのdescriptor読み取りへretryを入れる
- [x] ADR 0132 Open questions 2〜4を再裁定する

## 導線

- 製品思想: [PLAN.md](../PLAN.md)
- 直近の裁定: [ADR 0133](adr/0133-concern-anchor-binding.md)

---

# 自己記述面のparity（ADR 0130の履行漏れ）

工程状態の正本はLattice storeの`self-description-parity` plan。

0.16.0で`concern_anchors`という能力を足したのに、**Latticeの自己記述面へ足さなかった**。
[ADR 0130](adr/0130-lattice-describes-its-own-parallelism-surface.md)は「Latticeが自分の
並列化面を自分で説明する／案内文言の単一正本」を決めており、これはその履行漏れである。

具体的に欠けているのは2箇所:

1. `TODO_INDEPENDENCE_WORKFLOW`（`lattice todo --help`とMCP instructionsへ出る宣言手順）が
   `owns／reads／writes／affected_tests`しか挙げておらず、`concern_anchors`が載っていない。
2. guidanceカタログに束縛失敗の項目が無い。`SEAM_PROPOSAL_GUIDANCE_CODES`は記録の鮮度
   （unrecorded／superseded／stale／verified）だけで、`semantic_owner_binding_missing`や
   `concern_anchor_unresolved`が出た時に次の一歩を返す口が無い。

**一番必要な瞬間——機械が「束縛できませんでした」と言った瞬間——に解決法を知らせない。**
ToDoのtitleが読めるのに入口が無かったのと同じ構図で、能力はあるのに案内が無い。
AGENTS.mdには書いたので人（AI）側のcontextには入るが、機械が黙っている状態は
ADR 0130が禁じたものそのものである。

## 工程

- [x] 宣言手順の単一正本へconcern_anchorsを載せる
- [x] 束縛失敗のunknownへguidance codeとnext_actionを与える

---

# 創作境界（新規fileだけを作るToDoの独立性判定）

工程状態の正本はLattice storeの`creation-boundary` plan。

[ADR 0135](adr/0135-readjudicating-seam-proposal-open-questions.md) Decision 3で方向を確定した。
まだ存在しないpathの`owns`は、`path_state: absent`という**決定的な観測**（filesystemのlstat結果）を
持ちながら判定対象外に落ちている。新module・新doc・新test追加という実開発ToDoのかなりの割合が
並列可否を持てない。

自動導出にはしない。観測から機械的に創作境界と読むと、pathのtypoが「必ず止まるエラー」から
「黙って通る創作境界」へ変わるためである。よって`owns`側へ創作の意思を宣言させ、宣言がある
pathだけを、fresh absentかつ`affectedTests`が空という条件の下で構造的裏付けありとして扱う。
宣言の無いabsent pathは従来どおりfail closedのままにする。prefix形（末尾`/`）は`affected`が
`unresolved`を返すため対象外とし、file単位に限る。

判定を行うのはfront endであり、front endは`lattice.run_request.v1`の`manual_witness`しか読まない。
したがって創作宣言は`lattice.todo_witness_set`（v3）と`lattice.run_request`（v2）の両方へ届く必要が
ある。後者は83箇所・30ファイルから参照される入力契約であり、campaign規模である。

## 工程

- [x] 創作宣言を入力契約へ足す（witness set v3・run_request v3）
- [x] front endが創作境界を裏付けありとして判定する
- [x] 実データで新規fileを含むplanの並列可否を出し、releaseまで通す

---

# holdからの再開（請求項7・8の後半）

工程状態の正本はLattice storeの`hold-resume` plan。

**この工程が独立して存在するのは、`io-sentinel`のst-004を定義を満たさないまま閉じたためである。**
st-004のtask定義は「実repoで早期検知から**再開**までを通し検出遅延を実測する」であり、実際に
行ったのは検知と実測だけで、再開は手つかずだった。しかも閉じた時点では実測も未了で、証拠文書
自身がそう書いていた。

差し戻そうとしたが、storeは`reopen_has_started_successor`で正しく拒否した——後継のst-005が既に
走った以上、前提が完了しなかったことにはできない。**overrideで整合gateを潰さず、未達分を新しい
工程として前へ運ぶ。** 記録された当時の判断を書き換えないのは、証拠blobの時と同じ規律である。

**停止は作ったが、再開が無い。** holdはworkerをSIGSTOPして静止を証明するところまで通る
（[ADR 0143](adr/0143-io-sentinel-is-an-early-warning-not-a-finding.md) Decision 9）。だが
**止めたworkerの行き先が「破棄」しかない**。請求項7は「一方を停止し、他方を確定し、停止した方を
再開する」、請求項8は「双方を停止し、限定的な変換を施し、双方を再開する」と述べており、
再開はどちらの構成要件でもある。

これに気づいたのは、run終了時に停止済みworkerが残留したためである。**そこを「終了時に殺す」で
塞ごうとしたのが誤りだった**——殺すのはcleanupであって、閉じ方ではない。停止したworkerの
正しい行き先は次の二択であり、cleanupはそのどちらでもない。

| 行き先 | 意味 | 現状 |
|---|---|---|
| 再開 | 競合を解いた後、SIGCONTして続きを走らせる | **無い** |
| 破棄 | 成果を捨てる決定として終了させ、そう記録する | abandonで実装済み |

`close`は完走したrunの終了なので、そこにworkerは生きていない（`closeRunIfComplete`が全TODO
acceptedを要求するため、held workerが居ればcloseへ来ない）。daemonがsignalで落ちる経路の回収は
**事故処理であって正しい閉じ方ではない**。

再開に要るもの: SIGCONT、`epoch_rebound`との接続（rebind operationはcontrollerに在る）、
carry-over witnessとの整合、再開後のwrite lease再発行。

## path競合には直列化の道が無い（2026-07-28に判明）

**実行時に観測されるpath競合は、再計画できない。** `routeConflictTreatment`はpath findingを
既定で`intentional_serial`へ振るのに、そのtreatmentが受け付けない。

| 面 | 事実 |
|---|---|
| routing | path findingを`intentional_serial`へ振る（実測） |
| treatment契約 | `resource_id`に識別子を要求する。`null`は受けない（同一requestで変数1つだけ変えて実測） |
| recompile handler | `finding.resource_id === treatment.resource_id`を要求する |
| path finding | `resource_id`は**必ずnull**（finding契約が、path形はresource_id nullと定めている） |

したがってpath競合の行き先は`seam_transform`だけで、それも事前宣言済みtreatmentがpathを
覆う時にしか選ばれない。**請求項7の「一方を停止し、他方を確定し、停止した方を再開する」は、
実行時に見つかるpath競合に対して現状たどれない。**

**設計は存在していて、繋がれていない。** `runtime-hold-recompile.mjs`にpathを受け取って
資源idを作る`sha16`が定義されているが、どこからも呼ばれていない。動いている版は
`runtime-seam-resolve.mjs`にあり、資源idの形は`own-<kind>-<sha16(target)>`である。
front-endも同じ形を使う（実データで`own-path-f613918e7d7e237c`）。

**解決済み（2026-07-28）。** handlerがpath findingの時だけ、係争pathからfront-endと同じ形で
資源idを導出して照合するようにした。導出値との一致を要求するので、資源idを捏造できないという
元の保証は保たれる。finding契約（path形はresource_id null）は変えていない。

## scope違反は、そもそも止める事象ではなかった（2026-07-28に裁定）

**宣言境界は計画時の予測であって、workerを閉じ込める制約ではない。** 範囲内へ無理に押し込めると
workerの自由度が落ち、成果の品質が下がる。だから自由に書かせ、**実際の足跡が他の走行中TODOと
ぶつかった時にだけ**止めて処置する——請求項7と請求項8はそのための構成である。

よって単独のscope警報——誰の領分とも重なっていない宣言外の書き込み——はhold経路へ運ばない。
競合ではなく、**予測が実態より狭かったという情報**である。記録は残るので再計画の材料としては
失われない。

**scope違反に処置が無いのは欠落ではなく、止めるべき事象ではないことの現れだった。**
止めるべきでないものを止めていたので、当てる処置が無かった。第三のmodeを足そうとしていたのは
逆方向である。

なお、正しくコンパイルされた並列planではoverlapは必ずscope違反を伴う（宣言が互いに素だから
こそ並列に走れるので、他人のscopeへ書くなら必ず自分のscopeの外になる）。両方立つ時、処置が
あるのはoverlapの側である。

## rebindを実runで通した（2026-07-28）

`epoch_rebind`——走っているworkerを後継epochへ繋ぎ直す面——には実runの被覆がゼロだった。
契約もcodeも揃っていたが、通した実績が無かった。通そうとして、いずれも一度も実行されて
いなかったために露出していなかった欠陥が2件出た。

| 症状 | 原因 |
|---|---|
| `Cannot read properties of null (reading 'packet_digest')` | rebind ackが`task.receipt`を読んでいた。**holdされたworkerにreceiptは無い**——作業を終えていないから止められている |
| `durable Direct OS binding不足: unknown` | `resolveObservationBinding`がrunning bindingしか受けなかった。rebind経路は`kind: 'rebind'`でackだけを渡す |

実runの結果（[受入test](../test/integration/hold-resume.integration.mjs)）:

```
finding: observed_write_conflict | T1,T2 | src/alpha.mjs
epoch_rebind_acknowledged
workers_resumed: {"resumed_todo_ids": ["T3"]}
epoch_rebound, intake_resumed

T1 Ts（停止のまま）  T2 Ts（停止のまま）  T3 消滅（再開して完走）
```

**請求項7の「一方を停止し、他方を確定し、停止した方を再開する」が実runで成立した。**

## seam変換は、実行時競合の形を受け取れない（2026-07-28に判明）

請求項8（双方停止・限定的変換・双方再開）を実runで通そうとして、宣言の段階で止まった。

`lattice.runtime_seam_request.v1`は各TODOが係争fileの中で触るsymbolを`concern_symbols`で
宣言する。これは`concern_anchors`へ写り、その`within`は**自分が`owns`で主張している資源に
限る**（`todo-independence-contracts.mjs`。「所有していない資源の内側に担当を主張させない」）。

**ところが実行時のpath競合は、片方がその資源を所有していないから起きる。** 宣言外へ書いた側は
係争fileを`owns`に持たないので、`concern_anchors`を宣言できない。よって
`witness_set_invalid`で止まる。

| レーン | 想定している競合 | 実行時競合では |
|---|---|---|
| seam変換（請求項8） | 両者が係争資源を**宣言している**（計画時に見える競合） | 片方が宣言していない → 宣言不能 |
| 直列化（請求項7） | 資源idで束ねる | path findingに資源idが無い → 導出で解決済み |

**seam変換は計画時に見えている競合のために作られている。** 両者が同じ資源を宣言し、compileが
競合と判定し、それを分割する——という流れである。実行時に発覚する競合は、その前提を満たさない。

### 裁定が要ること

実行時competitionへ請求項8をどう届かせるか。

| | 案 | 論点 |
|---|---|---|
| A | 変換の前に、違反側の宣言を実態へ広げた後継requestを作る | 広げた時点で計画時競合になるので、既存のseam経路がそのまま使える。ただし「宣言を書き換える」のは誰の権限か |
| B | `concern_anchors`の所有規則を、実行時に観測された書き込みでも満たせるようにする | 観測は所有の主張ではない。規則の意味が変わる |
| C | 実行時競合は直列化（請求項7）だけで閉じ、変換は計画時競合に限る | 請求項8の適用範囲を狭める。製品目標の後退になりうる |

Aが素直に見える。実際に触ったことは観測で裏付けられているので、宣言を実態へ寄せるのは
「予測が狭かったのを直す」であり、捏造ではない。ただし後継requestを誰が組むか（AIか装置か）は
所有境界の話になる。

## 工程

- [x] holdしたworkerをSIGCONTで再開する経路を作る
- [x] rebindを実runで通し、その後にcarry-over workerが再開することを確かめる
- [ ] 実行時競合へ請求項8を届かせる道を裁定し、停止→変換→再開を実runで通す

---

# 実行時競合を装置が扱える形へ翻訳する

工程状態の正本はLattice storeの`runtime-conflict-translation` plan。

競合した時の処置は2つある——請求項7（片方を止め、他方を確定し、止めた方を再開する）と
請求項8（双方を止め、限定的な変換を施し、双方を再開する）。請求項7は2026-07-28に実runで
通った。**請求項8は、実行時に見つかった競合の形を受け取れない。**

理由は宣言の規則である。変換の宣言（`concern_anchors`）の`within`は自分が`owns`で主張して
いる資源に限られるが、実行時のpath競合は**片方がその資源を所有していないから起きる**。
よって宣言が原理的に書けない（`witness_set_invalid`）。

## 翻訳であって、3つ目の処置ではない

```
実行時に競合を検出
      ↓
観測された実態へ宣言を合わせる    ← 翻訳。処置ではない
      ↓
計画時競合として見える
      ↓
   請求項7 か 請求項8
```

**「違反」ではない。** 境界は計画時の予測であり、超えたのは予測が狭かったからである。だから
操作は「破った側を直す」ではなく「**宣言と観測を突き合わせる**」であり、対称である——どちらの
足跡が予測を超えたかは観測が決める。作業は正当なので捨てない。

広げた結果、両者が同じ資源を宣言することになれば計画時競合になり、既存のseam変換／直列化が
そのまま適用できる。

## 語彙を改めた（2026-07-28に裁定・実施）

findingの種別名は`scope_violation`、警報は`io_scope_warning`だった。**codeが「違反」と言って
いた。** 予測を超えた観測であって違反ではないので、語彙が誤解を再生産する。実際、この課題を
起票する過程で自分でも「違反側の宣言を直す」と書き、指摘されるまで気づかなかった。

| 旧 | 新 |
|---|---|
| `scope_violation` | `undeclared_write` |
| `io_scope_warning` | `io_undeclared_write_warning` |

**破壊的変更である。** `lattice.runtime_conflict_finding.v1`の種別集合に触るので、旧名を持つ
findingは検証を通らない。採った理由は、語彙が実際に設計判断を誤らせた実例があること。公開
schema（`docs/schemas/*.json`）には出ておらず、run storeのfindingはrunごとの一時資産なので、
移行の負担より誤解の再生産を止める利益が上回ると判断した。

**同じ文字列が4つの別空間にあった。** 一括改名で全部巻き込んだ。

| 空間 | 実体 | 扱い |
|---|---|---|
| 製品のfinding種別 | `RUNTIME_CONFLICT_KINDS` | 改名 |
| RC1/RC2の変換拒否理由 | `TRANSFORM_REJECTION_KINDS`・`seam-transform.mjs` | **旧名**。`research/campaigns/`の成果物へ焼き込み済み |
| RC3 campaignの条件名 | `rc3-scripted-campaign.mjs`の`condition` | **旧名**。凍結manifestの**directory名**でもある |
| RC3 campaignの期待finding | 同ファイルの`expected.finding_kinds` | 改名（製品に追従） |

同一ファイル内で条件名だけ据え置き、期待値だけ追従する箇所がある。**grepの単位と空間の
単位が一致しない。**

`src/seam-transform.mjs`はtestをすり抜けた。出力が`TRANSFORM_REJECTION_KINDS`で検証される
のに新名を出すようになり、artifact検証が落ちる状態だったが、**unit testにscope拒否の経路が
無く**、覆っているのは`test/integration/`だけだった。1082 greenは境界の正しさを意味しない。

**改名の前に、同名が別空間に無いかを確かめる。** 不変記録（研究成果物・凍結manifest・
evidence・ADR）は追従させない。書き換えると当時の記録が嘘になる。

**残る category の問題。** `undeclared_write`は依然として`RUNTIME_CONFLICT_KINDS`に属する。
だが予測超過は競合ではない——単独では処置できず（`intentional_serial`は2者以上を要求する）、
`finding_record`はそれを候補として受理するので、**hostが投げれば処置できないfreezeを作れる**。
名前は直したが、種別の所属は直していない。ct-002で翻訳段を入れる時に、単独の予測超過を
conflictとして受理しない形まで持っていく。

## 翻訳段（2026-07-28に実装・実CLIで通過）

`reconcileWitnessToObservation`。観測された係争pathを、関与TODOの宣言へ足す。操作は対称で、
広げる対象は観測が示した資源だけである。合わせた内容は`lattice.runtime_seam_resolution.v2`の
`reconciled`に残す。

**宣言は3つ同時に広げる。** 実装の途中で2回、半分だけ広げて詰まった。

| 広げたもの | 足りないと何が起きるか |
|---|---|
| `owns`・`writes` | （これだけだと）`sensor_unbound`でcompileが`BOUNDARY_UNKNOWN`へ落ちる |
| `sensor_provenance`の束縛 | 同上。所有の主張に裏取りが無い |
| `affected_tests` | `AFFECTED_TEST_DRIFT`。宣言と観測がTODO単位でexact一致を要求される |

非dispatchableだと競合が投影されないので、**翻訳したのに競合辺が立たず、変換の便益が測れない**
（実測で`parallelism_improved:no_gain:1->1`に当たった）。装置が「証明できない宣言」を正しく
拒否しているのであって、拒否を回さずに通す道を作ってはいけない。裏取りに使えるqueryがrunに
無ければ、広げずに`observation_unbacked`を返す。

**affected test driftの比較単位も変えた。** 束縛ごとに宣言全体とexact比較していたので、
affectedの異なる2 pathを所有するTODOは原理的に成立しなかった。全affected束縛の観測の**和**と
比較する。1面しか持たないTODOでは結果が変わらない。

**既に所有と書き込みを宣言している側は触らない。** 観測が予測の内側にあるなら合わせるものが
無い。翻訳が手を入れてよいのは、観測が予測を超えた分だけである。

## 請求項8を選ぶ条件が無い

`routeConflictTreatment`は**事前宣言済みのtreatmentが係争pathを覆っている時だけ**
`seam_transform`を返し、それ以外は全て`intentional_serial`である。つまり請求項8は「誰かが
事前に変換を宣言していた」時にしか選ばれない。**実行時に初めて見つかった競合は、翻訳段を
入れても既定では直列化へ行く。**

変換を試みる条件を決める必要がある。分割可能な縫い目があるかは`seam-proposal`が判定できるので、
それを実行時レーンから引けるようにするのが素直に見えるが、実験と裁定が要る。

## 工程

- [x] 予測超過の語彙を裁定して直す
- [ ] 観測された実態へ宣言を合わせる翻訳段を作る
- [ ] 実行時競合で請求項8を選ぶ条件を決める

---

# 請求項の充足状況

製品目標は特許請求の範囲12項の体現である（正本は`AGENTS.md`が指すPatent repo。請求項本文はここへ複製しない）。
2026-07-27時点の実コード照合結果。

**出願済み: 2026-07-27・特願2026-178950「情報処理装置、ソフトウェア開発制御方法及びプログラム」・
請求項12項。** 出願日が確保されたので、公開面へ出さないという制限は解けている。
出願人の氏名・識別番号は公開面へ書かない——出願番号で一意に参照できるので、repoへ置く必要が無い。

**読み方の前提。** 権利の軸と製品の軸を混ぜない。請求項は限定が少ないほど広く、強い。機能が
書かれていないのは欠落ではなく強さである。本表は「製品として何を作るべきか」の軸だけを見る。
請求項へ限定を足す提案ではない。実装が持つ詳細——不明資源の三値、carry-over証明、採用の五条件——は
明細書に開示され、補正・分割材料として保持されている。請求項を広いまま保つのが正しい設計である。

| 項 | 状況 | 根拠 |
|---:|---|---|
| 1(a) 影響範囲の推定 | **成立** | 項2と同じ |
| 1(b) 変換後に並行配置 | **実装済み** | `seam-proposal apply`／`land`が隔離worktreeで実変換し、五条件を満たした変換だけを着地させる。実データで`src/todo-gantt-html.mjs`が四面へ分かれ、再compileで競合1→0（[記録](evidence/2026-07-27-rt-007-version-barrier.md)） |
| 1(c) 並行実行制御 | 実装済み | `runtime-engine.mjs`が`capacity.executors`まで同時dispatchし、eventごとにready frontierを再評価 |
| 2 AIへの入力と出力 | **成立** | 装置の境界はLatticeのプロセス境界ではない。操作するAIも装置の一部であり、推定部は「AI＋sensor＋witness契約＋検証」として実現している。`todo status`が自然言語の作業仕様を渡し、MCPの`lattice_sensor_explore`が解析情報を渡し、advisoryの`declare_witness_set_then_compile`が出力を促し、compileがsensor再観測でexact照合する |
| 3 構造グラフ | 物は在る | sensorのnode／edge知識グラフ。ただし項2従属 |
| 4 読取り／書込みからの競合判定 | 実装済み | `runtime-front-end.mjs`のwrite×read/write交差 |
| 5 競合時のリファクタリング | **実装済み** | 宣言anchorのsymbolを所有面へ移し、未宣言の依存先を共有面へ、残りを残余面へ分ける。公開ビルドが他所のprojectでも実行できることを確認済み |
| 6 前後比較と再推定 | **実装済み** | 五条件が外部挙動同等性（原pathの公開面）・focused test・再index・重複解消（対象競合の消滅とplan全体の競合対の非増加）・実行段階数の改善を測る。1つでも欠けたら棄却 |
| 7 一方停止・他方commit・再開 | **確定の手段が入った** | 停止と再開は実装済み。各TODOは隔離worktreeで走り、freeze後は影響閉包内だけhold、閉包外は`carry_over_witness`（`todo_input`／`boundary_manifest`／`validator`／`context_content`のdigest＋非重複証拠＋receipt binding）を実証できた場合だけ継続する。請求項が版管理commitで果たす「他方の確定」を、隔離worktree＋暗号学的witnessで果たしている。`commit`が`FORBIDDEN_OPERATIONS`なのは公開契約の「承認なしに外部effectを行わない」に由来するので、明示承認付きのcommit経路を足せば思想と衝突しない |
| 8 双方停止・限定変換・双方再開 | **実装済み・製品面から到達可能** | 実行時に観測した競合から変換候補を導出し、隔離worktreeで五条件を通して`runtime_seam_split`を組む（[記録](evidence/2026-07-27-xf-003-runtime-transform-loop.md)）。入口は`lattice run seam resolve`で、事前宣言のない競合が実CLI・実sensor・実repoで変換され、返った後継baseに宣言した面が実在するところまで通る（[記録](evidence/2026-07-27-functional-parity.md)） |
| 9 実変更観測による実行時競合検出 | 実装済み | `detectCheckpointFindings`が`undeclared_write`と`observed_write_conflict`を返す |
| 10 対象作業群だけ停止して再計画 | 実装済み | `computeAffectedClosure`＋`recompileNextEpochPlan` |
| 11・12 | 1と同じ | |

「AIが推定する」を製品内のAI呼び出しの有無で測るのは誤りである。さらに、**装置の境界を
Latticeのプロセス境界へ引くのも誤りである**——操作するAIも装置の一部であり、推定部はすでに
「AI＋sensor＋witness契約＋検証」として実現している。ここへ「推定入口」を新設するのは過剰設計になる。

**裁定済み（2026-07-27・[ADR 0142](adr/0142-adjudicating-every-open-question.md)）。**
実変換campaignは`bounded-seam.mjs`の4ゲートを配線するのでなく、`seam-derivation`／`seam-rewrite`／
`seam-verification`／`seam-apply`という別経路を作り、五条件（ADR 0138）で受入を決めた。よって
`bounded-seam.mjs`とRC1〜RC3の実験moduleは**研究成果物であって製品ではない**。消さずに残すが、
製品と区別する——`npm run check:reachability`が入口から辿れる集合を機械的に出し、辿れないものは
理由つきで宣言されている場合だけ通す。現在、製品79 module・研究33 module。

この裁定で、名前だけ中核に見えるものも整理された。`boundary-compiler.mjs`（製品は
`runtime-front-end`の`compileRuntimePlanV1`）、`runtime-worktree-executor.mjs`（製品の隔離実行は
`isolation-runner`）など5本が、製品経路から一度も呼ばれていないことが分かった。
充足表の根拠へ研究moduleを挙げる事故は、以後gateが防ぐ。

---

# 実変換（請求項1(b)・5・6の閉ループ）

工程状態の正本はLattice storeの`real-transform` plan。

`seam_candidate`は「どこで切れば競合が消えるか」を、提案後ownershipでの仮想再compile（残余conflict 0）
まで確かめて記録する。**足りないのは、その切り方を実際のソースへ適用する側である。**
`bounded-seam.mjs`は隔離worktree、base_sha照合、scope drift検査、4ゲート検証（外部挙動同等性・
focused test・sensor鮮度・重複解消）、本repo不変のassertまで持つが、`transform`と`verify`は
注入引数であり、製品側が誰も渡していない。

閉ループの受入条件は、変換後のソースから同じ宣言で再compileして残余conflictが0になり、
かつ外部挙動が許容範囲内であることを**実測で**示すこととする。read-onlyの推薦で完了扱いにしない。

受入契約は[ADR 0137](adr/0137-real-transform-acceptance-contract.md)で確定した。適用可能な候補は
所有・共有・残余の三面をすべて挙げ、依存は「所有→共有」「残余→所有」の一方向に固定する。
現行の候補は所有面しか持たないため**そのままでは実行できない**——これは実行しようとした瞬間に
露見した欠落で、read-onlyで止まっている限り見えなかった
（[実行記録](evidence/2026-07-27-rt-001-transform-acceptance-contract.md)）。

## 工程

- [x] 実変換の受入契約とrc2断線の扱いを裁定する
- [x] seam_candidateからbounded seam candidateを導出する
- [x] 宣言anchorのsymbolを新surfaceへ移す変換器を実装する
- [x] 外部挙動同等性・focused test・再index・重複解消の検証器を実装する
- [x] 隔離worktreeで変換を実行する公開CLI面を足す
- [x] 採用した変換を本ツリーへ着地させ、再indexして残余conflict 0を実測する
- [x] accepted artifactをpredecessorにした新plan versionへ再コンパイルする
- [x] このrepoの実conflictで閉ループを1周させ、releaseまで通す

---

# 請求項の残り穴（推定入口と確定手段）

工程状態の正本はLattice storeの`claim-gap` plan。

実変換（`real-transform`）が請求項1(b)・5・6を持つのに対し、本工程は「一歩で埋まる」2件を持つ。

**宣言を書く道具（請求項の穴ではない）。** 請求項1(a)・2は成立している。操作するAIも装置の一部
であり、推定部を製品コードへ移設する必要はない——それは過剰設計である。

残るのは操作の摩擦だけである。宣言を手で書く際、`affected_tests`はfresh観測とexact一致が要り、
bytesはcanonicalでなければstore読みで落ちる。2026-07-27の作業では前者で1回、後者で1回落ち、
観測を取るための使い捨てscriptを1本書いた。要るのは推定器ではなく、**宣言したpathのaffected testを
観測して返す道具と、canonical bytesで書き出す道具**である。規模が一桁小さい。

**確定の手段（請求項7）。** 停止と再開は実装済みで、閉包外の継続は`carry_over_witness`で
不変量を固定している。ただし**これは今の実装が弱い**。

`recompileNextEpochPlan`は後継planへ`base_sha: plan.base_sha`を渡し、**baseを前進させない**。
carry-overで走り続ける作業が隔離worktreeへ変更を積んでいる間に、他の工程を再計画すると、
その再計画は**進行中の変更を含まないソース状態**に対して行われる。`carry_over_witness`が
非重複を証明するので安全ではあるが、閉ループの前提——作業後のソースで影響範囲を再推定する——が
半分崩れている。`carry_over_witness`が縛るのは入力側のdigestだけで、生み出した木は縛れていない。

隔離worktree内のdetached HEADへcommitすれば、canonical branchを動かさずにbaseを前進させられる。
外部effectを出さないことと、baseを現実へ合わせることは両立する。`FORBIDDEN_OPERATIONS`は
どこへのcommitかを区別せず全部禁じており、公開契約が懸念する範囲より広い。

したがってこの工程は「請求項へ合わせる」ためではなく、**再計画がstale baseで行われる弱点を直す**
ために行う。承認機構が要るかは、canonical branchへ出す段だけの論点として裁定に含める。

## 工程

- [x] 宣言を書く道具（観測済みaffected testの取得とcanonical書き出し）を足す
- [x] 明示承認付きの版管理commit経路を裁定して足す

---

# 実行時の限定変換（請求項8）

工程状態の正本はLattice storeの`runtime-transform` plan。

実行時競合の検出（`detectCheckpointFindings`）と処置レーンの振り分け（`routeConflictTreatment`）は
実装済みで、静的側の変換一式（導出・書き換え・五条件検証・隔離適用）も揃った。

足りないのは接続である。`routeConflictTreatment`は**事前宣言された処置**が競合pathを覆う場合だけ
`seam_transform`レーンへ送り、無ければ`intentional_serial`へ倒れる。実行時に競合を見てから
変換候補を導出し、隔離worktreeで五条件を通し、双方を再開させる経路が無い。

静的側との違いは入力だけである。静的側は記録済みseam提案を読むが、実行時は
finding（競合path＋2つのtask）と実行中requestの宣言を持つ。導出の芯は同じなので、
入力の口を分けて共有する。

## 検知方式の裁定（2026-07-27）

実行時の検知は**予約でもI/O傍受でもなく、checkpointでの事後diff観測**である
（`git status` ＋ `base..HEAD`、gitignore対象も含む）。

成立するのは隔離worktreeがあるからである。共有ツリーなら書いた瞬間に壊れるので予約かI/O傍受が
要る。各workerが自分のworktreeにいる限り、競合は「壊れた」ではなく「2つの版が分岐した」であり、
**巻き戻すべき共有状態が無い**。捨てる作業はあるが、元へ戻す操作は要らない——worktreeごと捨てる。

I/O検知より優れているのは速度ではなく**観測対象が確定した状態であること**である。個々のwriteは
確定した事実ではない。workerがfileを書いて同じstep内で消す、tempを作る、生成物を吐く——I/O検知は
それを競合として発火しうる。checkpointのdiffは確定状態なので、書いて消したものは最初から見えない。
偽陽性で止めれば、捨てる作業を減らすどころか止めなくてよいworkerを止めることになる。

I/O検知が買うのは**遅延**である。イベントは負荷時に落ちるので結局diffを真実として併用が要り、
macOS／Linux／Windowsで別実装になる。遅延を縮める最も安い手はcheckpoint間隔を詰めることで、
同じ機構のまま新しい失敗モードが増えない。

**I/O検知にしか取れないものが1つある。** worktreeの外への書き込み（絶対path、`/tmp`、ネットワーク）は
`git status`に映らず、現在まったく見えていない。これは速度ではなく**カバー範囲の穴**であり、
I/O検知を採る本当の動機になり得る。捨てた作業量を実測して見合うと分かった時、または
worktree外書き込みを塞ぐ必要が出た時に着手する。

## 工程

- [x] 競合findingと宣言から変換候補を導出する口を切り出す
- [x] 導出した変換を隔離worktreeで適用し、双方停止から双方再開へ繋ぐ
- [x] 実データで実行時競合から変換までを1周させ、releaseまで通す

---

# 実行時書き込みのカバー範囲

工程状態の正本はLattice storeの`write-coverage` plan。

**裁定・実施済み（2026-07-27・[ADR 0140](adr/0140-canonical-write-observation-is-recorded-not-assumed.md)）。**
実hostを駆動するmanaged supervisorが本repositoryの不変を検査していなかった穴を塞ぎ、
検査していない場合はそれを記録へ残すようにした。worktree外の一般的な書き込み（`/tmp`、home、
ネットワーク）は引き続き見えず、塞ぐならI/O検知かhost側のsandboxが要る。

**請求項9が主張する性質が、worktreeの外について成立していない。** 請求項9は「実際に変更された
資源の範囲を観測し、当該範囲が当該作業に対応する変更影響範囲の外に及ぶ場合…実行時競合を検出する」
と述べる。現在の観測は`git status`（＋`base..HEAD`）であり、worktree内は`--ignored=matching`で
gitignore対象まで漏らさず見る。しかし**worktreeの外**——絶対path、`/tmp`、ネットワーク、他repository
——への書き込みはまったく映らない。宣言scope外の変更を検出するという主張が、そこだけ成立していない。

これは速度の論点ではない。checkpoint間隔を詰めても、worktree外は永久に見えない。

**裁定済み（2026-07-28・[裁定記録](evidence/2026-07-28-io-detection-adjudication.md)）。
I/O検知を採用する。** ただし設問の立て方が2箇所で誤っていた。

**二択ではなかった。** I/O検知は平均の検出遅延に効き、checkpoint間隔を詰めるのは
**取りこぼした時の床**に効く。片方を選ぶ問題ではない。

**順序が逆になった。** 「実測してから裁定」と書いたが、実測に必要な数字はI/O検知が動く構成が
無いとそもそも測れない——早期検知が無い状態では「早く気づいていたら何秒節約できたか」は
反実仮想でしかない。実装して初めて対照が取れた。**発火条件を書く時は、その測定が現状の構成で
可能かを先に確かめる。**

実測（worker 2並列、`hold_ms = 8000`）: 検出は**8,000 ms（worker完了待ち）から663 ms**へ。
捨てる作業量は検出遅延に比例するので、**装置が決められない値（workerの実行時間）が装置が
決める値になった**。これが採用の根拠である。

checkpoint間隔（tick）は保留する。平均遅延を改善しないので動機は取りこぼしの床だけであり、
現時点で取りこぼしの実害を観測していない。発火条件: **fs eventの取りこぼしにより競合の検出が
worker完了まで遅れた事例が1件観測されたら**着手する。

worktree外への書き込みは依然として見えない。I/O検知を入れても変わっていない——今回のsentinelも
worktree内しか見ていない。ADR 0140の保留のまま残る。

## 工程

- [x] worktree外への書き込みを検出する
- [x] I/O検知の採否を、捨てた作業量の実測で裁定する

---

# 再計画の収束

工程状態の正本はLattice storeの`replan-convergence` plan。

**hold→再計画のループに収束保証が無い。** 過去epochのconflictを再seedしないguardは在るが
（`currentEpochConflictSequences`）、新しく観測されたconflictは毎epoch seedされる。原因が続く限り
「hold→再計画→再開→また同じ競合」が繰り返せる。epoch上限も無い。

原因は誤帰属に限らない。scope違反を繰り返すworkerでも、変換で解けない競合でも同じことが起きる。

性質は**安全性ではなく進行性**である。誤って並列化することはない——システムは常に止める側へ倒れる。
問題は止まらないことではなく**進まないこと**であり、しかも「同じ競合が繰り返している」という
typed signalが無いので、機械は延々と同じ処置を試み続ける。外からは「働いているが進んでいない」
状態に見える。

請求項10は対象作業群だけを停止して再計画すると述べるが、その再計画が収束する保証は述べていない。
自動でrunを回す構成ほど効いてくる。

解き方は「繰り返しを検出してtyped signalで止める」であって、直列化で誤魔化さない——誤帰属が原因なら
直列化しても解けず、解けないことを解けたように見せることになる。

## 工程

- [x] 同じ競合の再出現を検出して非収束をtypedに述べる
- [x] 非収束の再計画をfail closedにする

---

# 再開先へ変換を載せる（請求項8の未配線部）

工程状態の正本はLattice storeの`resume-base` plan。

**実行時のseam_transformレーンが整合していない。** 競合を観測し、隔離worktreeで変換し、五条件を
通して`runtime_seam_split`を組むところまでは動く。しかし：

- 変換した成果を**どこにも着地させていない**。静的側は`land`が本ツリーへ書くが、実行時側は
  `files`を返すだけで誰も使っていない。
- **後継planとpacketのbaseが前進しない**。`recompileNextEpochPlan`は`base_sha: plan.base_sha`を
  渡し、packetも`packet.base_sha`を引き継ぐ。`head_sha`は記録できるようにしたのに読んでいない。

結果、splitは「T1は`src/page-left.mjs`を所有する」と述べるのに、再開したworkerのworktreeは
変換前のbaseであり、**そのfileが存在しない**。請求項8は「競合の解消後に二つの作業を再開させる」
まで述べており、再開が成立していない。

素のhold／carry-overレーンは機能不全ではない。carry-over witnessが非重複を証明しているので、
止めた側と継続する側の成果は互いに素なdiffとして合成でき、baseが前進しなくても壊れない。
壊れるのは**変換でsourceの構造が変わる**seam_transformレーンだけである。

着地先はcanonical branchではない。変換をdetached commitとして確定し、`refs/lattice/seam/<id>`へ
繋いでGCから守る。branchは動かさず外部へ効果を出さないまま、後継が使える実在のbaseになる
（ADR 0139と同じ理由）。

## 工程

- [x] 採用された実行時変換をcommitとして確定しshaを返す
- [x] 後継planとpacketのbaseを前進させる
- [x] 再開先のworktreeに変換が載っていることを実データで確かめる

---

# 実行時変換レーンを本番から到達可能にする

工程状態の正本はLattice storeの`functional-parity` plan。

**変換の中身は動くが、実運転からそこへ行く道が無い。** `resolveRuntimeSeamTreatment`——観測した
競合をその場で変換して解消する、請求項8の一手——の呼び出し元はtestだけである。実運転側が使う
`routeConflictTreatment`は「事前宣言済みtreatmentがそのpathを覆う時だけ`seam_transform`、それ以外は
常に`intentional_serial`」なので、**予期しなかった競合は変換にかからない**。壊れて止まるのではなく
直列へ退化するだけなので、runは緑のまま進み、欠落が表に出ない。

管理runtimeでの再開baseは、後継run requestの`repo.base_sha`が決める。`resolveRepoBinding`が
`repo HEAD === request.repo.base_sha`を要求し、後継planは`compileFromRepo`でそのtreeから
compileされる。したがって`refs/lattice/seam/<id>`へ確定しただけでは後継treeに載らない。
**branchをそのcommitへ進めるのは操作するAIの仕事**であり、静的側の`land`と同じ責務分担である。
Latticeが持つのは、変換・検証・記録と、**後継baseが本当に変換を含むかの検査**である。

裏返すと、いまは`mode: 'seam_split'`の再計画requestが、変換を含まないbaseを指していても通る。
splitは新pathの所有を宣言するのに、compileされる後継treeにそのfileが無い——rb工程で直したのと
同じ欠陥が、管理runtimeの層に残っている。これはLatticeが検証すべき契約であって、推定ではない。

## 工程

- [x] 実行時変換レーンに本番の入口を作る
- [x] seam_split再計画で後継baseが変換を含むことを検証する
- [x] 事前宣言なしの競合から再開までを実CLIで通す
- [x] CLI表面の機能確認試験を棚卸しする
- [x] 未確認だったCLI機能の確認試験を足す
- [x] 確認試験で見つかった問題を直す

---

# 未決の一括裁定（完成宣言の前提）

工程状態の正本はLattice storeの`closing-questions` plan。

ADRのOpen questionsは25件ある。読み直すと3種類が混ざっている。

1. **後のADRで既に裁定したのに、元のADRへ戻って印を付けていないもの。** 0133 OQ1は0134の
   `candidate_paths`で、0133 OQ2は0137の残余面で、0137 OQ2は0138の五条件で、0139 OQ1／OQ2は
   0141で、それぞれ解決している。記録が古いだけである。
2. **いま裁定できるのに保留しているもの。** seam commitの寿命、変換の連鎖、配布物に残った
   未配線moduleの扱い。材料は揃っている。
3. **実データの発火条件を待つもの。** 複数の非劣位候補、同名conflict resource、共有面の粒度。
   これらは待つのが正しい。ただし**発火条件が本文に書かれていること**を条件とする。

「完成」と言えるのは、1と2が尽き、3が発火条件つきで明示されている状態である。未決が
「いつ誰が何を見て決めるか」不明なまま残っているうちは、完成ではなく放置である。

この工程はLattice自身で回す。witness setを宣言して`todo independence compile`にかけ、
並列可否を製品に判定させ、競合が出たら`seam-proposal`で切り方を出させる。自分の閉じ作業を
自分の製品で組めないなら、その製品は完成していない。

## 工程

- [x] ADRの未決25件を一括裁定する
- [x] 確定したseam commitの寿命を決めて実装する
- [x] 変換が連鎖した時のbase管理を決めて実装する
- [x] 未配線moduleの配布物での扱いを裁定する
- [x] 未決に発火条件を必須にするgateを足す

---

# 宣言道具と創作境界の噛み合わせ

工程状態の正本はLattice storeの`scaffold-creation` plan。

**2つの機能が組み合わさっていない。** [ADR 0136](adr/0136-declared-creation-boundary.md)は、まだ
存在しないpathの所有を`creates: true`の宣言で裏付けありにする。0.25.0で足した
`todo independence witness scaffold`は、宣言を書く摩擦（fresh観測・provenance配線・canonical bytes）を
引き受ける。だが**下書き契約に`creates`が無い**ため、新規fileを作るToDoの宣言を道具で作れない。

実害は測ってある。`closing-questions`工程で、新しいgate scriptを作るcq-005の宣言が
`affected_tests_unobserved`で断られ、既存file 2件だけで工程を進めた。新module・新doc・新testの
追加は実開発ToDoのかなりの割合を占めるので、道具が使える範囲が実際の作業から外れている。

自動導出にはしない（ADR 0135 Decision 3）。観測から機械的に創作境界と読むと、pathのtypoが
「必ず止まるエラー」から「黙って通る創作境界」へ変わる。下書きへ書く欄を足し、**道具は宣言が
実態と合っているかを確かめる側**を持つ——fresh absentであること、blast radiusが空であること、
front endが要求する形（`changedFiles`が対象1件）であること。

## 工程

- [x] 下書き契約へ創作宣言を足す
- [x] 観測の三値を保って創作境界を検証する
- [x] 新規fileを含む宣言を実データで作り、compileまで通す

---

# 実行時競合の早期警報（I/O sentinel）

工程状態の正本はLattice storeの`io-sentinel` plan。設計は
[ADR 0143](adr/0143-io-sentinel-is-an-early-warning-not-a-finding.md)。

**現在、競合はcheckpointを撮った瞬間にしか見つからない。** checkpointに周期は無く、timerも監視も
存在しない。hostがCLIを叩いた時——実質、workerが完了した時——とhold barrierの時だけ観測される。
つまり2つのworkerが同じfileを触っても、**片方が完了するまで誰も気づかない**。holdで捨てる作業量の
正体はこの窓である。

判定に要る材料は既にある。worktreeとTODOが1対1なら、書き込みイベントのpathからworktree rootを
剥がせばrepo相対pathになり、**そのpathが他のrunning TODOの宣言scopeに入るか**を見るだけでよい。
checkpoint findingとまったく同じ述語である。プロセス帰属は要らない——rootがそのまま帰属になる。

**ただしI/Oイベントをfindingにはしない。** findingの契約はcheckpoint digestを3箇所で必須にしており、
それはfindingが「事後に再読して再導出できる主張」であることを担保している。fs eventは取りこぼす
（FSEventsのcoalesce、inotifyのキュー溢れ）し、事後再読もできない。よってI/O検知は**早期警報**で
あり、判定の正本は今までどおりcheckpointとする。警報は「早くbarrierを張る引き金」にしかならず、
取りこぼしても今日と同じタイミングで必ず捕まる——**保証を一切緩めずに遅延だけを縮める**。

警報だけで止めると、書いて消したtempでも止めてしまう。二段にする。警報を受けたら無停止で
`captureWorktreeDiff`をprobeとして撮り、当該pathが**残っていれば**実在の重なりとして既存の
hold経路へ入る。消えていれば警報を記録して終わり。停止したあとは既存の処置がそのまま使える——
片方以外を止めてcommitして再開（請求項7）か、リファクタして解決して再開（請求項8）。

[ADR 0140](adr/0140-canonical-write-observation-is-recorded-not-assumed.md) Decision 3の
「I/O検知はやらない」は、worktree**内**の早期警報について狭く上書きする。worktree**外**
（`/tmp`、home、ネットワーク）は引き続き見えず、`write-coverage`の発火条件つき保留のまま残す。

## 帰属はrootに預けてある——だから共有rootでは成立しない

配線して分かったこと。**管理daemonのscripted構成は、全TODOのbindingが同じrepo rootを指す**
（`runtime-cli.mjs`のdispatch応答が`worktree_path: repoRoot`を返す）。sentinelの帰属はrootだけで
決まりプロセス帰属を持たないので、この構成では1件の書き込みが全watcherへ配られ、**誰が書いたかを
観測から言えない**。無実のTODOへ「他人のscopeへ書いた」と主張することになる。probeも助けにならない
——同じ木を2回読むので、両方が書いたように見える。

今日まで実害が出ていないのは、警報が拘束力を持たず、かつ監視をdispatch**後**に張るので
scripted controllerの書き込みを一度も拾えていなかったからである。**io-sentinelはまだ一度も
発火していない。** holdへ繋ぐ以上、ここを塞がずには進められない。

対処として、rootを共有して走っているTODOは監視しない。共有rootでも走っているのが1つなら帰属は
立つので見る。escalation側にも同じ確認を置く。見えないものを見えるふりにしないだけで、競合の判定は
従来どおりcheckpointが完全に担う——保証は1つも減らない。

**残る穴は早期警報に閉じない。** 並列workerが別々の木で作業し、実際に触った資源の観測から競合を
捕まえるのが装置の中核である。共有rootではcheckpointも「誰が書いたか」をrootから決められない。
`createWorktreeExecutorAdapter`（TODOごとに実worktreeを切る実装）は既にあるが、使っているのは
`rc3-scripted-campaign.mjs`という研究用ハーネスだけで、管理daemonからは呼ばれていない。
よって次の工程は「実測」ではなく**管理daemonをworktree分離dispatchへ広げること**とする。
実測はその上でしか意味を持たない。

## 発火させて分かったこと

worktree分離とworkerの非同期化を入れて、**io-sentinelは実runで初めて発火した**
（[受入証拠](evidence/2026-07-28-io-sentinel-live-run.md)）。そこで3つ分かった。

**1. probeは実装以来一度も動いていなかった。** `captureWorktreeDiff`をimportせずに呼んでおり、
観測失敗を丸めるための`.catch(() => null)`が`ReferenceError`ごと握り潰していた。返る値は
常に「観測できなかった（`unprobed`）」——**正常系の値**である。syntax checkもlintもtestも緑だった。
握り潰す範囲が広すぎると、壊れていることが正常系と区別できなくなる。再発は受入条件側で塞ぐ。

**2. 宣言と実writeが食い違わない限り、実行時競合は原理的に一度も起きない。** worktreeを分ければ
物理的な衝突は消えるので、残るのは論理的な重なり——宣言scope外への書き込みだけである。検知経路を
実runで通すには、それを意図して作れる必要がある（scripted controllerの`extra_writes`）。

**3. 警報からholdまでは、まだ通らない。** epoch駆動からの切り離しは済み、走行中のworkerに対して
`finding_record`→`conflict`→`intake_frozen`まで実runで到達する。残るのは**静止の証明**である。
直接OS観測はexecutorのprocessが実際に停止していることを要求するが、scripted controllerは自分の
processで作業するので、止めると制御そのものが止まる。`abandon`も同じ証明を要求するため、freezeだけ
掛かった状態のrunは進むことも畳むこともできない。よって**証明できない構成ではfreezeさせない**——
止まれない状態を作る方が危険である。埋めるにはexecutorを別processにする必要があり、dispatch応答が
workerのpidを運ぶので契約の版上げを伴う。

## 工程

- [x] 書き込み観測から警報を出すsentinel coreを作る
- [x] supervisor daemonへsentinelを配線し警報を耐久化する
- [x] 警報からprobeを経て自動holdへ繋ぐ
- [x] 管理daemonのdispatchをworktree分離へ広げ、実runで早期検知を発火させる
- [x] 設計をADRへ残しreleaseまで通す

epoch駆動の切り離しは、st-005を閉じた後に同じ流れで済ませた（[ADR 0143](adr/0143-io-sentinel-is-an-early-warning-not-a-finding.md)
Decision 8）。残りは下記の独立課題が持つ。

---

# executorのprocess分離（静止の証明）— 完了

工程状態の正本はLattice storeの`io-sentinel` plan（st-004・st-005の後、同じ流れで完了）。
設計は[ADR 0143](adr/0143-io-sentinel-is-an-early-warning-not-a-finding.md) Decision 9、
実測は[受入証拠](evidence/2026-07-28-io-sentinel-live-run.md)。

**holdの静止証明は、executorが自分を止められることを前提にしていた。** controller自身の
processで作業していると、止めれば応答できず止めなければ証明できない——構成として証明不能だった。
workerを別processへ出し、`detached`で独立process groupへ置き、barrierでSIGSTOPして止まった木を
読む形にした。dispatch応答は`worker_process`で誰を止めればよいかを名指しする
（`adapter_dispatch_response.v2`）。

これで**警報からholdまでが実runで1本に繋がった**。検出は8,000 ms（worker完了待ち）から
663 msへ縮んだ。従来値はworkerの実行時間そのものなので、長い作業ほど差が開く。

配線の途中で、この経路のholdが一度も実行されていなかったために露出していなかった不整合が
3件出た（artifact digestの取り違え、barrierが完走を待っていた、`process_children`欠落）。
さらに、attestationの形が読んでいたcodeと実際に流れているものとで違った——`direct_process_
observation`はv2、`direct_worktree_fingerprint`はv1である。**両側のdigestを出力させて初めて
分かった。** 推測で形を合わせようとした時間が最も長かった。

---

# 管理runtimeのLinux検証

工程状態の正本はLattice storeの`runtime-linux-parity` plan。

**管理runtimeのdaemon lifecycleは、いまmacOSでだけ検証している。** 公開CI（ubuntu）で
実daemonを起こす統合testを走らせると通らない。これは`process.platform === 'darwin'`の
gateで**skipしているが、skipは「Linuxで動く」という主張ではない**——未検証であることを
明示する印である。

分かっている不通過要因:

- `observeMacosBinaryIdentity`が`/usr/bin/codesign`に依存する。macOSにしか無い。
  署名済みhost binaryの同一性照合はmacOS固有の機能であり、Linuxでは別の手段が要る。
- **2026-07-28に依存が増えた。** worker processの分離で`detached` spawn・SIGSTOP・`/bin/ps`の
  `lstart`解析（process start identity）を使うようになった。いずれもmacOSでのみ検証している。
  `lstart`の書式はLinuxのpsと異なるため、静止の証明はそのままでは移らない。
- 残りの不通過箇所は未特定。socket所有の観測は移植済み（`runtime-socket-owner.mjs`）で、
  そこを直したら失敗は`RUN_NOT_MANAGED`から`RUN_OUTCOME_UNKNOWN`へ進んだ。daemonが
  起動後に落ちているが、原因はまだ切っていない。

**発火条件:** Linuxで管理runtimeを実際に使う必要が出た時、またはLinux利用者からの報告が
1件出た時に着手する。それまではmacOS検証済みとして扱い、READMEにもそう書く。

## 工程

- [ ] 管理runtime daemonがLinuxで通らない原因を特定する
- [ ] codesign依存をplatform非依存の同一性照合へ置き換えるか、macOS限定として契約へ書く
