# RC2 artifact v4／plan v5 Phase反証

- 観測日: 2026-07-16
- 対象source commit: `fe75df08d469375703b183ec252955f2854774e7`
- 対象artifact commit: `bf4ba1d4d446ce89d571c05dd5981c49ed90f923`
- 最終gate HEAD: `dc14a473575795ee4e13911faf52710c3b6a1d10`
- canonical artifact: `research/campaigns/rc2/artifacts/v4`
- 対象Control Task: `RC2-H3-v4-phase-refutation-v1`
- Decision: [ADR 0043](../adr/0043-rc2-v4-phase-gate-support.md)

## 裁定

H1-RC2を、Lattice内の3-TODO delivery-policy registry fixture、manual ownership witness、cooperative isolated-worktree threat modelの
範囲でsupportする。RC2成功条件25件をsource、canonical payload、既存related／full receiptから反対仮説で再検証し、Phase受入を塞ぐ
P0／P1 findingは0件だった。

これはactual multi-agent wall-clock改善、requirementsからのownership自動発見、任意repoまたは別seam classへの一般化、署名・remote
attestationをsupportする裁定ではない。

## 反証方法と独立性

Controlはworker 8／8、consultation 2／2で上限に達しているため、追加worker、相談、sidecarを使わず親がread-onlyで再検証した。
したがって別実行者による独立監査済みとは主張しない。採否基準は実コードで再現する欠陥、論理矛盾、非識別な実験設計、一次証拠の誤り、
実験による反証、具体的な安全事故経路だけに限定した。

related／full test、campaign、canonical writerは再実行していない。既存のrelated 40／40、最初のfull 173／174、補正focused 1／1、
最終full 174／174のreceiptを使った。最初のfull失敗はaffected-set期待集合の更新漏れとして保持し、greenへ丸めていない。

read-only digest照合の最初の試行はzshの連動変数`path`をループ変数に使ったため実行PATHを失い、結果を無効として棄却した。
変数名を修正しmacOS正規の`shasum -a 256`で再実行した結果だけを以下の証拠に採用した。repoとartifactへの変更は0だった。

## 保存集合の整合性

| 検査 | 実測 |
|---|---|
| manifest SHA-256 | `3919276bdb98676259195f4fda709eba37dffc3632479f729d2c4be1a10186b6` |
| manifest path集合対disk | 一致 |
| manifest entries／disk files | 79／80（manifestを含む） |
| payload SHA-256不一致 | 0／79 |
| causal predecessors | 39、unique ref 39、unique kind/ref/digest 39 |
| invalidated contexts | 5 |
| plan SHA-256 | `cbb9be9b0db4168396de12d9db1e041362b2e4da7200d38307da897512b2093b` |

active witnessはv1／v2の`delivery-policy-legacy-v1`とv3／v4の`delivery-policy-semantic-v2`へversion別に分離される。
v4 candidate digestは`4cc5d7bb428a8899353d18524c25105742fa90f89ee55d36064c4be3c52e2907`、oracle source digestは
`c68a7ff9a7c9c4a181ceda6396d5fcbf27084de18680018d244a27998041652c`。accepted／rejected transform source base、6 fresh run、
manifest baseはすべて`fe75df08d469375703b183ec252955f2854774e7`へ一致した。

## Queryと構造metrics

primary 4 runは同じquery-set digest
`d2b65e0d2d4cf3f93ea83f7482a8eb7eb112d575ca116f36be7b11c7adf09e5e`とCodegraph identityを使う。

| condition | repeat | queries | ready | symbol absent | unresolved | portable aggregate digest |
|---|---:|---:|---:|---:|---:|---|
| control | 2 | 41 | 12 | 28 | 1 | `6148435622168f7b8f55a0aa79574983546bb30ca9e4e9cb1d28295cfefd2066` |
| treatment | 2 | 41 | 41 | 0 | 0 | `3a6672b5dfe478f5ff751da25ab47b8b75add2f144ca903fb350f8ab0e0a320f` |

各repeat内のaggregate digestは一致した。controlのabsent／unresolvedをindependenceへ丸めず、現monolith面としてK3へcompileした。
treatmentはaccepted patch後の3 resolver、3 dedicated tests、composition entry／testをexact解決した。

| condition | conflict records | distinct pairs | minimum waves |
|---|---:|---:|---:|
| primary control | 12 | 3 | 3 |
| primary treatment | 0 | 0 | 1 |
| partial-state negative | 1 | 1 | 2 |
| capacity 2 | 0 | 0 | 2 |
| RC1 transfer control normal | 3 | 1 | 2 |
| RC1 transfer treatment normal | 0 | 0 | 1 |
| RC1 transfer control negative | 4 | 1 | 2 |
| RC1 transfer treatment negative | 1 | 1 | 2 |

## 25成功条件の再検証

