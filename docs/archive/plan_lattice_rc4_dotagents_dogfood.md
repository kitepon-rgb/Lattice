# Lattice RC4 — dotagents実戦dogfood（staged real-repo campaign）

- Status: Active（execution開始。Control初期化はStage 1開始時）
- Date: 2026-07-17
- 前提Decision: [ADR 0044](../adr/0044-rc3-runtime-contract.md)・[ADR 0045](../adr/0045-rc3-phase-gate-support.md)
- 予定Decision: ADR 0046（**Stage 1開始時**に本planの契約を不変化し、ADR 0044 Decision 9.5の
  writer target制限をstage条件付きで上書きする。Stage 0は9.5非抵触のため先行してよい）
- **親裁定（2026-07-17オーナー裁定）**: Latticeはdotagents統括の直轄コア製品となった。本planの親正本は
  dotagents `docs/plan_lattice-factory-integration.md`（Phase L1〜L5が本planのStage 0〜2に対応）。
  「Lattice側統括→dotagents側統括への依頼・返答」構造は解体済み——両者は同一統括であり、
  本planは実行計画、親planが裁定と編入契約を持つ。

## 目的

RC1〜RC3はLatticeの機構主張（境界compile・schedulability・runtime閉ループ）をdogfood
fixtureで実証した。RC4は舞台を**実repo（dotagents）**へ移し、「実TODO流・実コード・実agent」で
製品として使い物になるかを段階的に判定する。RC4を通過した場合、Latticeはdotagentsの
core productへ編入され、dotagents側で単独導入されているCodegraph配線はLattice内蔵の
sensorへ統合・退役される（編入・配線・退役の実行はdotagents所有）。

## H1-RC4（本campaignの主張）

実repoの実TODO集合に対して、(a) boundary witnessの作成が実用コストに収まり、
(b) Latticeのconflict／wave判定が親の裁定と実質一致し、(c) 隔離executor経由の実変更を
境界事故ゼロで受入・着地できる。

### 反証条件（一つでも成立すればH1-RC4をrefuteし、correction planを立てる）

- witnessが実TODOに対して書けない、または作成コストが常軌を逸して高く、Stage 0の
  実測でgate閾値（Stage 0完了時に実測に基づき確定・記録する）を超える。
- Codegraph＋manual witnessの証拠で、実在する結合（実行時に競合として顕在化したもの）を
  見逃してdispatchableと誤判定した事例が発生する（安全側の過剰serialはrefute要件ではない）。
- Stage 2で受入済み変更が境界事故（他TODOの書込破壊・宣言外の着地・canonical汚染）を起こす。
- 判定の丸め・未実測の0埋め・fail-openがartifact／evidenceに発見される。

## 非目標

- Latticeの研究思想・スキーマをdotagentsの工場規則（憲法・orchestrate正典）へ直接書き戻すこと
  （直轄化後も維持。編入は親planを起点にし、正典への還流は編入受入後に別途裁定する）。
- 自動dispatch常駐サービス化、CI hook常設（編入後の親plan所有）。**MCP面の新設は非目標ではない**
  （親plan Phase L3。MCP serverはsession寿命のstdio serverであり、自動dispatch常駐basicとは別物）。
- multi-provider actual executorの網羅（RC3の非目標を継承。必要になれば別campaign）。
- ~~Codegraph本体の改変・fork~~ — **2026-07-17のオーナー裁定で撤回**。Codegraphは完全吸収・置換の対象で、
  公開面・情報量の不足が実測で再現した場合はfork＋改良する（MIT・notice維持）。ただし
  **fork判断はStage 0の実測を根拠にする**——それまでは第三者製品として正規CLI/SDKのみ使う（予断で改造しない）。
  裁定と改良は親plan Phase L2が所有する。

## 所有境界とDecision 9.5の扱い

ADR 0044 Decision 9.5は「Lattice自身・dotagents・Observerをdogfood writer targetにしない」と
固定している。RC4はこれを**黙って破らず**、ADR 0046で次のstage条件付き上書きを裁定してから
実行する：

- Stage 0: writerなし（read-only）。9.5に抵触しない。
- Stage 1: writer targetは**dotagentsのdisposable clone**（tmpdir配下、正規repoへ不着地）。
- Stage 2: 正規dotagentsへの着地は、Latticeのreceipt受入後に**従来のreview→pathspec commit経路**
  だけで行う（Latticeが直接commit/pushしない）。dispatch batchごとにH gate承認。

## Stage 0 — read-only実測（witnessコストと判定品質）

