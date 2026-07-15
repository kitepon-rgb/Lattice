# Lattice 実装計画

- 状態: Active
- 更新日: 2026-07-15
- 現在のplan version: `lattice-research-campaign-1-v2`
- predecessor: `lattice-bootstrap-v1`（[archive](archive/2026-07-15-plan-lattice-bootstrap-v1.md)、SHA-256 `78c07232cd2ede13dbd88bce02aa03b3591acc9ca1e39c21f7861398fc203a3b`）
- Decision: [ADR 0002](adr/0002-research-campaign-1-closed-loop.md)
- Control lifecycle correction: [ADR 0004](adr/0004-rc1-control-admission-correction.md)
- Native execution verification: [ADR 0005](adr/0005-rc1-native-execution-verification.md)
- 製品思想: [../PLAN.md](../PLAN.md)
- 公開契約: [00_product-contract.md](00_product-contract.md)

## Plan version diff

`lattice-bootstrap-v1`のWave 1〜4を機能完成順に直列実行するtopologyを失効する。Research Campaign 1（RC1）は、
境界観測、typed conflict／verdict、seam変換、同一query setでの再index、plan version再compile、control比較を
一本の閉ループとして実装する。Observer fixtureは後続へ移し、最初の実証はLattice所有fixtureだけで行う。

Wave 0のaccepted artifact（commits `3cbdbcb`、`05cb290`、green baseline、Codegraph index、Spotter設定）は
predecessorとして再利用する。旧planの未着手TODO、旧agent context、旧Control、旧interface仮定はRC1へ持ち越さない。

## Research Campaign 1

### 目的と仮説

- **核心仮説:** 同じTODO outcome、manual state／effect evidence、query set、capacity、verifierを固定し、
  挙動不変seam変換だけを加えると、同一boundaryを争う2 TODOのwrite conflictを除去し、minimum feasible wavesを
  2から1へ減らせる。accepted transformをpredecessorにした新plan versionへ全候補を再compileできる。
- **対立仮説:** (a) conflictはsemantic／state／effect上切断不能、(b)改善はquery／input driftによる交絡、
  (c)behaviorまたはversion barrierが成立せずplanをacceptできない、のいずれかである。
- **control condition:** monolithic fixtureのままboundary／planをcompileし、transformしない。
- **treatment condition:** 同じfixture artifactからdisposable worktreeを作り、accepted seam変換後に再index／recompileする。
- **independent variable:** accepted seam transformation artifactの有無。code snapshot由来のgraph evidence以外は固定する。

研究fixtureは単一`buildDispatchRecord` symbolがchannel選択とlabel整形を所有し、将来TODO
`channel-policy`／`label-policy`が同じsymbol／pathをwriteする。変換後は両責務を別symbol／別moduleへ抽出する。
通常manual evidenceはpure／shared stateなし／external effectなしとし、negative controlだけ両TODOへ同一
`dispatch-registry` state writeを与える。

### 測定指標

| 指標 | control | treatmentで期待する差 |
|---|---:|---:|
| typed verdict | `seam_candidate` | `parallel_ready` |
| write conflict edge | 1 | 0 |
| hard precedence edge | 0 | 0（偽edgeを増やさない） |
| capacity 2でのminimum feasible waves | 2 | 1 |
| behavior gate | green | 同じmatrixでgreen |
| negative control | shared-state conflict | shared-state conflictを保持 |
| query-set digest | 固定値 | 同一値 |
| unresolved／unknown | typedに列挙 | 増減と理由を列挙。0へ丸めない |
| version barrier | なし | old plan／context／patch／assumptionの失効一覧あり |
| intervention cost | 0 | diff、gate、review、reindex、recompile実測を記録 |

actual wall-clock、tool時間、review、rework、rollbackも記録するが、単一の小型fixtureから一般的な速度改善率は主張しない。

### 成功条件

1. controlとtreatmentが同一TODO input、manual evidence、query set、capacity、verifierを消費し、digestで一致を証明する。
2. controlはwrite conflictを根拠に`seam_candidate`を返し、空結果やCLI failureを依存なしへ丸めない。
3. transformはdisposable worktree内に限定され、characterization greenのartifactだけが再indexへ進む。
4. treatmentはwrite conflictを0にし、hard dependencyやunknownを隠さず、minimum feasible wavesを1にする。
5. negative controlはpath分離後もshared-state conflictを保持し、false `parallel_ready`を拒む。
6. canonical serializationとdigestは同一入力からbyte-identicalに再生成できる。
7. `lattice.plan_diff.v1`はaccepted transform artifact、node／edge差分、失効contextを持ち、新plan versionを生成する。

### 反証・設計変更条件

- TODO、manual evidence、query set、capacity、verifierのいずれかが条件間でdriftした場合は非識別実験として棄却し、固定後に再実行する。
- characterization／negative controlが失敗したtransformはrejectし、構造差分が良くてもrecompileへ採用しない。
- 同じquery setでshared boundaryが残る、または新しいsemantic／state／effect conflictが現れた場合はH1を反証し、
  seam候補またはboundary modelを変更する。
