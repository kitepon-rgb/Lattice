# 計画全体を並列化する「理想のTODO」設計研究

- 作成日: 2026-07-15
- 対象: dotagents / Elastic orchestration / Observer
- 出典: `raw/`の一次論文、政府・企業公式handbook、公開特許、開発元公式事例
- 確度: 結論ごとに記載。数値閾値ではなく、構造とadmission条件を採用する

## 結論

理想の計画は、TODO内部へ人数を詰め込む計画ではない。第一の並列化面は、成果物に対応した
原子的TODO間の依存DAGである。ただし、DAGだけでも足りない。安全な実行計画には次の三つを
分離して持つ必要がある。

1. **precedence DAG**: 成果物、interface、state、acceptanceの真の先行依存。
2. **conflict graph**: 同時に走らせられないwrite、共有state、外部effectの競合。
3. **resource/capability constraints**: provider、role、worktree、H承認、rate/quota等の実行制約。

本研究の製品核は、この三層を固定されたcodebaseへ当てるだけではない。TODO候補の境界に
切断可能なseamがある時、挙動不変レーンのrefactorでcodebase側を変換し、再indexで構造差分を
再観測し、semantic／state／effect証拠も通してから新しいplan versionへコンパイルする。
つまりコード構造もschedulabilityを改善する制御変数である。
Codegraphを構造sensor、仮称Latticeを境界比較・変換裁定・plan compile層として分離する。

主たるwaveは、precedence上readyなTODOから、conflictがなくcapacity内の集合を選ぶ。TODO内部の
fork-joinは、独立検証可能なread-only探索、候補生成、検証、または契約固定済みの隔離writerに限り、
一人のaccountable integratorと明示したjoin gateの下で許可する。

実行中のgraphは`plan_version`単位でimmutableにする。実行結果が変えるのはnode stateだけであり、
依存、分割、join、scopeを変える時は、旧traceを残したまま新しいplan versionを作る。これにより
「静的DAGか動的graphか」という二択を避け、各versionは監査可能、version列は適応可能にする。

最適化対象もready node数の最大化だけではない。同じready幅でも、深いcritical chain、統合待ち、
provider quota、semantic conflictによって完了時間は変わる。ready frontierから、critical chainを
短くし、後続を多くunlockし、conflict／capacity／integrator負荷を満たす集合を選ぶ。

この結論は「すべてを細かく分ければ速い」も「一TODO一Workerを絶対に守れば安全」も採らない。
分割の固定費、semantic conflict、統合失敗、計画churnを実測し、ready frontierを動的にsplit／merge／
cancel／replanする二層モデルを採る。

## 1. 根拠の地図

| 系統 | 生き残った知見 | 適用限界 |
|---|---|---|
| Parnas / modularity | TODO境界は処理手順ではなく、変更され得る設計判断と小さな公開契約に沿わせる | scheduleやresource配置は扱わない |
| NASA WBS | 成果物中心に全scopeを漏れなく階層分解し、辞書で各要素を明示する | WBS自体は依存networkではない |
| POP / least commitment | 真に必要な順序だけをcommitし、独立actionを全順序listへ早期線形化しない | partial order自体はresource配分、LLM出力検証、writer conflictを解かない |
| HTN / SHOP2 | 親の複合成果物と、実行可能なleaf／method／preconditionを分ける | domain methodの事前記述が必要で、自由なLLM分解の正しさを保証しない |
| DSM / coordination | task/artifact依存を行列化し、cycle・cluster・共有依存を発見する | 依存の意味と強さは人が検証する必要がある |
| CPM / RCPSP | precedenceとresource制約を分け、ready activityとresource-feasible scheduleを扱う | dotagentsではAI時間見積を判断材料にしない |
| small batch / small CL | 一つのself-contained change、関連test、buildable state、refactor分離がreviewとrollbackを軽くする | 小ささを行数や時間だけで決められない |
| ownership / socio-technical | task依存に対応したcoordinationと明確なownershipが品質に関係する | 相関研究を単純な因果規則にしない |
| AI multi-agent成功例 | dependency-aware plan、隔離workspace、branch-and-merge、test-based joinは長期taskで有効 | 2026年preprintや内部事例は独立再現が不足 |
| AI multi-agent失敗例 | TODO分割後も仕様欠落、期待不一致、約束逸脱、検証不足で単一agentより悪化し得る | benchmark条件を全repoへ一般化しない |
| Graph Harness | ready set、plan-version immutability、planner/runtime/recovery分離、typed join／effectを一つの設計へ整理 | 単著position paper、未実装・未実験。70-project surveyにも内部不整合があり、確立済み効果ではない |
| LAMaS | 並列構造だけでなくcritical-path目的を明示しないと、深いgraphが残る著者実験 | token主体のlatency proxy、限定benchmark／modelであり、実projectのwall-clock保証ではない |
| Codegraph 1.4.1 | symbol／call／import／reference、impact、affected test、heuristic provenance、unresolved／dynamic frontierをlocal graphで観測 | 複数TODOの境界比較、semantic／effect conflict、seam-refactor、再index後のplan compileは持たない |
| program partitioning / PS-PDG | interference／program dependencyから非干渉partitionやsemantics-preserving parallel planを作る先行技術 | 開発TODOの境界をrefactorして再計画する閉ループではない |
| 公開特許 | atomicity check、dependency mapping、capability routing、feedback再計画等の設計語彙が実在する | 特許は有効性の実証でも法的自由実施判断でもない |

主要一次資料:

