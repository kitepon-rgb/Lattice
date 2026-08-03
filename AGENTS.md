# AGENTS.md

Latticeで働く全AIエージェント共通のプロジェクト規約。上位のグローバル規約に加え、本書を優先する。

## 製品の役割

Latticeは、要求とcodebaseから並列開発可能なTODO graphを作るschedulability compilerである。
Lattice所有の内蔵sensorを構造sensorとして使い、TODO候補の境界競合を検出し、必要ならcode architectureへ
seam-refactorを施し、再解析後に全planを新versionへコンパイルする。

**製品目標の正本はオーナーの特許請求の範囲である。** 機能の優先順位は、どの構成要件を埋めるかで決める。
請求項本文は本repoへ複製せず、`/Users/kite/Developer/Patent/Lattice/出願書類/03_特許請求の範囲案.md`
（12項・凍結済み）を正本として参照する。複製しないのは正本を二重化しないためであり、
出願の前後を問わない。

**出願済み（2026-07-27・特願2026-178950「情報処理装置、ソフトウェア開発制御方法及びプログラム」・
請求項12項）。** 出願日が確保されたので、公開面へ請求項の内容を出さないという
制限は解けた。repoの公開、READMEでの特許の明示、記事や発表での言及はいずれも可能である。
公開する時は出願番号と出願日を添え、請求項本文の複製ではなく参照とする。

充足状況と残りの穴は[docs/plan_backlog.md](docs/plan_backlog.md)の「請求項の充足状況」が持つ。

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
- **計画段階で完全な分断は原理的に得られない。** 動的dispatch、実行時に決まるpath、reflection、
  外部状態は、宣言と構造観測をどこまで詰めても残る。埋め合わせは実行段階の境界検知が持つ——
  実際に変更された資源を観測し、宣言scopeの外への変更と、他の実行中作業のscopeとの重なりを
  実行時競合として捕まえる。二段構えが設計であって、静的側の不備ではない。
- **計画時は今ある材料の工夫で判断し、解決不能問題へ突入しない。** 判定の厳密さを上げる方向で
  次を追わない: 意味的同等性の証明、依存閉包の完全性の証明、動的dispatchの完全解決、
  unknownを無くすこと。どれも計画段階では決定不能であり、追えば製品が止まる。
  代わりに、持っている材料——宣言、構造観測、実行した検査、変換前後の再compile——を組み合わせて
  「今の材料で言えること」を述べ、言えない分はunknownとして残し、実行段階へ渡す。
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
- **装置の境界にAIを含める。** Latticeを操作するのはAIであり、そのAIは装置の外に居るのではなく
  装置の一部である。したがってLatticeが供給するのは、AIが自分で作れないもの——構造観測、契約、
  検証、記録、版の境界——に限る。推定、判断、文章生成をLatticeの中へ実装しない。それは操作している
  AIが既に行っている。
- **AIが既にできることを、製品コードやサブエージェント呼び出しとして足さない。** 「装置がやる」形へ
  寄せようとして製品内からAIを呼ぶ設計は、AIが操作している場に同じ能力を二重化するだけである。
  設計が「ここでAIに出力させたい」へ向かったら、そこは既に満たされている面であり、要るのは
  能力ではなくAIの出力を受け止める契約と検証である。
- sensorはLatticeが所有し、配布物内の`./sensor/dist`からのみ起動する。PATH上の独立CLI、
  npx配布物、外部SDKへfallbackしない。MIT attributionは`./sensor/LICENSE`と
  `./sensor/NOTICE`で維持する。
- **抽出器は二重実装であり、native kernelはwasm側へ追従する（ADR 0154）。** 配布に載るのはwasm経路で、
  Rustのnative kernelは同じ結果を速く出すためだけに在る。node／edge／refのフィールド、新しいnode種別、
  新しい辺をTypeScript側へ足したら、同じ作業のうちにRust側へも足す。`kernel-tsjs-parity`が赤いまま
  他の作業を続けない——赤は「開発機の索引結果が配布物と違う」という意味である。揃える方向は常に
  native→wasmとし、TS側を削って一致させない。ABIを変える時は両側と`KERNEL_ABI_VERSION`を同時に動かす。
- **upstreamから貰えるものが増えたら取り込む（オーナー裁定 2026-08-03）。** 正本は
  `sensor/UPSTREAM.json`、追従は`npm run upstream:sync`（3-way merge・衝突後は解決→commit→
  `--mark-synced`）、検知は週次の`.github/workflows/upstream-check.yml`と`npm run upstream:check`が
  行い、新しいkernel言語・wasm extractorは名指しで報告される。kernelの新言語は「取り込み＋
  Lattice独自機能（extent・動的import等）の追従＋parity green」までが1単位の作業である。
  markerを進めずに同じrefへ`--apply`を再実行しない——解決済みtreeへ衝突マーカーが再注入される。
- **licenseは二層である。** 製品本体は`PolyForm-Noncommercial-1.0.0`（非商用は無償、商用は
  別途許諾）で、`sensor/`はupstream由来のMITのまま。**`sensor/`のlicenseを書き換えない**——
  第三者コードは再ライセンスできず、帰属表示の保持義務がある。製品をOSI承認licenseへ
  変える提案をしない。特許を留保して商用を有償にする方針であり、OSIの定義は利用分野の
  制限を許さないので両立しない（特にApache-2.0は第3条で特許を明示許諾するため意図と逆行する）。
- dotagentsは将来の導入、更新、host配線、BugHub、互換性、rollbackを所有する。Latticeの研究思想を
  dotagentsの工場規則へ直接書き戻さない。
