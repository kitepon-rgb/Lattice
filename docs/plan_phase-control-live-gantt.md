# Phase統制・live工程表・局所seam一般化計画

## 目的

Lattice 0.8.0で成立したtyped ToDo storeと内蔵sensorを土台に、0.9.0でDotagents正典が要求する
「ToDo完了時の軽量監査」と「Phase完了時の重い監査」を別の制御境界として機械化する。
同時に、工程表をstore更新へ追随するread-only live viewへ拡張し、境界競合が限定的な場合だけ
競合箇所のbounded locusを隔離変換して再compileできる一般契約を作る。

工程状態の正本はLattice storeの`phase-control-live-gantt` planとする。本書は目的、思想、
判断理由、非目標、受入条件、計画への導線だけを所有し、ToDo状態を重複管理しない。

## 思想と裁定

- Latticeへのruntime切替は完了済みとして扱う。PATH上のCodegraph、外部SDK、旧Codegraph cacheを
  判断証拠へ使わない。残存する旧コマンド・旧名称は追従漏れまたは互換ABIとして個別に処理する。
- Phaseはlane、`parent_task_id`、通常の「受入ToDo」では表現しない。Phaseは後続作業の解放、
  重監査の一回発火、accept/reject/reopen、Decision証跡を所有するfirst-class controlである。
- 同一planのToDo eventとPhase eventは同じ線形journalへ記録する。cross-plan後続はstart時点で
  predecessor Phaseがacceptedであることをwriterが検査するが、旧plan versionやjournal headを下流eventの
  永続依存先にしない。Phase定義と所属ToDo集合が同じrevisionだけDecision stateをcarryし、変わればresetする。
- Lattice coreは汎用gate state machineとtyped evidence検証を所有する。Dotagentsは
  `phase_gate_policy`を所有し、maintenance wave、full regression、Find→Dedup→反証→Critic、
  最終Decisionに必要な証拠slotを定義する。
- 既存の静的Gantt exportは決定的なoffline証拠として維持する。live viewはforeground、
  loopback-only、read-onlyの別surfaceとし、storeをbrowserから変更しない。
- 「そのファイルだけのrefactor」は文字どおり一pathに限定しない。元の競合file、抽出先、必要なtestを
  explicit bounded locusとして固定し、それ以外のrepo surfaceを変更しないという意味にする。

## 作業レーン

- F: plan/journal/snapshot/revisionのversion契約、Phase gate、cross-plan mutation整合、stable read、
  live serverのread-only境界、successor planの裁定。
- A: characterization fixture、Gantt表示、CLI配線、文書追従、AIShell migration入力、局所transform実装。
- H: push、publish、npm release、本番deploy。明示承認がないため本計画の実装範囲に含めない。

同一repoのcore schema、store、CLIが強く結合しているため、Phase coreは直列で受け入れる。
Phase read model確定後はlive Ganttとseam candidate安全網を非交差範囲で並行化できるが、
同一fileのwriterを同時に走らせない。

## 工程

### Phase 0 — 計画・敵対的検証・Control固定

計画をLattice storeへ作成し、独立refuterが要求、不変条件、schema世代、受入順序、非目標を反証する。
実在する指摘だけをDedupし、採否と理由を本書およびControl Decisionへ還流してから本体実装へ進む。

### Phase 1 — 公開契約と既存不整合の安全網

cross-plan dependencyについてstatus/Ganttとwriterの判定が一致するcharacterizationを置き、start、done、reopenの
writerをmerged store検査へ修正する。参照先planと参照元planをsuccessorへ進める際は、一方ずつのmanifest activationで
必ず生じる旧/new topology bindingの谷を許容しないmulti-plan activation transactionを設計する。対象plan集合、全predecessor
manifest digest、新plan/journal/snapshot、inbound binding、source cutoverを一つのCASとcrash recoveryへ束縛し、全planが
同時にactiveになるか全bytes不変で失敗するかのどちらかにする。
静的Ganttのcurrent/stale/missing/error判定を追加し、旧Codegraph運用入口をLattice sensorへ追従させる。
`todo status/verify --json`は既存のflag無しJSON契約を変えず、互換aliasとして追加する。

### Phase 2 — first-class Phase control

successor plan、journal entry、snapshot、manifest、revision、migration schemaへPhaseを追加する。
Phase stateは`locked / active / gate_ready / reviewing / accepted / rejected`を持ち、全ToDo完了では
`gate_ready`までしか進めない。typed gate Decisionがacceptされるまで後続Phaseを解放しない。
Phase reopenは同一planとcross-planの開始済み後続をmerged graphで検出し、明示override/cascade契約なしには受理しない。
既存plan v1〜v3、event、snapshot、revision、migration bytesは無変更で読めることを固定する。

### Phase 3 — Phase projectionとlive工程表

status、inspect、next action、GanttへPhase境界・進捗・gate状態を投影する。既存static rendererを共有serviceへ
抽出し、stable read transaction、loopback HTTP、SSE、UI state復元、stale/error bannerを追加する。

