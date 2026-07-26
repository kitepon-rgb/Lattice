# AGENTS.md

Latticeで働く全AIエージェント共通のプロジェクト規約。上位のグローバル規約に加え、本書を優先する。

## 製品の役割

Latticeは、要求とcodebaseから並列開発可能なTODO graphを作るschedulability compilerである。
Lattice所有の内蔵sensorを構造sensorとして使い、TODO候補の境界競合を検出し、必要ならcode architectureへ
seam-refactorを施し、再解析後に全planを新versionへコンパイルする。

- 製品思想の正本: [PLAN.md](PLAN.md)
- 公開契約: [docs/00_product-contract.md](docs/00_product-contract.md)
- 生きた工程状態: dotagents Lattice storeの`lattice-factory-integration` plan（思想・編入契約はdotagents `docs/plan_lattice-factory-integration.md`、RC4完了記録は[docs/archive/plan_lattice_rc4_dotagents_dogfood.md](docs/archive/plan_lattice_rc4_dotagents_dogfood.md)）
- 不変Decision: `docs/adr/`
- 調査証拠: `rag/`。RAGはDecisionやTODOの正本ではない。

## 先端研究の姿勢

- 前例不足、未実証、一般的な保守論、既知ingredientの存在、監査役の`worth_it`判断をblockerにしない。
- blockerを主張する側は、破られる要求／不変条件、因果経路、再現証拠、隔離やrollbackでも回避不能な理由、
  未充足条件を示す。立証できない懸念は実験仮説または観測項目へ落とし、開発を続ける。
- 監査findingとして採るのは、実コードで再現する欠陥、明白な論理破綻、一次資料の誤読、実験による反証、
  具体的な安全事故経路である。監査役に製品scopeを縮小する権限を与えない。
- Latticeをread-only推薦器で完了扱いしない。隔離worktree内の実変換、再index、再compileまで製品scopeである。

## TODO境界compile

- source変更TODOをdispatchableにする前に、Lattice sensorでowned symbol／path、caller／callee、impact、affected
  testを確認し、state／effect／dynamic unknownを補ったboundary manifestを作る。
- 調べた境界は会話で消費せず記録する。`.lattice/todo/witness/<plan_key>.json`へwitness setを宣言して
  `lattice todo independence compile --plan <key> --input <ref>`を通し、`lattice todo independence --plan <key>`で
  読む（ADR 0127）。読み出しはsensorを引かないので、参照のたびに調べ直さない。
  依存線が無いことを並列可の根拠にしない。未宣言taskと、宣言境界に触れるdiffで失効した記録は未検査として扱う。
- 着手時は`todo start`が返す`advisory`を読む（ADR 0128）。`conflicts_with_active`は進行中ToDoとの競合、
  `severability`は`code_seam`（分割で並列化しうる）か`serial`（共有状態ゆえ直列必須）かを示す。
  助言であって拒否ではないので、無視して進めるなら理由を残す。`coverage`が`missing`の時は
  「競合なし」ではなく「まだ判定していない」であり、宣言を書いてcompileするのが正しい応答である。
- plan revisionでtask_idが変わったら`lattice todo independence witness migrate --plan <key>`で宣言を写し、
  commitしてから再compileする。移行はid写像だけを行い、宣言内容が改訂後も妥当かは主張しない。
- 初回scaffoldだけはindexがまだ存在しないためbootstrap例外とする。bootstrap sourceを作った直後、
  初期環境commitより前に`lattice sensor init . --json`を実行し、以後のsource TODOへ例外を持ち越さない。
- sensor結果は構造証拠であり、semantic independenceやbehavior preservationの単独証明ではない。
- `lattice_sensor_status`のcomplete／pending changes 0だけで新規fileのindex収載を仮定しない。`lattice_sensor_files`でcoverageを照合し、
  欠落時は明示`lattice sensor sync . --json`後にsearch／caller／callee／impactを取り直す。
- sensorのsymbol lookupは、存在しない要求名を近い別symbolへfuzzy解決する場合がある。返却されたsymbol名とpathのexact一致を
  照合し、不一致をplanned symbolのcaller／callee／impact証拠へ使わない。不一致や空結果はunknown／absentとして記録する。
- conflictに切断可能なseamがあれば、直列化だけで済ませず、純並列便益を目的とするrefactorを候補化する。
- 係争資源しか宣言していないToDoは固有anchorを持たず束縛できない。その時はwitnessの`concern_anchors`へ
  「その資源の中で自分が触るsymbol」を実態のまま宣言する（ADR 0133）。宣言は並列可否の判定へ写らないので
  conflictを作ることも消すこともできず、効くのは切断候補の束縛だけである。機械が解決できないからと
  いって実際に触るsymbolを宣言から落とさない。落とせば宣言が実態からずれ、判定の前提が壊れる。
- active plan versionのtopologyを追記で変えない。code変換後は旧plan／旧agent context／途中patchを失効し、
  accepted artifactをpredecessorにした新versionへ全affected TODOを再コンパイルする。

## 実装と検証

- Node.js ESM、Node 22.13以上。runtime dependencyは必要性を説明して追加する。
- 外部挙動不変のrefactorと挙動修正を分ける。安全網を先に置き、失敗をfallbackで隠さない。
- `npm test`を局所／標準test、`npm run check`をsyntax／静的検査、`npm run ci`を完全gateの正規入口にする。
- 実Lattice sensor、実repo、隔離worktreeを使うintegration testはunit testと分け、未実行をgreenへ丸めない。
- 実daemon・実processを起動するtestは、後片付けをtestごとに手書きせず共通のfixture helperへ焼き込む。
  停止対象はdescriptorのpidでなくargvがfixtureのtemp pathを指すprocessとし、SIGTERMからSIGKILLへ上げて
  死を確認してからfixtureを消し、最後に生き残りゼロをassertする。取り残しは機械を重くして、時間予算を
  見るtestを偽陽性で落とす。既に常駐している分は`node scripts/reap-orphan-test-daemons.mjs`で一覧し、
  `--reap`で停める（既定は一覧のみ、fixture不在のものだけが対象）。
- commitは独立revert可能な単位にし、並行作業中はpathspecを明示する。push、publish、remote作成は
  オーナーの明示指示時だけ行う。
- 新しい工程群をLattice storeへ入れる時は`todo migrate`で新planを起こす。初期化済みprojectでは
  `can_create_plan`がfalseになり`plan create`は使えず、既存planへのtask追加はphase revision v3の
  full desired-state全置換（runtime task migration・source inventory・cutover batchの全整合）を要求するため、
  別campaignの追加には見合わない。散文はdocs/のplan Markdownが持ち、状態と依存はstoreだけが持つ。

## 所有境界

- Latticeはgoal decomposition、boundary manifest、conflict model、seam transformation、plan compile、
  version barrier、実験記録を所有する。
- sensorはLatticeが所有し、配布物内の`./sensor/dist`からのみ起動する。PATH上の独立CLI、
  npx配布物、外部SDKへfallbackしない。MIT attributionは`./sensor/LICENSE`と
  `./sensor/NOTICE`で維持する。
- dotagentsは将来の導入、更新、host配線、BugHub、互換性、rollbackを所有する。Latticeの研究思想を
  dotagentsの工場規則へ直接書き戻さない。
