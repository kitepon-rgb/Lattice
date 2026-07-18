# LG計画 Codex監査 5レーン（2026-07-18）

**対象:** `docs/plan_lattice_gantt.md`（ブラッシュアップ後 `0969701` 時点）
**実施:** dotagents統括（ベル）が aiterm `codex_agent` で5レーン並列委譲。全レーン読み取り専用・ファイル変更ゼロ。
**回収:** aiterm agent transcript／screen buffer から verbatim 回収（TUI折返し由来の改行整形のみ）。
**用途:** G1 ADR起草の一次入力。計画書への反映は同日 commit を参照。

| # | レーン | model×effort | 結果 |
|---|---|---|---|
| 1 | 既存契約整合（contract） | gpt-5.6-sol×max | P1×6・P2×3 |
| 2 | store×plan_graph関係（store-vs-graph） | gpt-5.6-terra×xhigh | 新todo store契約を推奨 |
| 3 | wave分割・受入（waves） | gpt-5.6-luna×xhigh | P1×9・P2×1（P0なし） |
| 4 | store schema/fail closed（schema） | gpt-5.6-sol×xhigh | P0×7・P1×5・P2×1超（決定文案付き） |
| 5 | レンダラ/UX実現性（renderer） | gpt-5.6-terra×high | P0×3・P1×3 |

---

## レーン1 — 既存契約整合監査（sol×max）

1. **P1 — G5 authoring CLIが既存CLI契約の受入対象として具体化されていない**
   - 根拠: ガントCLIについてはstdout 1行JSON・exit 0/1/2・`cli_error.v2`が明記されているが、`add/start/done/block`には入出力schema・exact argv・失敗時の無変更保証がない（plan:67–72, 119–121）。既存契約は余剰・重複引数もusage違反とし、typed failureだけをexit 1＋error JSONにする（ADR 0044:239–243、runtime-cli.mjs:63–76, 451–505）。
   - 修正提案: G1で全authoring subcommandのexact argv、成功result schema＋digest、exit matrixを列挙。exit 1はstderrへ`cli_error.v2` 1行、exit 2は現行どおりusage診断とするか、変更するなら明示ADR。exit 1/2時のstore bytes不変、atomic replace/CASも受入条件にする。

2. **P2 — `file://`絶対pathをstdout artifactへ入れるとportable digest規律を壊す**
   - 根拠: 計画はfile URLの出力を要求（plan:59–60）。既存契約はabsolute pathをidentityへ混ぜず、現行CLIもrepo相対`run_dir`を返す（ADR 0044:269–270、runtime-cli.mjs:347–355）。
   - 修正提案: stdoutは`output_ref: ".lattice/generated/gantt.html"`のようなrepo相対参照とdigestを返す。絶対file URLはstderr診断またはdotagents SessionStart adapterで解決し、portable result digestから除外する。

3. **P1 — critical pathの対象edge候補が既存契約と矛盾し、direct描画時のcycle拒否も失われる**
   - 根拠: typed edgeにはwrite/state/effect等のunordered conflictが含まれる（artifact-contracts.mjs:65–72）。Accepted ADRはintentional serialをprecedenceへ偽装することを禁止（ADR 0044:221–224）。`hard_need`だけでは別fieldの`joins`を無視する（artifact-contracts.mjs:584–590）。さらに新storeの直接描画を許しながらcycleはcompile側拒否を前提にしている（plan:73–77, 99–103）。
   - 修正提案: critical pathの有向関係を「`hard_need`＋joinの`after→before`」または現行schemaの`precedence`だけに固定。conflictはcritical pathへ入れない。store merge後に独立DAG validatorを必ず通し、cycle・dangling edge・重複edgeを投影前にtyped rejectする。