- negative controlが`parallel_ready`になった場合はpath-only判定の実コード欠陥としてPhaseを止める。
- Codegraph index absent／stale／unsupported／unresolved／CLI failureはtyped failureとし、公開面不足なら
  upstream寄与または正式所有forkのDecisionへ送る。manualな安全推測で埋めない。
- canonical worktree、Lattice外repo、external serviceへwriteした場合は隔離契約違反としてartifactをrejectし、原因を修正する。
- plan versionは番号だけ変えず、accepted predecessorとinvalidationを証明できなければversion barrier設計を変更する。

## Hard dependency graphと並列lane

```text
RC1-P plan/ADR accepted
  └─ RC1-S fixture + characterization safety net
       ├─ RC1-A artifact contract lane ────┐
       ├─ RC1-B Codegraph sensor lane ─────┴─ RC1-D control boundary/plan compile ─┐
       └─ RC1-C isolation/verifier lane ───────────────────────────────────────────┴─ RC1-E treatment transform
                                                                                         └─ RC1-F reindex/recompile/compare
                                                                                                └─ RC1-G Phase audit/evidence return
```

| node | hard needs + witness | lane／effect | produces | gate |
|---|---|---|---|---|
| RC1-P | bootstrap-v1 accepted artifacts | F: 親直轄／docs write | ADR 0002、plan v2、baseline | docs diff＋親反証＋独立commit |
| RC1-S | RC1-P: fixture／実験契約 | A: safety-net／Lattice source write | monolith fixture、characterization、fixed input | Codegraph preflight＋focused test |
| RC1-A | RC1-S: fixed examples | F: 親直轄／公開artifact byte contract | strict schemas、canonicalizer、digest | invalid／oversize／path escape test |
| RC1-B | RC1-S: fixed query targets | A: sensor／read-only subprocess | status/query/caller/callee/impact/affected evidence | failure／empty／stale typed test |
| RC1-C | RC1-S: behavior matrix | A: isolation／temp worktree write | bounded transform runner、verifier、rollback evidence | canonical worktree不変＋focused integration |
| RC1-D | RC1-A＋RC1-B: schemaとgraph evidence | F: verdict契約／Lattice artifact write | control manifest、typed conflict/verdict、plan v1 | control success条件1〜2 |
| RC1-E | RC1-C＋RC1-D: verifierと`seam_candidate` | F: 介入acceptance／isolated write | accepted／rejected transform artifact | behavior＋scope＋negative control |
| RC1-F | RC1-E: accepted artifact | F: version barrier／artifact write | post manifest、plan v2、plan diff、comparison | success条件4〜7 |
| RC1-G | RC1-F: 全artifactとrelated green | A: read-only Phase監査 | refutation、Critic、親裁定、RAG／docs還流 | full `npm run ci` 1回 |

RC1-A／B／Cは書込scopeを非交差に固定して並列化できる。RC1-D以降は因果順を識別するため直列であり、
ready幅を増やす目的でhard dependencyを削らない。

## TODO

### RC1-P — 計画versionを固定する

- [x] 旧Control revision 6の`worker_runs`、`consultations`、`campaigns`、dispatchが全て0と確認し、指定範囲だけ整理する。
- [x] 同一HEADでfull baselineを再確認し、[evidence](evidence/2026-07-15-research-campaign-1-baseline-v2.md)へ固定する。
- [x] 旧planをdigest一致でarchiveし、ADR 0002と`lattice-research-campaign-1-v2`を正本化する。
- [x] [親反証](evidence/2026-07-15-research-campaign-1-plan-refutation.md)とdocs link／digest検証を行う。
- [x] plan更新だけを独立commitする。

### RC1-S — characterization safety netを先行する

Accepted Decision: [ADR 0003](adr/0003-rc1-safety-net-accepted.md)

- [x] source編集前にCodegraphで既存test入口、planned owned path／symbol、caller／callee、impact、affected testを確認し、
  symbol不在を`new_surface_unknown`としてmanual boundary evidenceへ残す。
- [x] Lattice内へmonolithic dispatch fixtureと、現挙動を固定するinput／output／error matrixを追加する。
- [x] 通常manual state／effect evidence、shared-state negative control、固定query setをversioned inputとして追加する。
- [x] focused characterizationを1回greenにし、fixture baselineを独立commitする。

### RC1-A／B／C — 閉ループの三laneを実装する

Source boundary／dispatch contract: [RC1 implementation boundaries](evidence/2026-07-15-rc1-implementation-boundaries.md)

- [x] Control `lattice-rc1-closed-loop-v2`のplacement dry-runで`budget-unknown`と
  `verification-insufficient`を検出し、実作業をdispatchせず[ADR 0004](adr/0004-rc1-control-admission-correction.md)へ
  訂正条件を固定する。
- [x] v2 Controlを[administrative closure evidence](evidence/2026-07-15-rc1-control-v2-administrative-closure.md)で
  archiveし、known cost envelopeを持つcontinuation Controlを初期化する。
