# ADR 0168 — ToDo構造検査は明示opt-inのgraph overlayであり、完了義務を機械が持つ

- Status: Accepted
- Date: 2026-08-11
- Owners: Lattice
- Extends: ADR 0047、ADR 0127、ADR 0147、ADR 0156、ADR 0160
- Reaffirms: ADR 0049、ADR 0062、ADR 0063、ADR 0148、ADR 0158、ADR 0159
- 計画正本: [plan_todo-logical-structure-graph.md](../plan_todo-logical-structure-graph.md)
- 詳細構想: [design_todo-logical-structure-graph.md](../design_todo-logical-structure-graph.md)
- Characterization: [2026-08-11-todo-structure-reuse-baseline.md](../evidence/2026-08-11-todo-structure-reuse-baseline.md)

## Context

LatticeのToDo DAGは「何を先に終えるか」を表すが、各ToDoが**何を入力として読み、どう整理し、何を
誰へ渡すか**は表していない。plan全体を読んだ作成者には分かっていても、個別ToDoだけを受け取る実装者には
次が分からない。

- 先行ToDoのどの出力を受け取るのか
- 既存sourceのどのfile／symbol／schemaへ接続するのか
- producerとconsumerのdata shape、identity、lifecycleが一致するか
- ToDo DAGに、dataflow上必要な依存が本当に存在するか
- planned構造が実装後のsourceとcommitにどう着地したか

Latticeは既に、内蔵sensorのsource graph、二tree構造diff、ToDo DAG、merged cycle、Git object読取、
independenceのartifact鮮度とunknown表現を持つ。ここで別のparser、index、source graph、cycle detector、
Git runnerを作ると、同じrepoについて異なる二つの真実が生まれる。必要なのは新しいgraph engineではなく、
ToDoの論理dataflowを既存graphへ接続するoverlayである。

一方、この検査は出版や運用手順等の全planへ必要な一般工程管理ではない。適用を暗黙化すると、構造検査が
不要なplanまで入力作成と完了gateを背負う。逆に「後でrealizedを書いてください」という案内だけでは、
task done後に義務の所有者が消え、計画と実装の差分は残らない。適用範囲は人／AIがplan定義後に明示し、
適用した範囲の義務だけを機械が完了点で保持する必要がある。

## Decision

### 1. 構造検査はplan定義後の明示opt-inとする

初版profileは`code-dataflow`だけとする。plan create／migrateは構造入力を暗黙生成せず、既存sourceやToDo本文を
AI推論して自動有効化しない。planがcanonical storeへ登録された後、対象planについて明示的にplanned inputを
作り、planned compileが成功した時だけ有効化する。

有効化の正本は、成功したcompileがplan version専用領域へ書くimmutableな
`lattice.todo_structure_binding.v1`とする。bindingは少なくともproject、plan key／version、topology digest、
profile、baseline SHA、structure set digestへ束縛する。

- 入力fileが在るだけのdraftは有効化ではない。
- derived compile artifactが在るだけでも有効化ではない。
- binding発行後は、入力やartifactの欠落・破損・鮮度切れを「未適用」へ戻さない。typedなmissing／staleとして
  表出し、正規の再compileを案内する。
- 初版にdisable／binding削除入口は作らない。plan revisionはsuccessor plan versionへ新しいbindingを発行する。
- bindingを持たないplanは未適用であり、従来のread／start／done／Phase操作を一切変えない。

bindingはlifecycle journal、task note、plan note、independence artifactへ混ぜない。意味と破損境界が違うためである。
旧readerが列挙しない専用領域へ置き、新event kindを既存chainへ混ぜて旧CLIのstore読取りを壊さない。

### 2. planned、realized、effectiveを別の事実として保持する

`planned`はopt-in時に宣言した構造、`realized`はtask実装後に提出した構造、`effective`は現行plan versionで
採用されている最新realization（無ければplanned）である。

- plannedをrealizedで上書きしない。
- realizedはtask-scoped append-only chainへ積み、訂正は`supersedes`で行う。
- 通常読取はeffectiveとplanned→realized差分を返す。
- 診断読取はplanned、全realization、最終projectionへ到達できる。
- plan revisionはtask migrationでidentityを写せても意味の同一性を主張しない。successor versionで再compileする。

これは人間の監査記録ではなく、計画上のdataflowが実装でどう変化したかを次の設計へ返す製品データである。

### 3. 判定はconsistent／inconsistent／unknownの三値とする

verdictは次の三値だけである。

- `consistent`: 必須接続が全て解決し、機械契約上の反証も証拠不足も無い
- `inconsistent`: 入力欠落、contract不一致、依存欠落、cycle、実現drift等の具体的反証がある
- `unknown`: sensor未準備、曖昧anchor、外部契約、commit帰属不明等により結論を出せない

unknownをconsistentへ丸めず、inconsistentとunknownを同じ失敗へ潰さない。点数、confidence、自由文の類似、
fuzzy symbol resolutionで三値を上書きしない。findingは安定code、関係task／data／code／commit、観測値、
期待値、次の正規操作を返す。

### 4. 四層を既存graphへ重ね、同じ機能を再実装しない