4. **P1 — started_at／done_atだけではblockedを投影できない**
   - 根拠: UIはblockedを表示し、CLIにもblock遷移があるが、statusは2時刻だけから導出とされている（plan:25, 56, 82, 119）。既存event契約では順序はtimestampでなく連番＋digest chainが正本（ADR 0044:64–）。
   - 修正提案: `start | block | unblock | done | out_of_order_override`等のclosed transition kind、sequence、previous_digest、actor、evidence bindingを持たせる。statusはjournal prefixからのみ再構成し、時刻は表示用診断値にする。snapshotは正本でなくprojection cacheとし、不一致を拒否する。

5. **P1 — tracked store／生成HTMLのCodegraph coverage・source identity分離が計画にない**
   - 根拠: storeをgit管理し、同じ`.lattice/`候補に生成HTMLも置くが、store以外も含めて「gitignore不可」と読める（plan:47, 91）。既存契約はruntime state／生成artifactをCodegraph coverageとsource identityから分離している。現在の除外はresearch/runs/等だけ（ADR 0044:257、codegraph.json:1）。
   - 修正提案: trackedなstoreとuntrackedな生成HTMLを別rootにする。storeはgit追跡する一方でCodegraph/source snapshotから除外し、store digestをGantt identityへ別途束縛する。HTMLは明示gitignore対象にし、codegraph files coverage integration testをG2より先に置く。

6. **P1 — Ganttの`source digest`が埋込Markdownを含む全入力へ束縛されていない**
   - 根拠: HTMLにはMarkdown節を埋め込むが、公開結果は曖昧な単数`source digest`だけ（plan:52–53, 67–80）。既存契約はcanonical digestとrepo相対pathのfail-closed検査を要求（00_product-contract.md:20–21、runtime-contracts.mjs:94–115）。
   - 修正提案: render request/resultに、store prefix digest、graph digest、各`narrative_ref`のrepo相対path・section・content digest、renderer version、HTML output digestを含める。symlink・遡上・欠落section・総bytes超過を拒否。Markdownはraw HTMLを通さない決定的subsetか完全escapeとし、`http(s)://`文字列検査だけでなく全URL-bearing属性・CSS・protocol-relative URLをallow-list検査する。

7. **P2 — 「1行1item canonical serialization」は現行canonical JSON／readerと同じ契約ではない**
   - 根拠: 現行`canonicalizeArtifact`はartifact全体を一つのcompact JSONへ変換し、readerもファイル全体を`JSON.parse`する（artifact-contracts.mjs:201–223、runtime-cli.mjs:95–123）。現行collectionは256、runtime planは8 node上限で「全ToDo統合」と同じ規模契約ではない（runtime-contracts.mjs:8–13）。
   - 修正提案: JSONLを採るなら、各行をexact-key versioned event＋自己digestとし、別canonical manifestがordered line digest、件数、総bytes、世代を束縛する新契約として定義。全ToDoはbounded shard＋manifest mergeにし、既存helperを無変更で再利用できるとは記述しない。

8. **P1 — `plan_graph.v1`だけを現行DAG正本とする前提が不完全で、実producerにはhard dependencyがない**
   - 根拠: Accepted ADR上は`plan_graph.v2`と`runtime_plan.v1`も既存公開契約（ADR 0044:34–42）。`plan_input.v1`のexact keysには依存関係がなく、現行v1 producerはconflict edgeだけを生成して`joins: []`固定（artifact-contracts.mjs:320–359、boundary-compiler.mjs:610–640）。現行runtime front-endも`precedences: []`を生成（runtime-front-end.mjs:658–674）。
   - 修正提案: G1に全plan familyの互換表を追加し、Ganttが読むcanonical directed graphを一つ選ぶ。dependencyを新storeのfirst-class fieldにし、各既存schemaからのversioned adapterを置く。`plan_input.v1`へfieldを足す場合はin-place変更せずv2化。非空の3段dependency＋joinを通す実fixtureを必須にする。