- [x] continuation Control内のread-only native Taskを完遂・回収・acceptし、そのevidenceで入口を
  `execution-verified`へ昇格してからRC1-B／RC1-Cを配置する。

Accepted Decision: [ADR 0006](adr/0006-rc1-foundation-contracts-accepted.md)。
[受入証拠](evidence/2026-07-15-rc1-foundation-acceptance.md)はControl receipt、focused gate、実Codegraph post-indexを固定する。

- [x] **RC1-A（F・親直轄）:** `plan_input.v1`、`boundary_manifest.v1`、`boundary_verdict.v1`、`plan_graph.v1`、`plan_diff.v1`の
  RC1必要subsetをexact key、bounded collection、canonical serialization、digest付きで実装する。
- [x] **RC1-B:** Codegraph 1.4.1の公開CLIからstatus、query、caller／callee、impact、affected testを収集し、
  absent／empty／stale／unsupported／unresolved／failureを区別するadapterを実装する。
  `callers`／`callees`／`impact`は未存在symbolに`--json`を指定してもexit 0の非JSON textを返す実測があるため、
  exit codeだけでなくstdoutのJSON parseとtyped absenceを検証する。
- [x] **RC1-C:** disposable worktree、bounded write scope、characterization verifier、diff artifact、rollback／cleanupを実装する。

### RC1-D／E／F — controlとtreatmentを閉じる

- [ ] **RC1-D:** original fixtureからboundary manifest、typed conflict／verdict、control plan v1をcompileする。
  [ADR 0007](adr/0007-manual-evidence-provenance-in-boundary-manifest.md)に従い、同じnode内でmanual evidence個別provenanceを
  manifestへ補完する。normalはwrite conflict 1＋`seam_candidate`＋2 wave、shared-state negativeはstate conflictを保持して
  `intentional_serial`とし、[実装契約](evidence/2026-07-15-rc1-control-compiler-contract.md)をgateにする。
- [ ] **RC1-E:** `seam_candidate`からchannel／label extractionをisolated worktreeで実行し、accept／rejectを証拠化する。
- [ ] **RC1-F:** 同じquery setで再indexし、post manifest、new plan v2、plan diff、control／treatment比較を生成する。
- [ ] canonical artifactを再生成してdigest一致を確認し、unknown、intervention cost、未検証範囲を報告する。

### RC1-G — Phase gate

- [ ] TODO単位の軽量監査を各完了候補で一回だけ行い、diff、受入条件、related test、手補正の有無を確認する。
- [ ] 全TODO収束後にfull `npm run ci`を一回実行する。
- [ ] Find→Dedup→独立反証→Critic→親裁定のPhase監査を一回行い、件数遷移と棄却理由を残す。
- [ ] 成功／反証結果を`docs/evidence/`へ、再利用可能な実測・外部仕様を`rag/`へ還流する。
- [ ] 完了したplanを`docs/archive/`へ退避し、次plan versionを正本化する。

## Evidence artifact

RC1は少なくとも次をLattice内に保存する。

- fixed plan input、manual state／effect evidence、negative control、query-set digest。
- pre／post Codegraph status、symbol、caller／callee、impact、affected testのraw取得結果とtyped interpretation。
- control／treatmentのboundary manifest、verdict、plan graph、canonical digest。
- transform patch、bounded scope、characterization結果、reject時の失敗理由、cleanup結果。
- `plan_diff.v1`、失効context一覧、minimum feasible wavesとconflict edgeの比較。
- actual wall-clock、tool時間、review、rework、rollbackを含む介入費と、一般化しない範囲。

accepted machine artifactは`research/campaigns/rc1/`、人が読むgate／比較／監査は`docs/evidence/`を正本とする。
一時worktreeとCodegraph DBは端末ローカルであり、証拠へ絶対pathや秘密を混入させない。

## Non-goalsとwriter境界

- RC1では任意repo向けgoal decomposition、汎用refactor探索、最適scheduler、actual multi-agent dispatchを完成させない。
- 一回のfixture結果から一般的速度改善率、製品価値、法的新規性、freedom-to-operateを主張しない。
- read-only推薦器へ製品scopeを縮小しない一方、failed transformを成功へ丸めない。
- Observerをfixtureにせず、Observer関連repoを編集しない。Observer dogfoodはRC1成功とPhase監査をhard dependencyにする。
- `/Users/kite/Developer/dotagents`はread-only参照のみ。orchestration Controlのproduct-owned stateはLatticeの`.git/`配下、
  RC1 artifactはLattice repo内に置き、dotagents本体、Throughline、他repoのhook／stateへ便乗しない。
- remote作成、push、publish、credential／login、production／external effectは行わない。

## 後続backlog（RC1の完了条件へ混ぜない）

- 複数fixtureと実repoでsemantic conflict予測、未知seam生成、介入費の外的妥当性を反復する。
- Observer dogfoodで現行手動DAGと比較し、actual wall-clock、review、rework、merge、rollbackを測る。
- 公開CLI／schemaを安定化した後だけdotagents adapter、BugHub、installer、compatibility、rollbackを工場統合する。
