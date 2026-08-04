# 実装自由と実変更競合検知

工程状態の正本はLattice storeの`open-world-editing` plan。本書は目的、設計裁定、非目標、
受入条件だけを持ち、task状態と依存は複製しない。

## 目的

実装者は、計画時に名前も個数も決まっていない新規fileを含め、必要なrepo内fileを自由に作成・変更する。
`creates: true`、未作成pathの事前所有、宣言write scopeへの収容をdispatch又は受入の条件にしない。

Latticeが止めるのは、複数の実行中ToDoが実際に同じrepo相対pathを変更したことを、それぞれのcanonical
checkpointから再導出できた時だけである。計画時の境界は既知の競合を先に避けるための予測であり、
実装者へのwrite allowlistではない。

## オーナー裁定（2026-08-04）

1. 新規file作成に事前宣言を要求しない。path、個数、配置は実装中に自由に決められる。
2. 既存fileを予測外に変更しても、それ単独を警報、違反、finding、freeze、holdの理由にしない。
3. `creates`を自動推定する設計にも置き換えない。入力契約から不要にする。
4. 競合検知は既存の実編集観測を使う。新しい競合検知器を別系統で作らない。
5. 同じpathが2つ以上の実checkpointに残った時だけ`observed_write_conflict`とする。

## 現行実装で確認した事実

- `classifyObservedDiff`は、複数ToDoの観測pathを`writersByPath`へ集約し、2者以上が同じpathを
  実際に変更した時だけ`observed_write_conflict`を返せる。必要な実diff classifierは既にある。
- `captureWorktreeDiff`はuntracked／ignored／commit済みを含む追加・変更・削除をcanonical checkpointへ
  収録できる。新規fileも既に観測対象である。
- I/O sentinelの`probeIoWarning`は関与worktreeをcheckpointし、警報pathが双方のdiffに残ることを
  確認できる。sentinelは早期化だけを担い、checkpointが判定正本である。
- 一方、`classifyIoObservation`、`detectCheckpointFindings`、`buildIoEscalation`、managed runtimeの
  `finding_record` producer照合は、他ToDoの`packet.scope.writes`をまだ使う。そのため既存の実diff
  classifierが、未宣言の新規file競合へ正本経路として配線されていない。
- `undeclared_write`はADR 0144ですでに「予測超過であって競合ではない」と裁定済みだが、単独警報、
  finding生成、旧engineのfreeze、schema enum、回帰testが残っている。
- `creates`はwitness draft v2、witness set／run request／boundary manifest v3、front end、scaffold、
  seam successor検証、help診断へ伝播している。案内だけ消しても制限は残る。

関連実装:

- `src/runtime-decision-verifier.mjs` (`classifyObservedDiff`)
- `src/runtime-diff-observer.mjs` (`captureWorktreeDiff`, `detectCheckpointFindings`)
- `src/runtime-io-sentinel.mjs`
- `src/runtime-cli.mjs` (`finding_record` producer／verifier照合)
- `src/witness-scaffold.mjs`
- `src/runtime-front-end.mjs`
- `src/runtime-contracts.mjs`
- `src/todo-independence-contracts.mjs`
- `src/runtime-seam-resolve.mjs`

## 到達設計

### 計画時

- `owns`／`writes`は既知の構造境界と既知の競合を表す予測だけとする。空でもよい。
- 新規fileだけを作るToDoは、pathを1件も宣言せずにscaffold／independence compile／dispatchできる。
- absent pathをsensor queryへ作らず、`path_absent`、`creates_unverified`、
  `path_absent_declare_creates`の解消を作業開始条件にしない。
- 「静的に完全独立」とは主張しない。並列groupの根拠は「既知境界に競合なし＋runtime実変更観測あり」
  として投影し、runtime guardを含むschedulability judgementであることを公開契約へ明記する。

### 実行時

- sentinelはfile eventの帰属（ToDo別worktree）とpathだけを引き金にし、packetの予測writeを読まない。
- 警報時はactive worktreeを既存`captureWorktreeDiff`でprobeし、既存の実path集約規則でwritersを決める。
- 2者以上のcheckpointに同じpathが残った場合だけ、両checkpoint digestへ束縛した
  `observed_write_conflict` candidateを作る。
- fs eventを取りこぼした場合も、terminal receipt受入前のcheckpoint集合から同じ実path集約を再計算し、
  競合を受理より先に検出する。sentinel無効時に失われるのは早期性だけとする。