9. **P2 — 既存CLI面の棚卸しとsource docが現状とずれている**
   - 根拠: G1は「CLI 6面＋runtime-errors＋MCP」だけを列挙するが、entrypointには`--version`と`factory-diagnostics --json`もある（bin/lattice.mjs:6）。factory-diagnosticsはADR 0052でdoctor後継の正本（ADR 0052:43）。また実行コードはcli_error.v2だが、runtime-cli.mjsのdocstringだけがまだv1表記（runtime-cli.mjs:35）。
   - 修正提案: G1の既存面matrixへ`--version`、factory diagnostics、runtime-errors、CLI 6面、MCPを全て記載し、routing非回帰testを置く。runtime-cliのstale docstring修正も実装waveへ含める。

---

## レーン2 — store×plan_graph関係（terra×xhigh）

**結論: 軽量な新`todo store`契約を採用**し、source変更ToDoだけを既存のboundary/compiled-plan artifactへ**任意で厳格に束縛**する。`plan_input.v1→plan_graph`のインライン拡張は採らない。

- **既存系列拡張案の致命傷**: 既存graph系は「不変な、境界証拠つきのdispatch用compile結果」であり、日常の`start/done`を受ける可変工程台帳ではない。`runtime_plan.v1`はrequest/base SHA/manifest digestに束縛され、1〜8 nodeのexact-minimum用（runtime-contracts.mjs:310、ADR 0044:24）。status更新を同じartifactへ入れれば更新のたびにdigest・plan identityが変わり、compile/rebindの意味を壊すか再compileを強制する。既存v1はexact-keyでin-place field追加が禁止（runtime-contracts.mjs:3、ADR 0044:62）。
- **新todo store案の致命傷（対処可能）**: 無条件に独立させると工程上の依存とsource変更のboundary graphが乖離し「ガントでは開始可能、実際には未検証のsource TODO」という二重の真実が生まれる。store側にsource taskの**immutable compile binding**を設け、dispatch時に照合することで回避する。

評価表:

| 評価軸 | 既存系列の拡張 | 軽量な新todo store |
|---|---|---|
| 日常ToDo運用の摩擦 | 悪い（遷移にcompile/evidence一式が絡む） | 良い（CLIで直接更新） |
| boundary evidence | 強いが過剰適用 | source taskだけbinding必須で十分強い |
| digest/検証再利用 | status churnがplan digestを汚染 | canonicalization・digest chain・projectionを再利用可 |
| 複数plan統合 | local todo ID・small bounded plan・version barrierと衝突 | `plan_id + task_id`名前空間で直接merge可 |
| G5 enforcement | runtime stateと工程statusが別意味で不自然 | authoring CLIで直接強制可 |
| 実装コスト | 一見低いが世代追加・再compile・互換対策で高い | 新validator/projection必要だが境界単純・中程度 |

推奨契約境界:

```text
todo_store.v1
  task snapshot（plan/task namespace、hard dependency、散文ref、種別）
  + append-only transition journal
      started_at / done_at / evidence_refs
      status は journal の純粋projection
  + optional compile_binding（source taskのみ）
      boundary_manifest digest / compiled plan digest / topology digest / base SHA
```

- ガントはstoreの`hard_needs`を直接読んで描画・critical path投影する。追加・開始・完了・描画ではgraph compileしない。
- source変更taskを実行可能にする時だけ既存boundary manifest/compiled planへのbindingを検証。完了evidenceは「変更完了の根拠」であり並列安全性のboundary evidenceとは別物。
- topology digest（task・hard dependency）とstatus snapshot digestを分離。`done`更新でcompile bindingを無効化してはならず、依存変更では必ず無効化する。
- 既存canonical serialization・自己digest・連鎖検証・event-prefix projectionは再利用対象。runtime eventはrun専用closed kind集合なので流用せず汎用chain helperへ抽出（runtime-event-store.mjs:8、runtime-projection.mjs:1）。