- [x] dotagentsの実TODO候補からbatch（TODO 6〜10件、`control-record.mjs`系・adapter系・docs系を
      混在）をオーナーと選定し、batch定義をevidenceへ記録する。**凍結不要の運用合意（オーナー裁定
      2026-07-17）**: Stage 0はread-only判定のみでdotagents側の消化を止めない。activeレーンのTODOから
      出してよく、判定のstale化はそれ自体を実測記録とする（stale化の頻度も実戦データである）。
      — 2026-07-17完了: [batch定義evidence](../evidence/2026-07-17-rc4-stage0-batch.md)（T1〜T6・オーナーGO）
- [x] batch定義evidenceへ**dotagents私有caveatの該当エントリを添付する**:
      `orchestrate-run-worker-run-record-approach-family-ref-null`（`lineage.approach_family_ref: null`が
      BUDGET_UNKNOWNで拒否される・reproduced）、`orchestrate-run-cli-internal-error-lib`
      （INTERNAL_ERRORは未適用と限らずlib直呼びで実因確認・tentative）。既知の罠を再走しない。
      — 2026-07-17完了: batch定義evidence「添付caveat」節（5エントリ）
- [x] 各TODOのboundary witnessを親が実際に作成し、**作成時間・参照した証拠・書けなかった項目**を
      1件ずつ実測記録する（丸め・事後推定の禁止）。
      — 2026-07-17完了: [witness実測](../evidence/2026-07-17-rc4-stage0-witness-cost.md)（17〜36秒/件・
      書けなかった項目1件ずつ・ADR 0048で真値訂正）
- [x] **Lattice側clone/copy上にだけ**`codegraph init`し、`lattice plan compile`で全batchをcompileする
      （non-dispatchableはcode込みで記録。unknownの内訳＝Codegraph盲点／witness不足を分類する）。
      **dotagents正規repoにindexを作らない**——`.codegraph/`は存在せずgitignore対象外のため、
      live repoでの`init`は「正規repoへの書込ゼロ」契約違反かつdirtyを生む（実測確認済み）。
      — 2026-07-17完了: 改良前sensorはAFFECTED_TEST_DRIFTで停止（witness実測evidence）。L2改良後
      sensorで全batch再compile＝[compile判定裁定](../evidence/2026-07-17-rc4-stage0-compile-adjudication.md)
      （request A dispatchable・request B BOUNDARY_UNKNOWN、いずれもcode込み記録）
- [x] 判定品質の照合: conflict／wave／unknown判定を親が1件ずつ「妥当／過剰serial／見逃し」で
      裁定し、**見逃し0件**を確認する（見逃しは即refute条件）。
      — 2026-07-17完了: compile判定裁定evidence §4〜5（conflict 3件妥当・wave妥当・過剰serial 0・
      独立grep全数照合で**見逃し0**・unknown分類一致6/6）
- [x] shell hooks・markdown憲法・巨大単一fileなど**call graph非可視の結合**がwitnessで表現
      できたかを個別に記録し、**Codegraph盲点の発生頻度を定量化する**（RC4の主要リスク領域であり、
      同時に親plan L2のfork判断の一次データ。「不足している」を勘でなく数字で示す）。
      — 2026-07-17完了: 前半（witness実測＝ADR 0047/0048のfork判断一次データ）＋後半（md主体は
      `codegraph_empty` typed unknown、shell結合は(c2)クラス実例3件、compile判定裁定evidence §1・§5）
- [x] Stage 1 gateを裁定する: witnessコスト閾値・unknown率・判定一致率の実測値に基づき、
      Stage 1のtarget（dotagents cloneで進むか、先に中リスクrepoで肩慣らしするか）を決定し、
      根拠付きでevidenceへ記録する。
      — 2026-07-17裁定: compile判定裁定evidence §7（witness≤3分/件・drift写経0・dispatchable系
      unknown率0・判定一致100%維持。target＝dotagents disposable cloneへ直行、dispatchable
      3 TODO×capacity 2×2 waves最小構成、witness作法§3とrequest分割規則§5を焼き込み）

## Stage 1 — disposable cloneでの閉ループ（実タスク・不着地）

- [x] ADR 0046をcommitしてからControl初期化（H task承認snapshot含む。RC3-Iの作法を継承）。
  - 2026-07-17: Control `lattice-rc4-dotagents-v1`（rev 0-2）・H task `RC4-S1-stage1-dogfood-v1`
    approval snapshot付き