planned compileは次の四層を一つのbounded graph projectionへ結ぶ。

1. current HEADの既存source graph
2. baseline SHAからcurrent HEADまでのcommit changeset／provenance
3. in-progress ToDoのplanned transformと関連づいたcommit
4. pending／blocked ToDoのplanned transform

final compileは3・4を全applicable taskのrealized transformへ置き換え、最終HEADのsource graphと再結合する。
current sourceとcommitを二つの実装nodeとして二重計上せず、commitは来歴nodeとして扱う。

正本の所有境界は次である。

- file／symbol／call／import／reference／impact: 内蔵sensorと`collectSensorEvidence`／`portableSensorOutcome`
- source node／edge差分: `compareSensorIndexes`
- resource、precedence、unknownの正規化: independence compiler chain
- ToDo状態とready集合: `readTodoStore`、`computeReadyFrontier`、`projectTodoStatus`
- ToDo DAG、cycle、依存鎖: `projectTodoChainV1`、`analyzeDagChains`、merged graph validator
- Git process／object batch: `git-process.mjs`
- canonical bytes、digest、hash chain: `todo-contracts.mjs`と`hash-chain.mjs`
- artifact鮮度: independence artifactのidentity／freshness pattern

新設してよいのはstructure固有contract、anchor adapter、overlay projection、finding rule、realization chain、
completion gateだけである。既存primitiveで表現できない場合は、別実装を始めず不足する既存入出力を特定して
本Decisionを改訂する。「使い方が分からない」は再実装の理由にならない。

### 5. structure graphは工程依存・並列性解析と分離する

dataflow edgeは「どのdataがどこへ渡るか」、ToDo hard dependency／joinは「何を先に終えるか」、
independence edgeは「同時実行時に資源が衝突するか」を表す。三つを同じedge typeへ潰さない。

structure findingはToDo DAGの依存欠落を名指しできるが、自動でhard dependencyを書き換えない。
structure verdictや入力の有無は`next_ready`、`active_set`、`dispatch_frontier`、`frontier_digest`、
independence verdictを変えない。並列候補の判定と構造整合性は別command／別artifact／別dashboard面に置く。

### 6. authoritative compileだけがlive source、Git、sensorを読む

planned compileとfinal compileは、cleanなauthoritative observation scope、current HEAD、baseline ancestor、
plan identity、fresh sensorを実測するauthoritative operationである。管理worktreeがdirtyな場合も、current
HEADを一時detached worktreeへ自動展開し、Git来歴とsource graphはそのclean snapshotだけから収集する。
Lattice store、planned source、realization、artifactは管理worktreeで読書きし、一時worktreeへ持ち込まない。
一時worktreeでは同梱sensorを初期化し、成功・失敗のどちらでも観測後に破棄する。これにより未コミット実装を
commit済み構造として保存せず、同時に無関係なdirty entryだけを理由として構造検査を拒否しない。baseline非祖先、
Git object欠落、sensor stale、anchor曖昧を別のtyped finding／errorとして返す。

planned compileでは`expected_at: after_task`を将来検証するpostconditionとして受理し、current source上の
不在をunknownへしない。final compileではtask完了後のsourceに対し、`create`／`modify`／`read`は存在、
`delete`は不在を要求する。`expected_at: baseline`はcurrent HEADのsnapshotだけで証明せずunknownを維持する。
またin-progress taskにrealization未作成を要求しない。realizationはbinding有効化後にtask成果commitを束縛する
記録であり、初回compileへ先取り要求するとactivationとの循環になる。done時のrealization欠損と、存在する
realizationのcommit到達不能／anchor非交差だけをfindingにする。

通常の`todo structure`読取とdashboardは保存済みartifactを読む。参照時にsensorを再実行せず、現在の
plan identity／HEADとartifact identityを比較して`fresh`／`stale`／`superseded`／`missing`を投影する。
read操作がsource index、store、artifactを書き換えることはない。

Git追跡するplanned source、再生成可能なcompile artifact、append-only realization、immutable activation bindingを
別の所有物として保存する。compile artifactへ全source graphを複製せず、構造入力から到達したbounded node／edge、
解決結果、provenance、finding、入力digestだけを持たせる。

### 7. applicable taskのdoneはfresh realizationを必須にする

**[ADR 0181](0181-authoring-entry-accepts-drafts.md) が置き換える。** realizationはoverlay観測のまま残し、
`todo done`の前提からは外す。planを閉じるfinalization（Decision 8）は残す。

有効化済みplanで`applicability: graph`のtaskだけ、`todo done`のjournal append前に次を要求する。

- task／plan version／planned digestへ束縛した現行realizationがある
- realizationが束縛したHEADとdone時のHEADが一致する
- realizationのcommit OIDがbaseline..HEADに含まれ、taskのcode anchorと交差する
- realization recordとchainがcanonicalで、supersededされていない

不足・stale・破損時はjournal bytesを変えず、`todo structure realize`の正規commandと原因を返す。
`applicability: excluded`のtaskとbindingを持たないplanは、既存done契約をbyte／意味とも変えない。