実装上の落とし穴6件:
1. **名前空間**: node IDはplan-local。統合表示は文字列連結でなく`{plan_id, task_id}`をtask ref正本にし、cross-plan cycleをfail closed検査。
2. **snapshot/journal二重正本化**: journalを主、snapshotを`journal_head_digest`付きmaterialized projectionに固定。snapshotだけ書き換えて通る経路を作らない。
3. **Git並行更新**: digest chainは同時appendを自動mergeできない。CLIは期待head digestのCAS確認、競合はfail closed、専用reconcile/replayコマンドで新headを作る。
4. **時刻を順序根拠にしない**: `started_at/done_at`は表示・監査用。順序と有効性はjournal sequenceで判定（ADR 0044:79と同思想）。
5. **「CLI経由のみ」はファイル権限では実現しない**: Git上のJSONは直接編集できる。CI/`todo verify`でjournal・snapshot・dependency・done evidence・compile bindingを再検証して初めて強制になる。
6. **G5の状態機械をG1で決める**: `start/done/block/unblock(or resume)`、out-of-order overrideの理由、done evidence必須、source taskの開始前compile binding要否を閉じた遷移表として先に固定。後からv1へevent kindを足すことは既存規律と衝突。

前提訂正: 指定された「既存`plan_input.v1→plan_graph.v1`系列」は実装上RC1 artifact contractsにあり、runtime front-endは実際には`run_request.v1→runtime_plan.v1`を生成（artifact-contracts.mjs:331、runtime-front-end.mjs:732）。この世代差も既存v1を拡張せず新契約＋artifact bindingにすべき根拠。

---

## レーン3 — wave分割・受入監査（luna×xhigh）

観点別判定: ①成果物・受入条件=要修正 ②G1→G5の循環=異常なし（暗黙依存あり）③G4失敗時rollback=未定義 ④担当waveなし作業=あり ⑤複数repo交差調整=要修正。P0なし。

1. **P1 — G1のdone条件が検証不能**（plan:89–97）: ADRのパス、Accepted条件、未裁定論点ゼロ、schema fixtureや反証記録の有無がdone条件になっていない。→ADRファイル、確定schema、validator fixture、諮問・refuter・cross-provider記録、未解決論点ゼロを明示。
2. **P1 — G2〜G5の受入が広すぎ再現条件不足**（G2:99・G3:106・G5:119）: `focused gate green`「一目で判る」`npm run ci green`だけでは期待node数・critical path・status・時刻・hook出力・exit codeを検証できない。G5はdotagents変更を含むのにLatticeのCIだけ。→fixture、期待JSON/HTML、CLI stdout/stderr/exit、ブラウザ検証項目、dotagents `make ci`・`verify-install`・isolated HOME検証をwave別に固定。
3. **P1 — G1のstore選択と非目標が衝突し得る**（plan:73–77, 130）: 「plan_graph系列の拡張」を選ぶとschema変更が必要になる可能性があるが、非目標は`plan_graph` schema変更を禁止。→既存v1を変更しないadapter/store拡張か、wire級の別裁定が必要かをG1で明記。
4. **P1 — G4移行toolの暗黙依存と履歴時刻の扱いが未定義**（plan:100–103, 112–117）: G4はG1 schema・G2書込API・G3描画CLIに依存するが依存ゲート未記載。Markdownから`started_at/done_at`をどう得るか、欠落時unknown化、裁定後再登録が未定義。→`G1 accepted → G2 read/write API → G3 renderer → G4 migration`を明示し、履歴時刻欠落の変換規則と裁定・再実行手順を定義。
5. **P1 — Markdownからstoreへの切替barrierがない**（plan:41–43, 123–124）: G4移行後G5までMarkdown checkboxが残り二重正本期間が発生。→G4で移行snapshotを凍結し、G5のcheckbox除去・store正本化を一つのcutover gateとして扱う。
6. **P1 — G4のオーナー目視受入失敗時のrollbackが未定義**（plan:112–117）: 事前snapshot・restore入口・失敗後の再試行先がない。→G4開始前に両repoのHEAD・対象path・digestを記録し、失敗時は「G3 accepted artifact＋G4前snapshot」へ戻す。host settingsはH承認まで適用せず、適用済みならarchiveからrestore。
7. **P1 — 担当waveのない作業**: ①`unknown_requires_evidence`項目の裁定記録と再登録 ②dotagents hook adapter本体・settings fragment・isolated HOME検証・restore ③NPM配布・version pin・dotagents側CLI利用可能化 ④全master/子planのcheckbox inventoryとcutover ⑤公開契約・README・生成憲法・install/verifyの同期 ⑥G4受入証跡とreject/retry記録。→G4/G5配下に成果物・所有repo・検証コマンド付き明示TODOとして追加。
8. **P1 — Codegraph再解析・plan version barrierが計画にない**: source TODO前のboundary manifest・affected test・coverage確認、変換後の再index・再compileの担当waveがG2/G3/G5にない。→各source waveへCodegraph sync/query、affected test、受入後再index・再compile、旧context失効を追加。
9. **P1 — 複数repoの書込交差と調整順が未記載**（plan:5–6, 115, 122–124）: repo別write scope、commit順、artifact digestの受け渡し、owner gate、同時書込禁止がない。dotagents側hook配線・検証契約は別途存在（dotagents docs/03_settings-fragments.md:80、bin/verify-install.sh:356）。→G4/G5を「Lattice commit → NPM/adapter接続 → dotagents isolated HOME gate → owner H受入 → host apply」の段階に分け、repo別に独立revert可能なcommitを定義。
10. **P2 — 親計画との残TODO・開始条件が同期していない**（dotagents Phase LG:267）: 親計画のadapter設計・status遷移設計・Grok調査TODOがG1〜G5へどう編入・失効したか未表示。→対応表を置き、重複TODOを`SUPERSEDED`または編入済みとして明示。