- [x] **executor隔離の必須条件を満たす**（ADR 0046のpacket契約へ焼き込む。親plan L4）:
      隔離HOMEでexecutorを実行し、packetで`install.sh`・`spotter install`・`apply-codex-config`・
      `mcp add`系の実行を禁止する。**根拠**: cloneはdotagentsの生きたオンボーディング正典
      （CLAUDE.md→@AGENTS.md）を搬送し、Claude executorが自動読込する。その正典は「新規エントリ追加後は
      `install.sh`再実行が必要」等のhost変更手順を実行可能な形で含む。`install.sh`はHERE解決＋`ln -sfn`のため、
      clone内で実行されるとhostの`~/.claude`系symlinkがtmpdirを向き、clone廃棄後にdangling化する。
      RC3のDecision 9.2「executorはisolated worktreeだけへ書く」はこのvectorを検出しない。
  - 2026-07-17: 隔離HOMEは認証不能（credential取扱いは統括権限外）のためオーナー裁定「2でいい」で
    [ADR 0050](../adr/0050-stage1-executor-isolation-implementation.md)の実装形（subagent executor＋
    packet `isolation_contract`＋前後fingerprint境界検証＋diff observer）へ確定。禁止コマンドは
    全packetへ焼き込み（artifact検査 `isolation_contract_complete`で機械検証）
- [x] dotagents disposable cloneをdogfood targetに、実小粒タスク（docs更新・test追加・
      adapter表更新など非破壊系）でrun request＋witnessを作成する。
  - 2026-07-17: round 1（TA/TB/TC・control-record交差）＋round 2（TD/TF・注入用）。
    witness作法はStage 0 compile判定裁定evidence §3を適用しdrift 0
- [x] actual executor 2+へ隔離dispatchし、閉ループ（観測→競合→hold→carry-over→vN+1→
      redispatch→受入）を実タスクで完遂する（注入competitionは1件以上、自然発生も記録）。
  - 2026-07-17完了: [Stage 1 evidence](../evidence/2026-07-17-rc4-stage1-dogfood.md)。round 1＝
    conflict serialization（TA受理→TB dispatch・受理3/3）、round 2＝注入scope_violation→
    hold {TD}/continue {TF}→vN+1→TF carry-over受理→TD redispatch受理。**自然発生も記録**＝
    TD executorの実API障害をunknownとして同一handle回収（演出でない実観測）
- [x] `control-record.mjs`級の巨大fileへTODOが集中するケースを意図的に含め、Latticeの答え
      （serial判定またはseam候補）と親の納得度を記録する。seam laneへ入る場合は
      predeclared treatmentの適用可否だけを判定し、制御盤の実分割はRC4非目標とする。
  - 2026-07-17: TA×TB＝3,711行`control-record.test.mjs`共有write→serial判定。親裁定＝妥当・
    過剰serialなし・見逃し0（evidence「照合」節）。seam laneは非発火（注入holdは
    intentional_serial lane）
- [x] artifact v3（実repo dogfood）をatomic発行し、artifact-only verificationをgreenにする。
  - 2026-07-17: `v3`（16 check green）＋`v3-hold`（17 check green・hold replay含む）
- [x] Stage 2 gateを裁定する: 境界事故0・受入품質・witnessコスト再実測。
  - 2026-07-17裁定（evidence「Stage 2 gate裁定」節）: 境界事故0（dotagents正典dirty 0・
    `~/.claude`/`~/.agents`無変化）・receipt 5/5 accepted・witnessコストは閉ループ支配項に
    ならず（支配項はexecutor実行61〜512秒/件）。**Stage 2へ進んでよい**（着地窓はオーナー合意待ち）

## Stage 2 — 正規repoへの着地（review経路・H gate毎batch）

- [x] 着地対象batch（小粒・可逆・非制御盤fileから開始）をオーナーと合意し、H gate承認を
      batchごとに記録する。
  - 2026-07-18: 着地窓オーナー承認「やれ」。batch 3件のH task（approval snapshot付き）を
    Controlへ記録・全finalize（rev 4-9）
- [x] Lattice受入済みreceiptのpatchを、親が従来のreview→pathspec commitで着地する
      （Latticeによる直接commit/push禁止を維持）。
  - 前段でP1欠陥を発見・即時修理（receiptにpatch本文が無い→`b61ee3d`で捕獲・bind検査追加）。
    着地run `v4-landing`（19 check green）の全5 patchを親が実読reviewし、
    [Stage 2着地evidence](../evidence/2026-07-18-rc4-stage2-landing.md)の3 batchで着地
- [x] 着地後のdotagents full gate（当該repoの正規test/lint）greenと、境界事故0を確認する。
  - batchごとmake lint PASS＋focused green、最後に`make ci` exit 0（隔離HOME検証含む）。
    着地はH承認済み6 fileのみ＝逸脱0。push済み（dotagents `e117ac5`/`8a3befd`/`b248c46`）
- [x] n batch（最低3、うち1つは並列2 TODO以上の同時進行）を完了し、wall-clock・rework・
      手戻りを実測保存する。
  - 3 batch（batch2=並列受理対TD+TF・batch3=conflict対TA+TB統合）。着地本体約15分・
    rework=patch捕獲欠陥起因の再走約16分・それ以外の手戻り0（evidence実測サマリ）