- 予測外write単独では何も発行しない。`io_undeclared_write_warning`と`undeclared_write`の新規生成を止める。
- 実競合後のfreeze／hold／seam又はintentional serial／recompile／resumeは既存経路を使う。

### 成果検証

- 実checkpointから得た変更pathを、受入時のaffected test選択とfresh sensor再収載へ渡す。
- これは編集許可ではなく完成成果へのgateである。作業中のfile選択を制限せず、予測との差も採点しない。

## 契約移行

- 最新writer契約をversion upし、`creates`を出力schemaから除く。旧witness set／run request／
  boundary manifestの`creates`は読取互換だけ残し、予測pathとして正規化する。
- 最新witness draftは`owns`の省略又は空配列を受理し、創作専用object形を持たない。
- 最新executor packetはwrite allowlistに見える`scope.writes`を公開せず、必要なら計画情報を
  `predicted_writes`として明示する。runtime conflict判定はこの欄を入力にしない。
- 最新runtime findingは実変更の2者以上だけを生成対象にする。旧`undeclared_write`／
  `io_undeclared_write_warning`は過去eventとartifactのreplay用readerだけに残す。
- 旧runのdigestとevent chainは書き換えない。legacy bundleはlegacy規則で再生し、新epochから新規則へ
  cut overしたことをversioned artifactに記録する。

## 非目標

- 新規file名をAIに推定させること。
- 予測外writeを警告、評価、違反履歴として残すこと。
- I/O sentinelと別の競合監視系を新設すること。
- path非交差のsemantic／state／external effect判定を今回まとめて変更すること。
- symlink、submodule、special file、HEAD非子孫化、外部effectなど、file選択とは別の安全契約を変更すること。

## 受入ゲート

- [ ] `owe-01-planning-characterization`: 現行の計画契約と創作境界の挙動をcharacterization testで固定する
- [ ] `owe-01-runtime-characterization`: 現行の実diff観測と実path集約をcharacterization testで固定する
- [ ] `owe-02-planning-contract`: `creates`と事前path必須を最新の計画契約・scaffold・projectionから除く
- [ ] `owe-03-runtime-wiring`: sentinel、checkpoint producer、finding再導出を実checkpoint同士へ一本化する
- [ ] `owe-04-versioned-cutover`: packet／finding／legacy readerをversionedにcut overし、旧記録のreplayを保つ
- [ ] `owe-05-result-verification`: 実変更pathから受入testとfresh sensor証拠を組み、編集自由と検証を分離する
- [ ] `owe-06-integration-dogfood`: 未宣言の新規・既存fileを含む実run、sentinel off、衝突・非衝突を実証する
- [ ] `owe-07-delivery`: 契約、help、CHANGELOG、version、公開物を揃え、承認後にrelease／install smokeまで届ける

## 受入シナリオ

1. **新規fileだけ・非衝突:** 2 ToDoがpath未宣言のまま異なる新規fileを作り、警報もfindingもfreezeも無く完了する。
2. **新規file同士・衝突:** 2 ToDoが偶然同じ未宣言pathを作り、双方の実checkpointを根拠に
   `observed_write_conflict`が1件だけ生成され、既存hold経路へ入る。
3. **既存file・予測超過・非衝突:** 1 ToDoが予測に無い既存fileを変更しても、単独の警報・finding・freezeを出さない。
4. **既存file・実衝突:** 2 ToDoが予測に無い同じ既存fileを変更すると、宣言scopeを使わず実checkpointだけで競合になる。
5. **取りこぼし耐性:** sentinelをoffにしても、terminal receipt受入前のcheckpoint再計算で同じ競合を検出する。
6. **変更種別:** added／modified／deleted／rename分解後の同一pathが同じ規則で競合になる。
7. **旧記録:** `creates`、`undeclared_write`、旧packetを含む保存済みartifact／event chainが改変なしで再生できる。
8. **公開面:** CLI help、schema出力、MCP案内に`creates`や宣言scope違反の操作を要求する文言が残らない。

## 検証方針

- safety netを先に置き、production変更より前に現行のactual-actual classifierを固定する。
- 実装中は契約、sentinel、finding、scaffoldごとのfocused testだけを回す。
- 統合gateで、ToDo別実worktree・実`fs.watch`・実checkpoint・managed holdを使う。
- Phase完了時に関連testと`npm run ci`を1回だけ通し、保存artifactのreplayと公開CLI smokeを確認する。

## 実行上の停止点

- `owe-01`から`owe-06`はrepo内実装・検証。計画承認後に開始できる。
- push、npm publish、利用環境install、daemon再起動は`owe-07`のH操作であり、実行直前に明示承認を取る。