---

## レーン4 — store schema/fail closed監査（sol×xhigh・決定文案付き）

Severity基準: P0＝G1受入blocker、P1＝writer公開前の必須裁定、P2＝表示・運用上の曖昧さ。

### ① snapshotとjournalの二重正本
1. **P0 — authoritative sourceと再生成方向が未定義**（plan:45）: snapshotだけ`done`へ変更／journalだけ追記／crashで片方だけ更新→読む面によって現在地が変わる。
   決定文案: 「工程状態の唯一の正本はgenesisから連続するtransition journalとする。snapshotは破棄可能なmaterialized projectionであり、`projection_version`、`through_sequence`、`journal_head_digest`、`snapshot_digest`を必須とする。readerはjournalを検証・replayしてsnapshotとcanonical exact一致しない限り`STORE_INCONSISTENT`でstore全体を拒否し、暗黙再生成しない。」
2. **P0 — topology変更とstatus履歴の境界がない**（AGENTS.md:38のversion barrier、plan:126の非目標との接続未定義）:
   決定文案: 「一つの`plan_version`に属するnode、dependency、join、lane topologyはimmutableとする。`todo add/remove`および依存変更はsuccessor plan versionをcompileし、新store genesisを旧version digestとnode migration mapへbindする。lifecycle journalは固定node集合の状態だけを変更し、topology eventを持たない。」
3. **P0 — status projectionの状態機械が不足**: 2時刻投影ではblocked/resume不能。duplicate start、done-before-start、block-after-done、依存未完了doneの読取時検証がない。CLI書込時だけの拒否は手編集やGit mergeを防げない。（決定文案はレーン1指摘4と同方向: closed transition kind＋sequence＋prefix再構成＋読取時検証）