### Phase 4 — AIShell successor revision

AIShellの49 ToDoを明示的にPhase 0〜7へmappingし、見出し、lane、titleから暗黙推測しない。
既存の「Phaseを受け入れる」ToDoはgate証拠準備へ位置付け直し、ordinary doneをPhase acceptedへ昇格させない。
旧Codegraph receipt表記をfresh Lattice sensor evidenceへ差し替え、ACE-001開始前にsuccessor revisionをverifyする。

### Phase 5 — bounded seam一般化

runtime finding、ToDo pair、base/manifest、exact symbol/span、allowed/required changed paths、oracle/test envelopeを
束縛するcandidate schemaを追加する。disposable worktreeでのみ変換し、fresh sensor再解析、挙動同値、
focused test、競合削減、純並列便益を満たす場合だけsuccessor planへ採用する。曖昧・失敗・費用超過は
rejected artifactを残して`intentional_serial`へ明示的に戻す。

### Phase 6 — 統合、重監査、還流

maintenance waveを一回行い、full regression後に契約クリティカル範囲をFind→Dedup→反証→Criticで監査する。
accepted DecisionをADRへ固定し、公開契約・README・active docsを更新する。push/publishは行わない。

## 非目標

- 外部Codegraph runtimeまたは旧データへのfallback。
- 既存plan/event/snapshot bytesのin-place reinterpretation。
- ToDo全完了によるPhaseの自動accept。
- Phase見出し、lane、title、`parent_task_id`からの暗黙migration。
- browserからのstore mutation、LAN bind、background daemon化。
- 任意言語・任意repo・任意seam classへの無条件自動refactor。
- 静的Gantt exportの廃止。
- push、publish、release。

## 既知の罠

- 現writerはjournal、snapshot、manifestを別renameするため、live readerが途中状態を読むと通常更新を
  store破損と誤認し得る。開始/終了manifestとwrite barrierを再照合するstable readが必要。
- 現writerのpredecessor検査は同一planへ偏っており、cross-plan graphの表示とmutationが乖離し得る。
- topology digestはplan versionを含むため、参照先と参照元を一件ずつreviseする直列cutoverでは必ず一方が
  `binding_stale`になる。複数planの公開点を一transactionで切り替える必要がある。
- Phase専用journalを別にするとtask/phase間の因果を二重headへcross-linkする必要があり、crash surfaceが増える。
- planごとのjournalは独立している。標準policyはcross-planの完全な履歴因果証明を要求せず、start時のactive
  state検査と開始済み後続のreopen保護を持つ。旧versionまで固定する監査は将来のopt-in strict policyとする。
- ordinary gate taskだけではreject Decision、重監査の一回性、policy evidenceを表せない。
- seam変換でbaseが変わった時、carry-over非交差を証明できないin-flight ToDoは全てholdへ戻す。
- stale HTMLを存在確認だけで案内してはならない。last-good表示時もcurrentとは明示的に区別する。

2026-07-21追補: 静的GanttはHTMLとdigest付きsidecarを一組として発行し、`todo gantt status`が
現在の決定的renderとの一致から`current / stale / missing`を返す。片側欠落・改ざんはtyped failureとする。

## 受入条件

- `npm test`、`npm run check`、`npm run ci`がgreen。
- 旧schema fixtureと旧store bytesが無変更で読め、新fieldのin-place混入を拒否する。
- 全work ToDo完了時はPhaseが`gate_ready`となり、後続Phaseのstartを拒否する。
- policy-bound heavy audit receiptとimmutable Decisionが揃ったacceptだけが後続を解放する。
- reject/reopen、revision CAS、crash retry、source cutoverがtypedかつ再現可能。
- cross-plan predecessor未完了時、statusとwriterが同じ理由でstart/doneを拒否する。
- cross-plan後続が開始済みならpredecessor ToDo/Phaseのreopenを拒否し、override/cascadeなしに依存を破壊しない。
- 相互参照を含む複数plan successor cutoverは全manifestを一度に公開し、CAS競合・各crash point・retry失敗時に
  一部planだけをactiveにせず既存store/source bytesを保持する。
- cross-plan後続startは、その時点でpredecessor Phaseがacceptedでなければ拒否される。
- Phase定義、gate policy、前段Phase、所属ToDo集合が同じrevisionだけDecision stateをcarryする。
- static Ganttのbytes・networkゼロ・CSP・result schemaが非回帰。
- live viewerはmixed store viewをfreshとして配信せず、更新・切断・stale・破損を閲覧者へ表示する。
- live viewer前後でstore全fileのdigestが不変。
- bounded seam以外のpath変更、stale candidate、scope drift、oracle/test失敗は採用されずserialへ戻る。
- AIShell successor planは明示Phase mappingを持ち、ACE-001開始前にverifyされる。

## 検証入口

- 実装中: 変更対象のfocused `node --test`。
- Phase受入前: 関連testを一回。
- 最終gate: `npm run ci`。
- AIShell migration: `lattice todo verify`、`lattice todo phase status`、静的Gantt生成、live viewer実browser確認。