| # | 結果 | 反対仮説からの確認 |
|---:|---|---|
| 1 | pass | RC1 v6 artifact／archive／source入口は変更せず、最終fullでcanonical v6 disk replay 12／12を維持した。 |
| 2 | pass | v2 contractは1〜8 TODO、pairwise verdict、typed precedence／conflict／unknownをbounded検証し、9 TODOをunsupportedにする。 |
| 3 | pass | normalized coreはcandidate ID、fixture／repo path、oracle、adapter、期待waveを入力に持たず、保存compiler bytesも同一である。 |
| 4 | pass | 保存bundleの全resourceは`codegraph`／`manual_candidate_spec`／`manual_state_effect` provenanceを持ち、missing／empty／unresolvedをtypedに保持する。 |
| 5 | pass | candidate digestはmanual witness provenanceとしてresourceへ保存され、自動ownership発見のmachine claimを出していない。 |
| 6 | pass | producer planはdeterministicで、全compiled conditionが独立enumeratorの`verified` minimumを持つ。 |
| 7 | pass | conflictは同wave排他、hard needはstrict orderingとして別検査され、A-B-C pathは2 wavesを維持する。 |
| 8 | pass | K3、empty、single edge＋isolated、capacity-only、hard need＋conflictの期待minimumは最終fullでgreen。 |
| 9 | pass | TODO permutationとID／resource renameのmetamorphic testは同型結果を維持する。 |
| 10 | pass | third-only unknownはplanなし、9 TODOとbudget exhaustionはtyped unsupportedである。 |
| 11 | pass | primary controlは12 records／3 pairs／3 wavesを2 repeatで再現した。 |
| 12 | pass | adapterはcandidate、adapter、base、allowed path、oracleへbindされ、patchは11,307 bytes。condition／conflict／期待wave注入fieldはない。 |
| 13 | pass | trusted current oracleの6 casesを唯一の期待値正本とし、candidate、snapshot、保存source、pre／post case-setへcross-bindした。 |
| 14 | pass | accepted transformは8 exact pathsだけを変更し、pre／post oracle一致、source unchanged、cleanup passedを保持する。 |
| 15 | pass | mutation evidenceは6 rows／24 cells、owner failure 6／non-owner pass 18で、restore／matrix／evidence digestを再計算する。 |
| 16 | pass | treatmentは0 records／0 pairs／hidden unknown 0／capacity 3で1 waveを2 repeatした。 |
| 17 | pass | partial-state negativeは1 conflict／2 wavesで、第三TODOを別TODOとco-scheduleする。 |
| 18 | pass | 同じempty treatment graphのcapacity 2は2 wavesである。 |
| 19 | pass | incompleteとscope violationは別typed rejection、output `null`。third-only unknownもaccepted artifact／planを持たない。 |
| 20 | pass | primaryとRC1 transferは同じ保存core source digestを使い、candidate contractはcondition selectorを禁止する。 |
| 21 | pass | primary 2＋2とRC1 transfer 1＋1は全件`fresh_index=true`、別isolation、同一base／Codegraph identity、condition内再現digestを持つ。 |
| 22 | pass | plan v5はv3 artifact内plan v4をpredecessorに39 causal predecessorsをexactly once持ち、3 TODO全件と5 contextを新refへbarrierした。 |
| 23 | pass | artifact-only verifierは15 checksでtransform semantics、raw evidence、compile、minimum、predecessor、plan、cost、comparison、hypothesis、executionを再計算する。 |
| 24 | pass | costは50 measured stages／49,096.801 ms、not measured 0、rejected 2／retry 0／rollback 0を保存する。 |
| 25 | pass | related 40／40、最終full 174／174、静的check成功。今回のPhase再検証で生き残るP0／P1 findingは0。 |

## 対立仮説の裁定

| 対立仮説 | 裁定 |
|---|---|
| H0-a fixture特判 | core入力と保存source identity、metamorphic／transfer条件にfixture selectorがなく、反証された。 |
| H0-b conflict／minimumの自己申告 | independent enumerator、path graph、capacity、precedence負例により反証された。 |
| H0-c manual witnessを自動発見と誤認 | artifact provenanceとDecisionがmanual claimへ限定するため、support claimには混入しない。 |
| H0-d 挙動変化または不完全変換の誤受理 | fixed oracle、exact mutation matrix、typed rejection、scope／cleanupにより反証された。 |
| H0-e unknown／state／capacityのsafe default | third-only unknown、partial-state、capacity-onlyが別結果を持つため反証された。 |
| H0-f RC1互換破壊 | v6 replay 12／12とtransfer metricsにより反証された。 |
| H0-g aggregate costだけ | 50 stageを分離し、reworkも保存しているため反証された。 |
| 旧epochの世代不整合 | version別witness pairとbase cross-bindingにより`transform_binding`でrejectされ、v1〜v4 replayは維持された。 |

## Findingsと保存集合

- P0／P1 finding: 0。
- P2／P3 maintenance finding: 0。
- 保存する既知の負例: v2 semantic substitution、v3旧epoch再包装、最初のfull 173／174。いずれも履歴を消さずcorrected successorから参照する。
- immutable successor: canonical artifact v4、plan v5、ADR 0043。
- 旧plan、agent context、partial patch、interface assumption、boundary evidenceは失効済みで、再利用しない。

dotagents／Observer関連repo write、remote作成、push、publishは0。campaign再実行とcanonical artifact v4再生成も0。
