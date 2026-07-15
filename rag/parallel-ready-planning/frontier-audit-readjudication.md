# 並列TODO／Lattice先端研究 監査指摘の再裁定

- 裁定日: 2026-07-15
- 対象: Opusメモの独立検証、Graph Harness／LAMaS反証、TODO構造反証、Lattice反証
- 裁定者: 親統括
- 基準: 実コードで再現する欠陥、宣言した不変条件との矛盾、明白な論理破綻、一次資料の誤読、
  実験による仮説反証だけを拘束的findingとする。前例不足、未実証、一般的な保守論、`worth_it`判断は
  研究停止やscope縮小の根拠にしない。

## 親裁定

| ID | 監査指摘 | 再裁定 | 理由／製品への反映 |
|---|---|---|---|
| A1 | TODO内部の並列は避け、外層TODOだけを並列化すべき | **限定採用** | 外層が主面なのはオーナー要求。内層fork-joinを一般禁止する論拠はなく、contract固定・隔離・join可能なら使う |
| A2 | precedence DAG、conflict graph、capacityを分ける | **採用** | 有向の真依存、無向の同時実行排他、時変resourceは意味が異なる。混同すると偽edgeまたは危険dispatchになる論理上の問題 |
| A3 | 一TODOにはaccountable integratorを一人だけ置く | **限定採用** | 現行orchestrateでは親がacceptするため最終裁定者は一人。研究上の普遍則ではなく、再帰joinや複数integratorを禁止しない |
| A4 | ready nodeをすべてdispatchしてはならない | **採用** | conflict、quota、H、回収capacityを満たさないnodeはreadyでも実行不能。ready幅最大化を目的関数にしない |
| A5 | hard edgeへartifact／interface／state／acceptance／H witnessを要求する | **採用** | witnessのないedgeは真依存か検証不能。same repo／ownerをprecedenceへ偽装しない |
| A6 | merge＋combined gateだけの統合を新TODOにしない | **採用** | outcomeを新しく生成しないjoinをTODO化すると管理作業だけ増える。新code／Decisionが出た時はTODO化する |
| A7 | active plan versionのtopologyはimmutableにする | **採用** | 可変planをDecision digestへ使って失効した実障害がある。適応は新versionで行い、動的研究を禁止しない |
| A8 | retry→patch→replanを必ず順に踏む | **棄却** | auth不足やnon-retryable effectへretryするのは明白に無意味。error classにより直接replan／Hへ進む |
| A9 | Graph Harnessの70 OSS、60%、30–40%を定量根拠にする | **棄却** | 本文42、付録見出し41、列挙／重複が整合せず、30–40%はsample表のない概算。設計語彙だけ利用する |
| A10 | Agent Loopは定義上必ず`|U|≤1` | **棄却** | 同論文自身がparallel tool calls／async loopを`|U|>1`と認め、分類が自己矛盾する |
| A11 | Graph Harnessの`any_of`は安全だが`first_of`は除外すべき | **棄却** | running loserをskip／cancelする問題を両者が共有する。名称でなくcommit point、effect、cancel契約で裁定する |
| A12 | LAMaSは実wall-clockを38–46%改善した | **棄却** | 測定値はlayerごとの`output tokens + tool seconds×50`最大値の和。wall-clock claimへ読み替えられない |
| A13 | LAMaSはcritical-path目的を持つ価値を一切示さない | **棄却** | 同一論文内の限定benchmarkでは、parallel structureだけのablationよりcritical-path proxyが改善した。限定仮説の根拠にはなる |
| A14 | Grahamの`2-1/m`をAI worker配置へ保証として適用する | **棄却** | homogeneous processor、duration／priority等の前提が異なる。古典式を保証として輸入しない |
| A15 | 一次書誌を確認できないChatHTN／REPOP／RoboPARA等を事実として採る | **棄却** | 今回の一次確認が不足。存在しないという意味ではなく、根拠になるまでclaimを保留する |
| A16 | file非交差ならsemantic independenceが成立する | **棄却** | schema、state、transaction、generated artifact、effectを別fileから共有できる。Observerにも実在する |
| A17 | Codegraphは使わず親が全fileを読むべき | **棄却** | Codegraph 1.4.1はObserverでsymbol／impact／affected testを実際に返した。親reviewと補完関係であり代替二択ではない |
| B1 | 既知のmodule分割、refactor、DAG、再計画を組み合わせるのでLatticeに技術的新規性はない | **棄却** | ingredientの先行技術はsystem-levelの新規な目的関数、介入点、閉ループ、製品挙動を否定しない。法的新規性は別途claim単位で扱う |
| B2 | 再indexでsemantic independence／behavior preservationを証明できる | **棄却** | Codegraphが観測するedgeの前後差分以上を意味しない。構造証拠として使い、state／effect／runtime／verifierを併用する |
| B3 | 「重複が小さい時だけrefactor」は正しい条件 | **棄却** | 重複量と切断可能性／純便益は同一でない。seam、介入費、unlock、critical structureで判断する |
| B4 | 自動refactorは価値がないのでshadow推薦器に留める | **棄却** | 再現欠陥や論理矛盾ではなく監査役の製品判断。初期製品から隔離worktreeで実変換し、失敗も観測対象にする |
| B5 | 既知の機械的refactor classだけに限定する | **棄却** | 未知の有効な変換を設計上排除する根拠がない。生成refactorもbounded effect、rollback、verifier下で研究対象にする |
| B6 | test greenだけでbehavior-preservingと証明できる | **棄却** | 有限testは一般に完全証明でない。だから自動変換を禁止するのでなく、formal check、characterization、differential／metamorphic test、runtime evidenceを組み合わせる |
| B7 | refactorはmerge effortを増やし得る | **採用** | 反例が成立するため、refactor／replan／context失効／review／mergeを便益計算の費用へ含める。製品停止理由にはしない |
| B8 | plan version変更時に旧agent context／途中patchも失効させる必要がある | **採用** | version番号だけ変えて古いinterface仮定を残すと新graphと矛盾する明白な論理問題 |
| B9 | Codegraph内部indexの利用は禁止されている | **棄却** | 禁止はdotagents factory reporterが第三者DBを直接解釈する境界。ユーザー指示下のLattice製品研究／正式forkへ一般化したのはscope誤読 |
| B10 | archived orchestrator v1が自動意味分類を非目標にしたためLatticeも実装禁止 | **棄却** | v1 Control Recordのscope制限を別製品へ一般化した越権。Latticeは独立product contractを持つ |
| B11 | independence scalarは一切作ってはならない | **限定採用** | 単一scoreを安全認可の代用にはしない。一方、優先度・不確実性・比較用の多次元metricまで禁止しない |
| B12 | 15〜30件のA/B/C比較が済むまで製品実装しない | **棄却** | sample数は根拠のない固定値。実装と実験を同時に進め、反証力と観測飽和で次gateを決める |
| B13 | refactorなし並列／あり並列／直列を比較する | **採用** | 製品仮説を直接区別できる介入比較。固定sample数やshadow-only条件は付けない |
| B14 | `worth_it=false` | **棄却** | コード欠陥、論理矛盾、実験反証のいずれでもない。製品価値と研究継続はオーナーと親統括の裁定 |

## 残す研究仮説

Latticeの核は、Codegraphを使うことやDAGを描くこと単独ではない。予定された開発TODOの
symbol／state／effect境界を観測し、multi-agent開発の純並列便益を目的にcode architectureへ介入し、
検証後に旧plan／contextを失効させ、全TODO graphを再コンパイルすることである。

この仮説は未実証だから縮小するのではなく、Observerを最初の実装・介入実験として検証する。

