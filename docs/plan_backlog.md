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

# 請求項の充足状況

製品目標は特許請求の範囲12項の体現である（正本は`AGENTS.md`が指すPatent repo。請求項本文はここへ複製しない）。
2026-07-27時点の実コード照合結果。

**読み方の前提。** 権利の軸と製品の軸を混ぜない。請求項は限定が少ないほど広く、強い。機能が
書かれていないのは欠落ではなく強さである。本表は「製品として何を作るべきか」の軸だけを見る。
請求項へ限定を足す提案ではない。実装が持つ詳細——不明資源の三値、carry-over証明、採用の五条件——は
明細書に開示され、補正・分割材料として保持されている。請求項を広いまま保つのが正しい設計である。

| 項 | 状況 | 根拠 |
|---:|---|---|
| 1(a) 影響範囲の推定 | **成立** | 項2と同じ |
| 1(b) 変換後に並行配置 | **未実装** | 提案（`seam_candidate`）で止まる。提案surfaceはディスク上に存在せず、artifact自身が`hypothetical_new_surfaces`とラベルする |
| 1(c) 並行実行制御 | 実装済み | `runtime-engine.mjs`が`capacity.executors`まで同時dispatchし、eventごとにready frontierを再評価 |
| 2 AIへの入力と出力 | **成立** | 装置の境界はLatticeのプロセス境界ではない。操作するAIも装置の一部であり、推定部は「AI＋sensor＋witness契約＋検証」として実現している。`todo status`が自然言語の作業仕様を渡し、MCPの`lattice_sensor_explore`が解析情報を渡し、advisoryの`declare_witness_set_then_compile`が出力を促し、compileがsensor再観測でexact照合する |
| 3 構造グラフ | 物は在る | sensorのnode／edge知識グラフ。ただし項2従属 |
| 4 読取り／書込みからの競合判定 | 実装済み | `runtime-front-end.mjs`のwrite×read/write交差 |
| 5 競合時のリファクタリング | **未実装** | 切り方を決めて仮想検証するところまで。ソースは書き換えない |
| 6 前後比較と再推定 | 半分 | 仮想再compileで残余conflict 0は確認する。実変換していないので外部挙動の前後比較は走らない |
| 7 一方停止・他方commit・再開 | **確定の手段だけが違う** | 停止と再開は実装済み。各TODOは隔離worktreeで走り、freeze後は影響閉包内だけhold、閉包外は`carry_over_witness`（`todo_input`／`boundary_manifest`／`validator`／`context_content`のdigest＋非重複証拠＋receipt binding）を実証できた場合だけ継続する。請求項が版管理commitで果たす「他方の確定」を、隔離worktree＋暗号学的witnessで果たしている。`commit`が`FORBIDDEN_OPERATIONS`なのは公開契約の「承認なしに外部effectを行わない」に由来するので、明示承認付きのcommit経路を足せば思想と衝突しない |
| 8 双方停止・限定変換・双方再開 | 半分 | `seam_transform`／`intentional_serial`への振り分けは在る。限定変換の実施が無い |
| 9 実変更観測による実行時競合検出 | 実装済み | `detectCheckpointFindings`が`scope_violation`と`observed_write_conflict`を返す |
| 10 対象作業群だけ停止して再計画 | 実装済み | `computeAffectedClosure`＋`recompileNextEpochPlan` |
| 11・12 | 1と同じ | |

「AIが推定する」を製品内のAI呼び出しの有無で測るのは誤りである。さらに、**装置の境界を
Latticeのプロセス境界へ引くのも誤りである**——操作するAIも装置の一部であり、推定部はすでに
「AI＋sensor＋witness契約＋検証」として実現している。ここへ「推定入口」を新設するのは過剰設計になる。

実装根拠として過去に挙げた`bounded-seam.mjs`は自分のtestからしか呼ばれず、`rc2-campaign.mjs`と
`rc2-delivery-policy-transform.mjs`はどこからもimportされていない（`npm run check`の対象外）。
実変換campaignはこの断線も含めて解消する。

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
- [ ] このrepoの実conflictで閉ループを1周させ、releaseまで通す

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

- [ ] 宣言を書く道具（観測済みaffected testの取得とcanonical書き出し）を足す
- [ ] 明示承認付きの版管理commit経路を裁定して足す