- D. L. Parnas, [On the Criteria To Be Used in Decomposing Systems into Modules](https://doi.org/10.1145/361598.361623)
  （書誌保存: [[raw/parnas-modular-decomposition]]）。
- NASA, [Work Breakdown Structure Handbook](https://ntrs.nasa.gov/citations/20110012671)
  （本文: [[raw/nasa-wbs-handbook-full]]）。
- U.S. GAO, [Schedule Assessment Guide](https://www.gao.gov/products/gao-16-89g)
  （403時の取得記録: [[raw/gao-schedule-assessment-guide-source-record]]）。
- Cataldo et al., *Identification of Coordination Requirements*（[[raw/cataldo-coordination-requirements]]）。
- Bird et al., *Don’t Touch My Code!*（[[raw/bird-code-ownership]]）。
- Google Engineering Practices, [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html)
  （[[raw/google-small-cls]]）。
- DORA, [Working in small batches](https://dora.dev/capabilities/working-in-small-batches/)
  （[[raw/dora-working-in-small-batches]]）。
- Hu Wei, *From Agent Loops to Structured Graphs*（[[raw/graph-harness]]）。
- Shi et al., *Learning Latency-Aware Orchestration for Parallel Multi-Agent Systems*
  （[[raw/lamas-latency-aware-orchestration]]）。
- Codegraph upstreamとObserver実測（[[raw/codegraph-boundary-analysis-source-record]]）。
- program partitioning／PS-PDG近接先行技術（[[raw/schedulability-transformation-prior-art-source-record]]）。

## 2. 外層モデル: TODO DAGだけに全部を押し込まない

### 2.1 Precedence DAG

`P = (V, Eₚ)`とする。`V`は計画上のTODO、`Eₚ`は「前のTODOの受入済み成果がなければ、後の
TODOを正しく開始または受け入れられない」というhard precedenceだけを持つ。

hard precedenceの主な型:

- `artifact`: 後続が前段のversioned artifactを読む。
- `interface`: 後続が前段で固定したschema/API/Decisionに従う。
- `state`: migrationやdurable state transitionが前段で完了している必要がある。
- `acceptance`: 後続の合否が前段の受入証拠なしには定義できない。
- `human_gate`: H承認または外部状態が前段条件になる。

単に同じ人が担当する、同じrepoを触る、同じreviewerが必要、同じproviderを使う、という理由は
precedence edgeにしない。それらはresourceまたはconflictであり、DAGへ入れると偽のcritical chainを作る。

### 2.2 Conflict graph

`X = (V, Eₓ)`は原則として無向の排他関係を持つ。TODO AとBのどちらを先にするかは決まっていないが、
同時実行だけは危険な関係である。

- `write_conflict`: 同じworktree、同じfile、生成物、index、migrationを同時変更する。
- `semantic_conflict`: fileは別でも同じschema、状態機械、不変条件、暗黙表現を独立判断する。
- `effect_conflict`: 同じDB、host設定、registry、本番service、外部accountへ副作用を出す。
- `integration_conflict`: 両方が同じintegration cutの前提を書き換える。

三つ以上が同じ資源を競合する場合は、pairwise edgeよりconflict hyperedgeとして考える方が正確である。
ただし最初の運用実装はpairwise conflictでもよい。大切なのはprecedenceと混同しないことだ。

### 2.3 Resource / capability constraints

各TODO `v`は、role、required capability、provider、write isolation、H、quota pool等の要求`R(v)`を持つ。
waveはready nodeをすべて起動するのでなく、実在するcapacityとconflictを満たす集合を選ぶ。

```text
ready(v) = 全hard predecessorがaccepted
           ∧ 必要artifactのversion/digestが一致
           ∧ Hまたは外部条件が満たされている

wave W ⊆ ready nodes
  subject to:
    W内にconflict edgeがない
    各role/provider/worktree capacityを超えない
    joinを回収できるintegrator capacityがある
```

「理論上八つ並列」でも、親が四つしか統合できないなら八つ起動しない。CAIDの実験でも、並列数を
増やした時にdelegationとintegrationが崩れ、少ない構成より性能が落ちる例がある
（[[raw/caid-asynchronous-software-agents]]）。

### 2.4 Plan versionとrecovery

planの構造とruntime stateを分ける。

- `plan_version`: node、hard edge、join mode、output contract、effect class、rollback cutを固定する。
- `runtime state`: pending／ready／running／accepted／failed／cancelled等を遷移させる。
- `replan`: missing dependency、誤った粒度、scope発見等を理由として、新versionとgraph diffを作る。
- `recovery`: 同じversion内で許可されたretry／局所設定修正だけを行い、topologyを黙って書き換えない。

Graph Harnessの「retry→local patch→replanを必ず順に尽くす」は、そのまま採らない。既知の認証不足、
H承認待ち、存在しないinterface、非retryable validation errorにretryを課すと、無駄と副作用を増やす。
error classごとに許可された回復集合とbudgetを持ち、`retryable=false`なら無意味な段を飛ばして
replan／H／blockedへ進む。採用するのは**boundedかつ監査可能なrecovery**であり、万能な固定順ではない。

## 3. TODOを作る三つのpassと境界compile loop

### Pass A — 成果物分解

NASA WBSの型を借り、まず「何を作るか」を漏れなく階層化する。組織、担当者、ファイル構造から始めず、
受け入れるproduct、service、schema、migration、検証証拠、運用能力から始める。

各leaf候補には次を置く。

- 一つの観測可能なoutcome。
- そのoutcomeを判定するacceptance question。
- 入力となる既存Decision／artifact。
- 生成するversioned artifactまたはevidence。
- 非目標。

WBSはscope completenessを作るだけで、実行順はまだ付けない。WBSの親子をそのまま`blocked_by`へ変換しない。

### Pass B — 設計境界と依存抽出

Parnasのinformation hidingに従い、「同じ処理をする箇所」ではなく「同じ変更理由を隠す箇所」をまとめる。
次の証拠を合わせてTODO候補間の関係を抽出する。

- import/call/reference graph。
- schema、migration、state machine、transaction lock。
- test fixture、contract test、integration testの依存。
- git historyのco-changeとmerge conflict履歴。
- ADR、公開API、installer、deploy、rollback。
- runtimeのshared effectとH gate。

file非交差は必要条件になり得るが、十分条件ではない。CooperBenchは別featureを二agentに割っても平均成功率が
低下する条件を示し、Specification Gapは共有仕様を薄くすると統合精度が大きく落ちる限定実験を示した
（[[raw/cooperbench]]、[[raw/specification-gap]]）。

依存候補を抽出したら、strongly connected componentを調べる。cycleがある時の選択は次の順である。

1. 単なる便宜上の順序やresource競合をprecedenceから除く。
2. characterization TODOで現挙動を固定する。
3. interface-first TODOで共有contractを先に固定する。
4. shared decisionを一moduleへ隠す抽出リファクタTODOを置く。
5. それでも同じtransaction/state machineを共同変更するなら、一つの意図的直列TODOとして扱う。

「cycleがあるから適当に一方向へedgeを置く」は禁止する。偽の順序で設計問題を隠すだけだからだ。

### 境界compile loop — codebaseを固定入力にしない

通常のschedulerは、既に与えられたtask graphをどう配置するかだけを扱う。本研究では、TODO候補の
write／semantic conflictがcritical chainを作る時、code architectureへの介入も候補にする。

1. **snapshot**: Codegraphのversion、index generation、pending／unresolved、対象symbol／path、
   caller／callee、impact、affected testをboundary evidenceとして固定する。
2. **augment**: schema、transaction、state、generated artifact、config、external API、H effect、
   dynamic dispatchをCodegraph外の証拠として足す。見えない境界を空や安全へ丸めない。
3. **compare**: TODO候補ごとのread、write、state、effect、test面を比較し、hard needとconflictを分ける。
4. **verdict**: `parallel_ready`、`seam_candidate`、`intentional_serial`、
   `unknown_requires_evidence`のtyped verdictを返す。根拠のないindependence scalarは作らない。
5. **intervene**: `seam_candidate`だけ、挙動不変レーンの独立refactor、characterization、rollback cut、
   失効させる旧contextを持つ変換案へする。単なるfile分割や美化は生成しない。
6. **reobserve**: refactor後に同じquery setで再indexし、edge／impact／affected test／conflict候補の
   前後差分を取る。これは構造的分離の証拠であり、semantic independenceの単独証明ではない。
7. **accept**: behavior gate、schema／state／effect契約、negative control、親reviewを合わせ、
   並列境界をaccept／rejectする。Codegraphとtest greenの一方だけで挙動同値を宣言しない。
8. **recompile**: accept時は旧plan versionと旧agent contextを失効させ、accepted refactor artifactを
   predecessorにした新versionのprecedence、conflict、capacity、joinへ全候補を再コンパイルする。

境界manifestの最小情報は次である。

| field | 意味 |
|---|---|
| `graph_evidence` | Codegraph version／index state、query set、対象symbol／path、前後digest |
| `owns` / `reads` | 変更所有symbol／pathと、参照する公開contract |
| `writes` / `effects` | file／generated artifact／state／external effect／Hの変更面 |
| `hard_needs` | 型付きwitnessを持つ真の先行依存 |
| `conflicts` | write、semantic、state、effect、integrationの同時実行排他 |
| `unknowns` | unresolved、dynamic dispatch、reflection、config、外部semantics等の未証明面 |
| `tests` | affected候補、characterization、local gate、join gate、negative control |
| `verdict` | `parallel_ready`／`seam_candidate`／`intentional_serial`／`unknown_requires_evidence` |
| `version_barrier` | 失効するplan、agent context、patch、仮定と、新versionが消費するrefactor artifact |

refactorの目的関数は保守性一般でなく、**multi-agent開発の純並列便益**である。架空の所要時間を
入力せず、conflict edgeの減少、unlockされるready node、critical chain／dominatorの変化、
追加diff、gate、review、context失効、integration cutを構造的に比較する。実行後はactual wall-clock、
rework、merge、review、rollbackを含む全費用で介入なしの並列案と比較する。

製品の自動化は能力で段階を分ける。最初は全工程を実行するがcode変換はshadow proposal、次に
人が承認した既知の機械的refactor classだけを隔離commitへ適用し、十分な反復実証後にallowlist済み
classだけ自動適用する。これは研究を推薦器で止める意味ではなく、証拠に応じて書込権限を昇格する契約である。

### Pass C — 実行graphとwave

各TODOへhard predecessor、conflict、capability、owner、gateを付ける。transitiveなprecedence edgeは
説明に必要なものを除いて減らし、真に直接の依存を見えるようにする。

dotagentsではAIの作業時間見積を計画判断へ使わない。そのため通常のduration-weighted CPMを移植せず、
次の構造をcritical setとして扱う。

- 多数の後続をunlockするinterface／Decision node。
- joinを支配するdominator node。
- dependency depthが深いchain。
- Hや外部状態に接続するgate。
- 過去の実測でrework／semantic conflictが集中した境界。

計画時に架空の時間を付けず、実行後のactual wall-clock、queue／quota待機、review、rework、join idleを
retrospectiveへ使う。LAMaSのcritical-path token proxyは、均質なLLM operator graphを学習する比較信号としては
有用だが、repository変更、test、人手gate、異種providerを含む工場へ必須fieldとして移植しない。wall-clockを
捨てず、安定比較が必要な時だけ、LLM生成時間、tool時間、queue、H待ちを分解して併記する。

ready frontierでは「起動可能なnodeを全部起動」しない。Graham型list schedulingの`2-1/m`保証には、有限の
同一processor、処理時間やpriority等の前提があり、未知duration・異種model・semantic conflictのあるAI TODOへ
直接適用できない。候補集合から、conflict-free、capacity-feasible、integratorが回収可能で、構造上の
critical setを前へ進めるwaveを選ぶ。

## 4. 原子的TODOの判定rubric

TODO候補は、次の質問を順に通す。数値scoreではなくtyped verdictを返す。

| 観点 | 合格条件 | 不合格時 |
|---|---|---|
| Outcome | 合否を一つの質問で答えられる | outcomeごとにsplit |
| Change reason | 一つの設計判断／変更理由を所有する | Parnas境界でsplit |
| Contract | 入力と出力artifactが明示・version固定できる | interface-firstを先行 |
| Edge witness | hard needごとに消費するartifact／interface／state／acceptance／H証拠がある | 根拠のないedgeを除去またはconflictへ移す |
| Scope | writeとruntime effectがbounded | scopeを分けるか直列化 |
| Evidence | local evidenceを生成できる | integration cutへ合否を送る |
| Accountability | accept/reject/replanするownerが一人 | ownerを決めるかnodeをsplit |
| Behavior lane | refactorと挙動修正が混在しない | 別TODOへ分離 |
| Rollback | nodeまたは明示したjoin cutで戻せる | rollback cutを上位へ移す |
| Reviewability | 一回のTODO監査で全差分と根拠を理解できる | splitまたは先行文書化 |

`same repo`、`same owner`、`同じreviewer`、`安全そうだから念のため`はedge witnessにならない。これは
偽依存を見えないまま増やす典型である。Graph Harnessもspurious dependencyは構文的に正しいためruntimeが
検出できず、ready幅だけを失うと指摘する。ただし同論文は未実証の設計提案なので、この警告はObserverで
edge削除前後の結果を実測して確かめる。

### Splitする兆候

- 二つ以上の独立outcome、owner、rollback cutがある。
- 一方の成果をversioned interfaceとして先に固定できる。
- 挙動不変リファクタと挙動変更が混在する。
- 一部だけでもbuildable／testable／revertableな成果になる。
- 一つのTODO完了前に別担当がその成果を安全に使える。

### Splitを止める兆候

- 子node単体ではbuildも意味のある証拠生成もできない。
- reviewは常に全childを同時に読まないと成立しない。
- 全childが同じ未固定schema、transaction、state machineを別々に判断する。
- childを戻すと全siblingとdownstreamも必ず壊れ、独立cutが存在しない。
- node追加によってhard edgeとjoinが増えるだけで、ready frontierが増えない。
- coordination artifactの作成・同期・監査がlocal workより支配的になることが実測された。

最後の判定は事前の主観的時間見積で行わず、過去waveのhand-off数、parent介入、merge conflict、semantic
failure、accepted-but-unintegrated WIPを使う。

## 5. 先行リファクタを置く条件

クオの指摘どおり、コードが責務ごとに分かれていなければ計画全体の並列化は難しい。ただし、巨大fileを
機械的に分割すればよいわけではない。先行リファクタTODOを置くのは、次を満たす時だけにする。

1. 現在の残計画に、同じ共有境界で待つ二つ以上の後続TODOが実在する。
2. 重複量の大小ではなく、抽出可能なseam、interface、ownershipを実装前に説明できる。
3. characterization testとnegative controlで既存挙動を固定できる。
4. 抽出によってprecedence cycleまたはwrite／semantic conflictが実際に減る見込みがある。
5. リファクタ自体を独立revertでき、後続の挙動変更と混ぜない。
6. 再index後の構造差分だけでなく、static graph外のstate／effect契約を再確認できる。
7. 旧plan／旧agent context／生成途中patchをversion barrierで失効させられる。

逆に「将来便利そう」「ファイルが長い」「Workerを余らせたくない」だけでは置かない。目的は美しい分割でなく、
現在のready frontierを安全に広げることだ。

## 6. TODO内部fork-joinのadmission

外層TODO DAGを既定とするが、次をすべて満たす場合だけ内層graphを許可する。

### Green — writerを含むfork-join可

- accountable integratorが一人。
- childごとのobjective、read/write/effect scope、local gateが明示される。
- shared contractがimmutable Decision／versioned artifactとして固定済み。
- writerは別worktree、または帰属可能な非交差write境界に隔離される。
- merge順、join gate、conflict時のowner、cancel/replan条件がある。
- local greenとglobal integration greenを区別する。

### Amber — read-only／candidateだけ並列

- interfaceや内部表現がまだ不安定。
- 同一fileまたは同一state machineだが、探索・test設計・候補比較は独立できる。
- 複数案を作り、親が一案だけ採用する。

この場合、実装writerは一本化する。Findや候補生成の並列性を、共同writeの許可へ読み替えない。

### Red — 直列

- 認可、transaction、migration、公開API byte compatibility、履歴修復。
- 同一worktree fingerprintを共有するwriter。
- 未固定schema／state machineを複数writerが変更する。
- live provider、production、credential、registry publish等のH effect。
- join gateがなく、「最後に親が何とかする」しか統合戦略がない。

AI研究は内部fork-joinの可能性と危険の両方を示す。CAIDはdependency-aware plan、隔離worktree、
branch-and-merge、test joinで単一agentを上回ったpreprint結果を報告する。一方CooperBenchは、別taskを
二agentへ割っただけではcoordinationにより平均成功率が落ちることを示す。Anthropicの研究systemも、
並列探索は強いがcodingは独立方向が少なく、multi-agentはchat比で大幅にtokenを使うと報告する
（[[raw/caid-asynchronous-software-agents]]、[[raw/cooperbench]]、
[[raw/anthropic-multi-agent-research-system]]）。

## 7. Joinと監査を増殖させない

TODOを細かくした結果、integration TODOと監査が倍増すると速度を失う。次の区別を置く。

- 単に複数accepted resultをmergeし、既定のcombined gateを通すだけなら**Campaign join gate**であり、
  新しいTODOにしない。
- integrationで新しいcode、adapter、migration、Decision、手動conflict解決を作るなら、独立した
  **integration TODO**にする。
- 各外層TODOは完了候補で親が一回だけ軽量監査する。
- Campaign joinはmember result、combined diff、integration testを一回確認する。
- 重い独立監査はPhase完了時に一回だけ行う。
- 内層childのWorker受入を、外層TODOの数だけ独立監査へ昇格させない。

join modeは少なくとも`all_of`と代替branchを区別する。ただしGraph Harnessの`any_of`は全候補を並列起動し、
最初の成功後にrunning siblingまで`skipped`へする一方、`first_of`は敗者cancelが難しいとして除外しており、
意味上の緊張がある。dotagentsでは名称をコピーせず、(a)全成果必須、(b)実行前に一案選択、
(c)競争実行してfirst-successを採る、を分ける。(c)はread-only／隔離candidate／補償可能なeffectに限り、
cancel receiptとcommit pointを持たせる。

Googleのsmall CL実務規範も、self-contained change、関連test、buildを壊さないこと、refactorの分離を
勧める一方、APIだけを孤立させて利用例がなく意味が読めないほど小さくすることは避ける
（[[raw/google-small-cls]]）。この「小さくするが意味を失わせない」が停止条件になる。

## 8. 動的再計画

Cataldoらの実証では、task dependencyと必要なcoordinationは時間とともに大きく変動する
（[[raw/cataldo-coordination-requirements]]）。したがって、DAGを完全な未来予測として固定しない。

ready frontierごとに次を行う。

1. active `plan_version`のnode／edge／join／contract digestを固定する。
2. predecessor artifactとdigestを再確認する。
3. 実diffからwrite/effect scopeを更新する。
4. 新しいsemantic dependency、偽依存、cycle、粒度不良を検出する。
5. topology変更が必要ならaffected nodeをholdし、旧versionを終了させ、新versionとgraph diffを作る。
6. 既にacceptedな成果と証拠を書き換えず、新versionから参照する。
7. aborted approachを成功へ丸めず、cancel理由と再開条件を明示する。

Magentic-OneのTask Ledger／Progress LedgerやOpenAI Symphonyのtask treeも、計画と実行状態を分け、
stall／新発見で再計画する実例を示す。Symphony取得記録は
[[raw/openai-symphony-source-record]]を参照する。

## 9. 最小TODO記法

人間が読むplanへ、巨大schemaを埋め込む必要はない。plan節に`plan_version`とgraph diffの親Decisionを
一度置き、各TODOは次の最小形で十分である。

```markdown
- [ ] O-PB1 Codex generation terminalを再送なしで観測できる
  - needs: interface=ADR-0043/0044（witness: terminal observation contract）
  - produces/contract: observeCodexGenerationTerminal API + focused evidence
  - owner/scope: codex runtime; writes src/codex-host-runtime.mjs, test/...
  - effects/conflicts: read-only provider observation; O-PB2とwrite非交差
  - gate: interrupt/thread-start/turn-startが0、同一turn terminalのみreceipt化
  - rollback cut: 独立commit
```

計画冒頭または節ごとに、DAGとwaveを一度だけ表す。

```markdown
| node | hard needs + witness | conflict/effect | criticality | wave | join |
|---|---|---|---|---|---|
| O-PB1 | ADR-0044: terminal contract | 同一worktree writer／read-only | PB-Jをunlock | W1 | PB-J:all_of |
| O-PB2 | ADR-0044: binding contract | 同一worktree writer／provider fake | PB-Jをunlock | W1 | PB-J:all_of |
| O-MR1 | PB-J: combined gate | codex/claude runtime write | rollover chain | W2 | generation-J:all_of |
```

`owner`は一人のaccountable integratorを表し、worker数を一に制限しない。`needs`はhard precedenceだけ、
各edgeの`witness`は後続が実際に消費するartifact／interface／state／acceptance／H証拠を表す。
`conflict`は同時実行排他、`effect`はread-only／local-write／external／H等の副作用、`join`は局所greenを
製品greenへ変える地点である。通常の成果統合は`all_of`、代替案の`any_of`／競争実行は、敗者cancelが
安全なread-onlyまたは補償可能なcandidateだけに制限する。

各TODOの詳細へgraph全体を複製せず、dispatch前のboundary manifestを一件だけ参照する。

```markdown
  - boundary: BM-O-PB1-v1
    graph: Codegraph 1.4.1 / index complete / query-set digest=...
    owns: observeCodexGenerationTerminal, src/codex-host-runtime.mjs
    unknowns: app-server terminal semantics, crash後のexternal result
    verdict: parallel_ready（Codegraph単独判定ではなくADR 0044とfocused fixtureを併用）
```

## 10. Plan lintと自動化可能範囲

機械化できるもの:

- checkbox/node IDの重複、orphan、cycle、未定義dependency。
- transitive reduction候補とready frontier。
- hard edgeの型／witness欠落と、同一repo・ownerだけを根拠にした偽依存候補。
- 同一path／worktree／repo／effect scopeの明示競合。
- owner、gate、produces／output contract、effect class、rollback cutの欠落。
- active plan version内のtopology mutationと、replan時のgraph diff欠落。
- accepted predecessorのartifact digest不一致。
- wave内のresource/capability超過。
- integration-only nodeが成果物を持たず増殖している警告。
- boundary manifestのgraph state、unknown、static-analysis外のeffect証拠、version barrier欠落。
- seam-refactor前後でconflictもcritical structureも変わらない「並列化目的のないrefactor」候補。

機械化だけでは決められないもの:

- 二つのfileが同じ暗黙表現を共有しているか。
- interfaceを今固定すべきか、探索を続けるべきか。
- split後のcoordination costが価値を上回るか。
- public API、transaction、HをFとして親直轄にすべきか。
- testが本当に製品outcomeを証明しているか。

将来の`plan-lint`はgraph invariantを検査する補助に留め、LLMが生成した依存を自動で真実扱いしない。
Codegraph、AST/import graph、git co-change、test impactはdependency candidateを出し、親が実ファイルと
Decisionを読んで採否を決める。

## 11. 特許調査

特許は設計語彙と既存案の探索に使い、有効性の証拠には使わない。statusはGoogle Patents表示を法的結論と
せず、侵害・自由実施の判断は行っていない。

| family / publication | 抽出した機構 | 本研究での扱い |
|---|---|---|
| [US9009652B2](https://patents.google.com/patent/US9009652B2/en) | parallel design artifactのdependency graphで共通下位依存を衝突候補化 | semantic shared dependencyの先行検査として採用。登録特許本文は[[raw/patent-us9009652b2-design-conflicts]] |
| [US20050262485A1](https://patents.google.com/patent/US20050262485A1/en) | modelと生成code等、相互派生artifactの二重merge回避 | artifact lineageをwrite file一覧より広く取る示唆 |
| [US20250247211A1](https://patents.google.com/patent/US20250247211A1/en) | promptをtaskへ分解し、capability／schedule ontologyでnodeへ割当 | capability matrixの存在例。実証根拠にはしない。[[raw/patent-us20250247211a1-decentralized-ai]] |
| [US20250371449A1](https://patents.google.com/patent/US20250371449A1/en) | atomic task check、dependency mapping、順次／並列action、feedback再計画 | 二層dynamic graphの類似案。公開出願であり性能主張は採らない。[[raw/patent-us20250371449a1-dynamic-agents]] |
| [US20250086534A1](https://patents.google.com/patent/US20250086534A1/en) | agent suitability、availability、load、capability specificityによる割当 | rate-aware selectorの比較候補。TODO atomicityの根拠にはしない |
| [US5797012A](https://patents.google.com/patent/US5797012A/en) | call graphとinterference graphから非干渉compilation moduleへpartition | graphからpartitionを作る先行技術。開発TODOのseam-refactor／version barrier閉ループとは区別する |
| [US20250315253A1](https://patents.justia.com/patent/20250315253) | file dependencyでcodebaseを分け、code analyzerを並列実行 | 並列analysisのpartitionであり、開発変更の競合をcode変換で解かない |

compiler側ではPS-PDGがsemantics-preserving parallel execution planの制約表現を扱う
（[[raw/schedulability-transformation-prior-art-source-record]]）。これは重要な近接先行技術であり、
「依存graphから安全な並列構造を作る」一般原理を本研究の新規性として主張しない。差分候補は、予定された
開発TODOのwrite／effect conflictとagent統合費を入力にし、code seamへ介入し、全plan／contextを
version barrier越しに再コンパイルする開発時閉ループに限定する。
| [US6892192B1](https://patents.google.com/patent/US6892192B1/en) | least-commitment partial-order plannerによるdynamic business process | 並列前提の部分順序計画がLLM以前から製品化対象だった例。性能根拠にはしない |
| [US12254334B2](https://patents.google.com/patent/US12254334B2/en) | contextual execution dependency graphからagent sequenceを生成 | dependency graphとruntime logからworkflowをbootstrapする既存例 |
| [US12412138B1](https://patents.google.com/patent/US12412138B1/en) | resource availabilityに応じたparallel step、出力後replan、人手介入 | capacity-aware ready setと動的再計画の比較例 |
| [CN113760488A](https://patents.google.com/patent/CN113760488A/en) | 一般DAGをstageとparallel taskへ変換 | software planning固有性が薄く、設計根拠から除外 |
| [US9652286B2](https://patents.google.com/patent/US9652286B2/en) | runtime data dependency graphのtopological execution | compiler/runtime schedulingであり、人間・AI開発計画から除外 |
| [US20170109217A1](https://patents.google.com/patent/US20170109217A1/en) | runtime task conflict下のschedule | conflict語彙だけ参考、計画手法から除外 |
| [US20240176653A1](https://patents.google.com/patent/US20240176653A1/en) | AI agentの協調action planning | robot/action寄りで、software TODOへの一般化を保留 |
| [EP4624107A1](https://patents.google.com/patent/EP4624107A1/en) | LLM subgoalと形式plannerの連結 | robot long-horizon taskのため除外 |

同名の“Dynamic agents with real-time alignment”には複数publicationが検索される。調査中に
`US20250368219A1`と`US20250371449A1`の混同を検出したため、本稿ではMicrosoft Technology Licensingの
`US18/753,942 / US20250371449A1`だけを該当根拠として使う。候補番号を検索snippetだけで採用しない。
追加7件の書誌・claim照合と、不採用にしたJPO／出願比率claimは
[[raw/patent-addendum-source-record]]に記録した。

## 12. AI coding agent研究からの裁定

### 支持されたこと

- dependency-aware plan、隔離workspace、明示merge、実行testは有用。
- read-heavy探索、候補生成、独立検証は高い並列適性を持つ。
- ownerはsingle workerでなく、accept／merge／replanするaccountable integratorとして定義すべき。
- task graphとruntime progressは分け、stallや新発見で再計画する。
- compactでversionedなartifact共有は、全会話共有と完全隔離の中間として有望。

### 棄却した絶対表現

- 「TODO内部の並列は常に禁止」: CAID、MASAI、Anthropicの事例が反例。
- 「TODOを分ければsemantic independenceを得られる」: CooperBench、Specification Gapが反例。
- 「多Agentは単一Agentより常に強い」: AgentlessとMASTが反例。
- 「local test greenなら各TODOを独立受入できる」: integration failureを逃す。
- 「静的DAGを最初に完成すれば十分」: dependency volatilityとreplanning事例が反例。

### 証拠の強弱

- MASTはNeurIPS 2025で、1,600超trace／7 frameworkから14 failure modeを分類しているため、
  multi-agent failureの存在根拠として強い（[[raw/mast-multi-agent-failures]]）。
- MAGISとMetaGPTは査読済みだが、role分業全体の性能から「並列writerが有効」と因果推論しない
  （[[raw/magis-multi-agent-issue-resolution]]、[[raw/metagpt]]）。
- CodePlanはrepository-wide変更をdependency analysisとadaptive planningで進め、無計画baselineを上回るが、
  主に逐次的な変更伝播であり、並列幅の直接証拠ではない（[[raw/codeplan-repository-planning]]）。
- Agentlessは簡素なlocalize→repair→validateが複雑agentと競争力を持つ反証baselineになる
  （[[raw/agentless]]）。
- CAID、CooperBench、Specification Gapは2026年preprintであり、数値閾値を正典化せず、Observer dogfoodで
  構造だけを再検証する。
- Anthropicの16-agent C compilerは内部並列が可能な強い実例だが、約2,000 session／高cost、頻繁なmerge conflict、
  単一巨大kernel taskでの停滞も同時に報告している（[[raw/anthropic-parallel-claudes-compiler]]）。
- Graph Harnessはready set、plan-version、三層分離、output contract、effect class、join、bounded recoveryを
  一つの語彙へ整理した点に価値がある。ただし単著position paperで実装・実験がなく、70 OSS surveyは
  本文42件／付録見出し41件／列挙件数が一致せず、重複・closed-source流出物も含む。`60%`と`30–40%`を
  定量根拠にせず、設計仮説だけを採用する（[[raw/graph-harness]]）。
- Graph Harnessの形式化は、Agent Loopを`|U|≤1`と置いた直後にparallel tool callsを`|U|>1`と認めるため、
  「Agent Loopは必ずsingle-ready」という分類には内部緊張がある。私たちはready幅だけでなく、policy explicitness、
  edge witness、conflict、capacity、critical chainを別々に測る。
- LAMaSの掲載値はGSM8K／HumanEval／MATHでcritical-path proxyを38.0%／42.4%／46.1%短縮したが、proxyは
  各layerの最大`output tokens + tool seconds×50`の和であり、実wall-clockではない。HumanEval scoreも
  `93.00→92.11`と低下し、統計的不確実性は示されない。採用するのは「latency目的なしの並列graphは
  深くなり得る」という限定知見であり、工場の速度改善率ではない（[[raw/lamas-latency-aware-orchestration]]）。
- LLMCompiler、PLaG、Plan-over-Graph、DynTaskMASはplan／fetch／execute分離、graph表現、dynamic ready frontierの
  実在例になるが、function calling、非同期推論、合成graph等の条件からrepository writerの安全性を推論しない
  （[[raw/llmcompiler]]、[[raw/plag-asynchronous-planning]]、[[raw/plan-over-graph]]、[[raw/dyntaskmas]]）。

## 13. Observer provider bindingへの適用

現行ADR 0044の二つの実装scopeは、研究rubric上も別の外層TODOへ分けられる。

```text
ADR 0044（immutable contract）
   ├─ O-PB1 Codex terminal observation API ─┐
   └─ O-PB2 host-neutral binding machine ──┤→ PB-J campaign join
                                           └→ O-MR1 model-request unknown journal
```

### O-PB1

- outcome: 同一generationのCodex turn terminalをmutating commandなしで観測する。
- writes: `src/codex-host-runtime.mjs`、対応test。
- produces: `observeCodexGenerationTerminal`とfocused evidence。
- hard needs: ADR 0043/0044のcontract。
- conflict: 同一worktree writer。O-PB2とはfile非交差。
- Codegraph witness: 既存`readCodexObserverThread`→`parseCodexThreadReadResult`→
  `session.request("thread/read")`がread-only seam。`stopCodexObserver`はinterruptを含むため呼ばない。
- unknown/effect: method string越しのCodex app-server semantics、terminal receipt shape、crash後result unknownは
  static graph外。fixtureと実host H gateへ残す。
- affected: `test/codex-host-runtime.test.mjs`を主局所gateとし、generation lifecycleへの波及候補もjoinで確認する。

### O-PB2

- outcome: core recovery actionをClaude/Codex provider commandへ一command一stepで結ぶ。
- writes: 新規binding moduleと対応test。
- produces: host-neutral binding APIとcrash matrix evidence。
- hard needs: ADR 0044。O-PB1の**実装**には依存せず、namespace import／dependency injectionでcontractだけを読む。
- semantic guard: default wiringの合否はPB-Jへ送る。
- Codegraph witness: `prepareGenerationHostStop`、`readGenerationHostRecoveryContext`、
  `confirmGenerationHostTerminal`、`authorizeNextGenerationHostStart`、`recordNextGenerationHostSpawn`、
  `activateNextGenerationHost`というcore公開transitionだけを消費する。storeへ直接writeしない。
- unknown/effect: provider command結果不明、Claude live候補、Codex terminal mappingはDI fakeで安全へ推測せず、
  `unknown`または後続H gateへ出す。

### PB-J

PB-Jは新しいproduct codeを作らず、二結果のintegration、default wiring、combined focused gateだけならCampaign
joinであり、第三のTODOにしない。統合時に新しいadapter codeまたはDecisionが必要だと判明した場合だけ、
その発見を`O-PB3`へ昇格する。最初から「統合TODO」を増やさない。

このwaveは別worktreeを必要とする。同じshared worktreeではdotagents Controlのworkspace fingerprintが
非交差pathでも変化し、互いのRunをdriftさせるためである。これはprecedenceではなくexecution conflictである。

再index後は、(a) O-PB1がstop／interrupt pathを呼ばない、(b) O-PB2がcore公開APIだけをimportする、
(c) binding testが実provider runtimeを直接importしない、(d) affected test候補が局所gateとjoin gateへ
追跡できる、ことを構造証拠として確認する。これだけでsemantic independenceや外部provider挙動を
証明したとは扱わず、ADR、fixture、H受入との複合gateでacceptする。

## 14. 実証計画

本研究の構造を正典化しても、固定並列数や万能な粒度は決めない。Observerの実waveで次を観測する。

- single writer、外層TODO DAG、条件付き内層fork-joinの成功率とactual wall-clock。
- parent token、Worker token、hand-off、parent介入、review回数。
- textual merge conflictとsemantic integration failureを分離した件数。
- local green後にjoinで落ちるfalse-green率。
- plan split／merge／cancel／edge変更のchurn。
- accepted-but-unintegrated WIPとcritical joinのidle。
- rollback後にdownstreamがgreenを保てるか。

一回の成功を一般則にせず、異なる結合条件で反復する。

1. 別file・別contract。
2. 別file・共有schema。
3. 別file・共有state machine。
4. 同一fileのread-only探索＋single writer。

## 15. dotagentsへの採用案

共有orchestration正典へ採用する最小規則は次である。

1. 計画作成時にWBS、hard dependency DAG、conflict、capacity、joinを分けて示す。
2. 主たる並列化面は外層TODO DAGとする。
3. TODO内部fork-joinはadmission条件とjoin gateを満たす時だけ許可する。
4. 各hard edgeへ型とwitnessを要求し、file非交差をsemantic independenceの十分条件にしない。
5. nodeごとにoutput contract、effect class、local gate、rollback cutを置く。
6. active plan versionのtopologyはimmutableにし、構造変更はgraph diff付き新versionで行う。
7. cycleはcharacterization／interface-first／抽出リファクタ、または意図的直列化で裁定する。
8. integrationがmerge＋combined gateだけならCampaign joinとし、TODOを増やさない。
9. 代替branch／競争実行はjoin semantics、cancel、commit point、effect安全性を明示する。
10. ready nodeを全部起動せず、conflict、capacity、integrator負荷とcritical chainでwaveを選ぶ。
11. AI時間見積でcritical pathを作らず、構造上のunlock／dominatorと分解した実測値を使う。
12. retry／patch／replan／Hをerror classとbudgetで制限し、無意味な回復段階を強制しない。
13. ready frontierごとにdependencyとscopeを再検証し、versioned replanする。
14. agent数、TODO数、ready幅、並列度を単独の成功条件にしない。
15. dispatch前にCodegraphでowned symbol／path、dependency、impact、affected testをboundary manifestへ固定し、
    static graph外のstate／effect／dynamic unknownも同じmanifestでfail-loudにする。
16. conflictに切断可能なseamがある時は、純並列便益を目的とする挙動不変refactorを独立cutで候補化する。
17. refactor後は同じquery setで構造差分を取り、semantic／effect gateも通してから旧plan／contextを失効し、
    新plan versionへ全TODOを再コンパイルする。
18. 自動変換はshadow proposal→承認付き既知class→反復実証済みallowlistの順で権限を昇格する。

Control schemaの即時version upや自動scheduler実装は行わない。まずplan proseとObserver dogfoodで、追加fieldが
本当に必要かを実証する。既存のTask dependency、write scope、Campaign、placement、workspace bindingで表現できる
範囲を使い切り、再現した不足だけを独立TODOへする。

## 16. 未確定事項

- semantic conflictを静的に十分高い精度で予測する方法は未確立。
- TODO粒度の最適点はrepo、test速度、reviewer、model、provider costで変わる。
- 2026年AI coding multi-agent研究の多くはpreprintまたは限定benchmarkで、長期運用の独立再現が少ない。
- patent statusとfreedom-to-operateは本研究の範囲外。
- outer TODOとinner subtaskのどちらへControl Taskを対応させるかは、Observer dogfoodの運用摩擦を見てから裁定する。
- 仮称Latticeの製品名、Codegraph公開SDK adapterで足りる境界と所有forkが必要な境界は、初回prototypeで確定する。

したがって、研究で完成したのは既存手法の模倣や万能な自動分解器ではなく、**計画担当が依存、競合、
capacity、joinを分け、コード境界へ介入する純便益を裁定し、version barrier越しに全TODOを再コンパイルする
ための製品契約**である。次はObserverの介入あり／なし比較を最初の実証にする。