### ② canonical serializationとcompaction
4. **P1 — 「1行1item」がfile byte契約になっていない**: 現行canonicalizerはparsed JSON value全体をminifyするだけでLF/JSONL framingを所有しない。実査でduplicate `schema` keyは`JSON.parse`後に末尾値だけが残った。
   決定文案: 「journalはUTF-8・LF終端JSONLとし、一行一event、各行は`canonicalizeArtifact(event) + LF`とbyte-exact一致しなければならない。snapshotは単一canonical JSON value＋LF。event digestはschema・store identity・plan bindingを含むtyped preimage、segment digestはexact file bytes、snapshot digestはself-digest規則。collectionの並び順もfieldごとに規定する。」
5. **P1 — compactionすると現行append-only chainを破壊**: 現行event verifierはsequence 0からgapなし完全列を要求（runtime-event-store.mjs:187）。prefix削除後にsnapshotを新genesis扱いするとsnapshotが事実上の第二正本になる。単一配列は256 item／1 MiB上限にも衝突。
   決定文案: 「v1のcompactionは削除ではなくimmutable segmentのseal/rotationと定義する。各segmentは開始・終了sequence、前segment head digest、segment digestを持ち、過去segmentはtracked bytesのまま変更・削除しない。snapshot checkpointだけを新genesisとしてprefixを捨てる操作はv1で禁止し、真正な履歴削除は別schema・別ADRとする。」

### ③ 複数plan merge
6. **P0 — node IDがplan-localのままで衝突**（artifact-contracts.mjs:622は単一graph内一意性のみ）:
   決定文案: 「merged graphのnode identityは文字列連結ではなく`{project_id, plan_key, node_id}`のstructured tupleとする。`project_id`と`plan_key`はtracked project manifestで一意に宣言し、bare node IDによるplan間参照を禁止する。同一tupleの重複は内容一致でも拒否する。」
7. **P0 — member集合・dangling依存・merge後cycleの閉包がない**: 各planが個別にDAGでもcross-plan edgeの和集合はcycleになり得る。
   決定文案: 「全plan統合はglob discoveryではなく、self-digest付きproject store manifestがsorted member一覧、active plan version、store head digest、plan topology digestを列挙する。readerは全memberをexactにロードし、欠落・余剰・重複active version・dangling/self edge・join欠落・merge後cycleを検査し、一件でもあれば部分graphを返さない。cross-plan dependencyはstructured node refで明示されたものだけを採る。」
8. **P2 — laneが入力か投影か、capacityとの関係が不明**（plan:52）:
   決定文案: 「v1 laneはpresentation-only projectionとし、各active nodeはplan manifestから導出されるprimary laneをexactに一つ持つ。lane IDと順序はproject namespace内でcanonicalに固定し、laneはedge、critical path、capacityを生成・削除しない。capacityはplan-localのままとし、global capacity schedulingはv1非対象。」

### ④ 並行書込とGit merge
9. **P0 — 同一worktree内のlost updateとtorn store**（既存先例はruntime-errors.mjs:148の単一file transactionに限定）:
   決定文案: 「全mutationはrepo/store scoped lock内で`expected_head_sequence`、`expected_head_digest`、Git HEADを再照合するoptimistic CASとする。不一致は`STORE_WRITE_CONFLICT`で無変更終了し、自動retryしない。eventはexclusive create、fsync後にheadをatomic更新し、snapshotは最後に再生成する。readerは中間状態をjournalから検出し、stale snapshotを使用しない。」
10. **P0 — 複数端末のGit分岐はlocal lockで解決できない**:
    決定文案: 「v1で受理するstore historyはsingle-parent fast-forwardのみとする。同一storeを両親が変更したmerge commit、複数head、sequenceのrenumber、digestの手動resealをCIとreaderが拒否する。競合branchの意図はaccepted headへ更新後、専用`store reconcile/replay` CLIで再発行し、元commitと元event digestをprovenanceとして残す。fork解消前はrender、status、追加writeを全て停止する。」

