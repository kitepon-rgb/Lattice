# AGENTS.md

Latticeで働く全AIエージェント共通のプロジェクト規約。上位のグローバル規約に加え、本書を優先する。

## 製品の役割

Latticeは、要求とcodebaseから並列開発可能なTODO graphを作るschedulability compilerである。
Codegraphを構造sensorとして使い、TODO候補の境界競合を検出し、必要ならcode architectureへ
seam-refactorを施し、再解析後に全planを新versionへコンパイルする。

- 製品思想の正本: [PLAN.md](PLAN.md)
- 公開契約: [docs/00_product-contract.md](docs/00_product-contract.md)
- 生きた実装TODO: [docs/plan_lattice.md](docs/plan_lattice.md)
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

- source変更TODOをdispatchableにする前に、Codegraphでowned symbol／path、caller／callee、impact、affected
  testを確認し、state／effect／dynamic unknownを補ったboundary manifestを作る。
- 初回scaffoldだけはindexがまだ存在しないためbootstrap例外とする。bootstrap sourceを作った直後、
  初期環境commitより前に`codegraph init`し、以後のsource TODOへ例外を持ち越さない。
- Codegraph結果は構造証拠であり、semantic independenceやbehavior preservationの単独証明ではない。
- `codegraph status`のcomplete／pending changes 0だけで新規fileのindex収載を仮定しない。`codegraph files`でcoverageを照合し、
  欠落時は明示`codegraph sync`後にquery／caller／callee／impact／affectedを取り直す。
- conflictに切断可能なseamがあれば、直列化だけで済ませず、純並列便益を目的とするrefactorを候補化する。
- active plan versionのtopologyを追記で変えない。code変換後は旧plan／旧agent context／途中patchを失効し、
  accepted artifactをpredecessorにした新versionへ全affected TODOを再コンパイルする。

## 実装と検証

- Node.js ESM、Node 22.13以上。runtime dependencyは必要性を説明して追加する。
- 外部挙動不変のrefactorと挙動修正を分ける。安全網を先に置き、失敗をfallbackで隠さない。
- `npm test`を局所／標準test、`npm run check`をsyntax／静的検査、`npm run ci`を完全gateの正規入口にする。
- 実Codegraph、実repo、隔離worktreeを使うintegration testはunit testと分け、未実行をgreenへ丸めない。
- commitは独立revert可能な単位にし、並行作業中はpathspecを明示する。push、publish、remote作成は
  オーナーの明示指示時だけ行う。

## 所有境界

- Latticeはgoal decomposition、boundary manifest、conflict model、seam transformation、plan compile、
  version barrier、実験記録を所有する。
- Codegraphは第三者MIT製品として正規CLI／SDKを使う。global packageや`node_modules`をpatchしない。
  公開面不足が再現した場合は、license noticeを維持した正式な所有forkを別repoで作る。
- dotagentsは将来の導入、更新、host配線、BugHub、互換性、rollbackを所有する。Latticeの研究思想を
  dotagentsの工場規則へ直接書き戻さない。
