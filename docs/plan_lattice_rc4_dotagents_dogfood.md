# Lattice RC4 — dotagents実戦dogfood（staged real-repo campaign）

- Status: Draft（docs-only。execution開始時にElastic Controlを初期化する）
- Date: 2026-07-17
- 前提Decision: [ADR 0044](adr/0044-rc3-runtime-contract.md)・[ADR 0045](adr/0045-rc3-phase-gate-support.md)
- 予定Decision: ADR 0046（RC4開始時に本planの契約を不変化し、ADR 0044 Decision 9.5の
  writer target制限をstage条件付きで上書きする）

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
  （AGENTS.md所有境界。編入は正式な導入planでdotagents側が行う）。
- 自動dispatch常駐サービス化、push／remote作成、CI hook常設（すべて編入後のdotagents所有）。
- multi-provider actual executorの網羅（RC3の非目標を継承。必要になれば別campaign）。
- Codegraph本体の改変・fork（従来どおり正規CLI/SDKのみ。公開面不足の再現時はADR 0044系の
  裁定どおり別repoの所有fork）。

## 所有境界とDecision 9.5の扱い

ADR 0044 Decision 9.5は「Lattice自身・dotagents・Observerをdogfood writer targetにしない」と
固定している。RC4はこれを**黙って破らず**、ADR 0046で次のstage条件付き上書きを裁定してから
実行する：

- Stage 0: writerなし（read-only）。9.5に抵触しない。
- Stage 1: writer targetは**dotagentsのdisposable clone**（tmpdir配下、正規repoへ不着地）。
- Stage 2: 正規dotagentsへの着地は、Latticeのreceipt受入後に**従来のreview→pathspec commit経路**
  だけで行う（Latticeが直接commit/pushしない）。dispatch batchごとにH gate承認。

## Stage 0 — read-only実測（witnessコストと判定品質）

- [ ] dotagentsの実TODO候補からbatch（TODO 6〜10件、`control-record.mjs`系・adapter系・docs系を
      混在）をオーナーと選定し、batch定義をevidenceへ記録する。
- [ ] 各TODOのboundary witnessを親が実際に作成し、**作成時間・参照した証拠・書けなかった項目**を
      1件ずつ実測記録する（丸め・事後推定の禁止）。
- [ ] dotagents cloneへ`codegraph init`し、`lattice plan compile`で全batchをcompileする
      （non-dispatchableはcode込みで記録。unknownの内訳＝Codegraph盲点／witness不足を分類する）。
- [ ] 判定品質の照合: conflict／wave／unknown判定を親が1件ずつ「妥当／過剰serial／見逃し」で
      裁定し、**見逃し0件**を確認する（見逃しは即refute条件）。
- [ ] shell hooks・markdown憲法・巨大単一fileなど**call graph非可視の結合**がwitnessで表現
      できたかを個別に記録する（RC4の主要リスク領域）。
- [ ] Stage 1 gateを裁定する: witnessコスト閾値・unknown率・判定一致率の実測値に基づき、
      Stage 1のtarget（dotagents cloneで進むか、先に中リスクrepoで肩慣らしするか）を決定し、
      根拠付きでevidenceへ記録する。

## Stage 1 — disposable cloneでの閉ループ（実タスク・不着地）

- [ ] ADR 0046をcommitしてからControl初期化（H task承認snapshot含む。RC3-Iの作法を継承）。
- [ ] dotagents disposable cloneをdogfood targetに、実小粒タスク（docs更新・test追加・
      adapter表更新など非破壊系）でrun request＋witnessを作成する。
- [ ] actual executor 2+へ隔離dispatchし、閉ループ（観測→競合→hold→carry-over→vN+1→
      redispatch→受入）を実タスクで完遂する（注入competitionは1件以上、自然発生も記録）。
- [ ] `control-record.mjs`級の巨大fileへTODOが集中するケースを意図的に含め、Latticeの答え
      （serial判定またはseam候補）と親の納得度を記録する。seam laneへ入る場合は
      predeclared treatmentの適用可否だけを判定し、制御盤の実分割はRC4非目標とする。
- [ ] artifact v3（実repo dogfood）をatomic発行し、artifact-only verificationをgreenにする。
- [ ] Stage 2 gateを裁定する: 境界事故0・受入품質・witnessコスト再実測。

## Stage 2 — 正規repoへの着地（review経路・H gate毎batch）

- [ ] 着地対象batch（小粒・可逆・非制御盤fileから開始）をオーナーと合意し、H gate承認を
      batchごとに記録する。
- [ ] Lattice受入済みreceiptのpatchを、親が従来のreview→pathspec commitで着地する
      （Latticeによる直接commit/push禁止を維持）。
- [ ] 着地後のdotagents full gate（当該repoの正規test/lint）greenと、境界事故0を確認する。
- [ ] n batch（最低3、うち1つは並列2 TODO以上の同時進行）を完了し、wall-clock・rework・
      手戻りを実測保存する。
- [ ] Phase gate: full CI、Fable read-only Phase反証、support／refute ADR（0047想定）、
      plan archive（RC3-Jの作法を継承）。

## 編入判定とCodegraph単独配線の退役（方向性の固定）

RC4がsupportで閉じた場合の後続は次の方向で進める（**実行はすべてdotagents所有の導入planで行い、
本planはLattice側の提供物と条件だけを定義する**）：

- [ ] Lattice側は編入パッケージ要件を文書化する: CLI 6面の安定契約（ADR 0044 Decision 8）、
      schema一覧（ADR 0044 Decision 2＋ADR 0045 Decision 4）、run store／artifact規約、
      executor adapter契約（claude-native等）、Codegraph同梱方針（正規CLI/SDK・MIT notice維持）。
- [ ] dotagents側の導入planに委ねる項目を明記する: core product編入の配線、単独導入Codegraph
      （host配線・MCP・session設定）の退役手順と互換期間、rollback、BugHub往復。
      **単独Codegraph削除はLatticeの編入と同一planで原子的に行い、移行期間中は二重配線を許す。**
- [ ] 退役の前提条件を固定する: Lattice経由でCodegraphの既存用途（session内code intelligence）が
      同等以上に提供できること。できない用途が残る場合は残存配線を明示して部分退役に留める。

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