### ⑤ timestampの信頼性
11. **P1 — wall clockは自己申告で、現行validatorは暦日も厳密でない**: 実査で`2026-02-30T00:00:00Z`をvalid eventとして受理（regex＋`Date.parse`のみ、runtime-contracts.mjs:79。Nodeが3月2日へnormalize）。
    決定文案: 「status、依存充足、遷移順序はjournal sequenceだけで判定し、started_at/done_atを根拠にしない。時刻は`YYYY-MM-DDTHH:mm:ss.sssZ`のstrict round-trip parserで検証するlocal-untrusted表示情報と明記する。clock reversal／過大future skewはtyped anomalyとして通常表示を拒否する。Git author dateをtrusted timeとみなさず、信頼時刻が必要なら署名済みserver/TSA receiptを別versionで導入する。」
12. **P0 — bare evidence refでは削除・rename・内容差替えを検出できない**（plan_input.v1のrefはpath shape検証のみ: artifact-contracts.mjs:330。boundary manifestは存在閉包まで検査: 454）:
    決定文案: 「completion evidenceはbare path/stringを禁止し、`{evidence_id, repo_id, path, content_digest, media_type, anchor_digest|null}`のtyped descriptorとする。validatorは指定repo、tracked regular fileまたはpinned Git object、content digest、anchorの一意性を検証する。欠落・rename・digest mismatch・unavailable commitではdone transitionを成立させずstore全体を拒否する。説明用Markdown linkとdone evidenceを別fieldにする。」

### ⑦ digestの信頼境界とfail-closed入力
13. **P1 — SHA-256は真正性を証明しない**: journal・snapshot・全digestを同時に書き換えてresealすれば内部整合は成立する。
    決定文案: 「store digestはcanonical contentのidentity／corruption検出であり、actor、CLI経由、timestamp、承認の真正性を証明しない。accepted truthはcanonical protected branch上でCI store verifierを通過したcommitと定義し、force-push／署名要件はrepository policyとして明示する。未commit・未検証checkoutは`unattested`として表示し、accepted statusと混同しない。」
14. **P1 — value-level validation以前の異常が未列挙**: duplicate JSON key、invalid UTF-8、BOM/CRLF、truncated write、merge marker、symlink escape、mixed schema version、empty genesis、case/NFC path alias、segment総量上限が計画のfixture一覧にない。
    決定文案: 「store readerはraw bytesをfatal UTF-8でdecodeし、BOM・CR・duplicate key・trailing bytes・canonical再serialize不一致を拒否する。store/evidence pathは各componentをlstat/realpathしrepo外・symlink・非regular file・unmerged indexを拒否する。schema version混在、genesis欠落、ID/path alias、safe-integer外sequence、event/segment/member/total byte上限超過では、部分読取・旧snapshot fallback・未知field無視を行わない。」

補記: `gantt_result.source_digest`はsorted member manifest、各store head、active topology、evidence／埋込Markdown content digest、projection／renderer versionを含むversioned preimageへ束縛すべき。単数「source digest」では同じdigest名で異なる統合対象や散文を描画できる。

---

## レーン5 — レンダラ/UX実現性監査（terra×high）