- [x] Phase gate: full CI、Fable read-only Phase反証、support／refute ADR（0047想定→実番号0051）、
      plan archive（RC3-Jの作法を継承）。
  - 2026-07-18完了: full CI両repo green・`fable`×high refuter=**条件付きsupport**・
    クロスprovider検証（codex_review・指摘2件採用是正）・knowledge return（caveat＋契約正典還流）。
    一次記録は[L5 Phase gate evidence](../evidence/2026-07-18-rc4-l5-phase-gate.md)、
    裁定は[ADR 0051](../adr/0051-rc4-phase-gate-support.md)。Control finalize・archive・plan archive実施

## 編入判定とCodegraph単独配線の退役（方向性の固定）

RC4は**条件付きsupport**で閉じた（[ADR 0051](../adr/0051-rc4-phase-gate-support.md)）。
本節の未消化3項目は消さずに**dotagents導入plan＝`dotagents/docs/plan_lattice-factory-integration.md`へ
移管済み**（ADR 0051 Decision 6）: 編入パッケージ要件の文書化はPhase L6の先頭TODO、退役手順・互換期間・
前提条件（同等以上のshadow実証）は既存のL6/L7条項が正。本planでは追跡しない。

## 成功条件（要約）

1. Stage 0: batch全件のwitness実測記録があり、判定の見逃し0、gate裁定が根拠付きで記録される。
2. Stage 1: 実タスク閉ループがartifact v3として発行され、disk再検証green・境界事故0。
3. Stage 2: 最低3 batchが正規repoへ事故0で着地し、実測コストが保存される。
4. 全stageで、判定・受入がevent bytesから再計算可能（RC3の検証規律を維持）。
5. 編入要件文書がdotagents導入planへ引き渡せる状態で存在する。

## 既知の罠

- witness作成コストがRC3で最重量だった（probe導出で回避した部分は実戦では使えない場面がある）。
- shell script・markdown・設定fileの意味的結合はCodegraphに写らない＝manual witness頼み。
  ここでの見逃しはrefute条件なので、疑わしきはunknown宣言で止める（fail closed）。
- `control-record.mjs`はほぼ全TODOと交差する。過剰serialは失敗ではないが、価値提案が
  「全部直列」になるならそれ自体をStage 1 gateの判定材料として記録する。
- dotagentsはBSD/macOS環境前提のshellが多い（caveat: BSD dateの`%N`罠等）。executor packetの
  verifier_refsに環境依存コマンドを入れない。
- RC3評価残（fsync・並行発行・多epoch CLI replay等）はRC4で自動的に直らない。必要になった
  段階でRC4のmaintenance queueへ入れる。

## Controlと配置

- Stage 1開始時（ADR 0046 commit後）に新しいElastic Control（`lattice-rc4-dotagents-v1`想定）を
  初期化し、risk=high・behavior lane=behavior-preservingでphase gateを固定する。
- F: batch選定・witness承認・gate裁定・受入・ADR。A: witness下書き・fixture準備・実測集計。
  H: Stage 1以降の全actual dispatch batch、Stage 2の着地。
- 監査はRC3の作法を継承する: 各段の契約クリティカルcommit前に異provider review 1回、
  Phase完了時にFable read-only反証1回。監査は増殖させない。

## Maintenance queue（非クリティカル欠陥。Phase通常TODO後のmaintenance wave一回で処理）

> 2026-07-18: 本queueはplan archiveに伴い、下記2件＋patch bind検証強化（ADR 0051 Decision 4）の
> 計3件を`dotagents/docs/plan_lattice-factory-integration.md`のmaintenance queueへ移管した。
> 以後の消化はdotagents側planが正。

- [ ] sensor: Lua/Luau/Rubyの`require()`検出は`visitNode`フック実装のため**関数本体内の
      requireを拾えない**（偽陰性。sensor改良(b) 2026-07-17実装中に発見・JS/TSと同型の穴）。
      対処はJS/TS同様`extractCall`合流点への移設。最小再現: 関数内`require 'mod'`を持つ
      Lua/Rubyファイルをindexし、imports辺が出ないこと。所有repo: Lattice（sensor/）
- [ ] CLI: `lattice plan compile`のtyped失敗が`cli_error.v1`の`code`/`message`だけを出し、
      compile resultの`detail`（BOUNDARY_UNKNOWNのunknown内訳・AFFECTED_TEST_DRIFTのmismatches）を
      落とす。診断にlib直呼びが必要だった（Stage 0後半 2026-07-17実測）。fail closed自体は正しく
      P0/P1非該当。対処候補: `cli_error.v1`へ`detail`を追加（schema変更＝ADR 0044 Decision 8の
      envelope暫定契約の正式化と同時に裁定）。最小再現: unknown入りwitnessでcompile→stderr JSONに
      内訳が無い。所有repo: Lattice（src/runtime-cli.mjs）