realizationは「実装がplannedと同じだった」という自己申告だけではなく、実際のHEAD、commit、anchor、
input／operation／outputへ束縛する。ただしソース差分から自由文の業務意味を推測しない。機械で確定できない
対応はunknownとして表す。

### 8. planを閉じる操作はfreshかつconsistentなfinalizationを必須にする

全task done後、`todo structure finalize`は全applicable taskの現行realization、最終HEAD、current source graph、
commit来歴を再結合する。成功条件はclean worktree、全realization完備、fresh sensor、verdict `consistent`である。
finalization artifactは少なくともplan version、topology、structure set、HEAD、sensor projection、
realization head集合のdigestへ束縛する。

有効化済みplanについて、あるPhase遷移が完了した後に監査待ちのPhaseを一つも残さずplanを閉じる場合、
`phase_accept`と`phase_close_unaudited`のどちらもfreshかつconsistentなfinalizationをjournal append前に要求する。
これにより`closed_unaudited`を構造義務の迂回路にしない。finalization後にHEAD、topology、planned source、
realization chain、sensor projectionが変わればstaleへ戻り、再finalizeまで閉じられない。

このgateはPhase監査の中身をLatticeが採点することではない。構造の機械契約が完結したかを、既存の
plan終端遷移へ追加する前提である。途中Phaseのaccept、task dispatch、start readinessは変えない。

### 9. 未適用planの互換性をcharacterizationで保護する

bindingを持たないplanでは、create／migrate／status／show／start／done／Phase accept／Phase closeの現行結果、
store bytes、状態遷移を維持する。新fieldを既存exact wireへin-place追加せず、structure専用のversioned read面を
加える。structure binding／artifact／realizationを読めない時に「未設定」へfallbackしない。

## Consequences

- 個別ToDoだけを読む実装者も、入力、変換、出力、接続先を機械可読に取得できる。
- 既存source graphとToDo graphを再利用するため、Lattice内に第二のparser／index／cycle判定を持たない。
- 計画と実装の差分はplanned→realizedとして残り、task done後に消えない。
- 構造検査を選んだplanだけrealization／finalizationの費用を負担し、非code planは従来どおり動く。
- compileはGitとsensorを読むため重いが、通常status／dashboardは保存artifactだけを読み、閲覧のたびに再計算しない。
- enabled planはbindingを消す操作を持たず、入力やartifactの事故消失で義務が静かに解除されない。
- structure整合性は並列性の証明ではない。consistentでも資源競合はあり得て、inconsistentでもready frontierは変わらない。

## 棄却した代替

### ToDo本文の自由文だけをAIに読ませる

plan全体を持たない実装者へ接続関係が届かず、同じ入力から決定的な検査を再実行できないため棄却する。

### source graph engineをstructure用に新設する

parser、node identity、edge semantics、鮮度が既存sensorと分岐し、同じrepoに二つの真実を作るため棄却する。

### independence graphへdataflowを足す

dataのproducer／consumerと同時実行競合は意味が違い、dispatch契約をstructure判定で動かすため棄却する。

### realization／finalizationをadvisoryにする

done後に義務の所有者が消え、今回直す「ToDoだけでは作るものが分からない」を再び人の注意力へ戻すため棄却する。

### planned sourceの存在だけをopt-in判定にする

draftを置いただけでgateが有効になり、反対にfile削除だけで義務を解除できるため棄却する。成功compileが
immutable bindingを作る二段階にする。

### plan schemaへstructure fieldを追加する

適用不要な全planと既存readerを巻き込み、plan定義後に選ぶという要求にも反するため初版では棄却する。

## Protected behavior

- 内蔵sensor、Git runner、ToDo DAG、merged cycle、independence artifactの既存正本を置換しない。
- `next_ready`、`active_set`、`dispatch_frontier`、`frontier_digest`をstructure状態で変えない。
- Phase監査順とToDo schedulingを混ぜない。
- bindingを持たないplanのcreate／migrate／read／lifecycle／Phase操作を変えない。
- source／artifact／chain破損をmissingや未適用へ丸めない。
- failed compile／realize／finalize／done／plan終端遷移はstoreと入力fileのbytesを変えない。

## 非目標

- 自由文の設計品質、業務意味、命名の良し悪しを採点すること
- 構造検査からhard dependency、ToDo、source patchを自動生成すること
- 並列可否、worker数、dispatch順を決めること
- 全source graphをartifactまたはdashboard payloadへ複製すること
- 外部contractの実在性をLatticeだけで証明すること
- 構造入力を持たないplanへ後方移行を強制すること

## 実装拘束

1. contract、binding、realization、artifact、findingをそれぞれexactなversioned schemaにする。
2. binding発行はplanned compile成功と同じtransactionで行い、bindingだけ／artifactだけが残る半端な成功を作らない。
3. task doneとplan終端のgateはjournal appendより前に検証し、失敗時bytes不変をtestで固定する。
4. compile入力と保存artifactはPeertable固定fixture、実Git repo、実sensorの三段で検証する。
5. dashboardは既存Ganttへedgeを混ぜず、別のstructure projectionを描画する。