| 攻撃観点 | Severity | 監査所見 | 対策案 |
|---|---|---|---|
| 1. 数百ノードのwave SVG | **P0** | 現行`plan_graph.v1`は配列を既定256件までに制限（artifact-contracts.mjs:5, 612）。全plan mergeで300件以上を扱う契約は未定義。仮に通しても縦一列は数千px、全体表示ではラベルが読めない。 | G1で「merged display graph」の最大件数・最大edge数・最大埋込bytes・超過時のfail closed／集約方式を契約化。通常表示はplan/laneを折畳み、criticalとactive waveを常時可視、詳細は選択・ズーム時のみ展開。300/1,000、500/2,000、密DAGの性能・可読性fixtureをG3 gateに追加。 |
| 2. edge交差爆発 | **P1** | スケッチは矢印pathを描くのみで、ノード順序最適化・port割当・routing channel・edge削減規則がない（plan:25）。多対多依存では交差と重なりで依存が読めなくなる。 | layer内順序をlane優先＋barycentric/median sweepで安定化し、直交ルーティングとport/channel割当。既定はcritical hard_need＋選択nodeの入出辺だけ表示し、他は件数badge・bundle・filterで段階開示。交差数、edge/node比、overflow時の縮退表示を機械検証。 |
| 3. Markdown→HTMLのXSS・サイズ | **P0** | raw HTML、`javascript:` URL、SVG event属性、`</script>`によるJSON script脱出を生成物へ持ち込める（plan:52）。`http(s)://`不在検査だけでは`//host`、`data:`、CSS `url()`、`<base>`、script内network APIを防げない（plan:109）。 | MarkdownをHTML文字列として通さない。許可制Markdown AST→HTML rendererでraw HTML・画像・任意URLを無効化、テキスト／属性／SVG／script JSONを別々にescape。JSONは`<`等をUnicode escapeし、表示更新は`innerHTML`でなく`textContent`/DOM生成。節本文はcontent digest付きで重複排除し、1節・全体のbyte上限と超過時エラー。 |
| 4. 左右ペインと最小script | **P1** | 実用品質には選択状態、フィルタで消えた選択、SVG event delegation、touchでhover不能、keyboard操作、ARIA、focus移動、edge同期表示が必要。バー内にstarted/done両時刻を置くと短い論理バーで衝突（plan:52）。 | 「最小」を行数でなく責務最小と定義。静的data JSON＋単一イベント委譲controller、`Map<nodeId, elements>`、`data-*`、`classList`のみで実装し、inline handlerと動的HTML禁止。SVG nodeへ`tabindex`/`role=button`/選択ARIA。hoverは補助、click/keyboardを正規操作。時刻はバーに短縮記号、完全値は右ペイン／tooltip。 |
| 5. 無durationのcritical path／現在地 | **P0** | durationなしの`hard_need`最長chainは一般にクリティカルパスではなく「hard dependency spine」。現行validatorは`hard_need`以外のtyped edgeもwave順序制約にする（artifact-contracts.mjs:65, 647）。capacity・conflict・joinによる遅延を無視したchainは実際の完了最遅鎖と異なり得る。並行実行下の「現在地」も単一点でなくactive node集合。G4の受入文言は厳格（plan:116）。 | ADRで二択を明示。(A) unit-durationかつ全schedule制約を含むlongest pathを定義して「logical critical chain」と改称、(B) `hard_need`限定を維持して「hard-dependency spine」と改称し、criticalという受入語を撤回。どちらでもactive set、次に着手可能なnodes、blocked reasonを別視覚要素にし、分岐・join・capacity競合・複数最長鎖のfixtureで検証。 |
| 6. 単一HTML・file://・CSP・日本語 | **P1** | file://はHTTP CSP headerを出せず、meta CSPと完全inline資産の整合が必要。相対リンク、Markdown内リンク、CSS URL、外部fontは自己完結／networkゼロを破り得る。日本語はOS依存フォントで見栄えが変わり、font埋込はHTMLを大きくする（plan:67）。 | `<head>`先頭にmeta CSP（`default-src 'none'`、hash指定static script/style、`img-src data:`等を必要最小限）。`<base>`、外部/相対resource、CSS `url()`、navigation URLを出力検証で拒否。リンクは埋込節へのfragmentだけ許可。日本語はローカルfont stackを標準とし、必要時のみライセンス確認済みsubset fontを埋込みbyte budgetへ計上。Chrome/Safari/Firefoxのfile:// screenshot・操作smokeを必須化。 |

補記: 計画自身が「duration推定・カレンダー時間軸は非目標」（plan:128）としているため、G4の「critical path」は名称か数理定義のどちらかをG1で必ず揃える必要がある。
