# Lattice 実装計画

- 状態: Superseded — Phase gate rejected
- 更新日: 2026-07-16
- 現在のplan version: `lattice-research-campaign-1-v5`
- Phase gate outcome: `rejected_for_oracle_snapshot_and_predecessor_identifiability`（mechanism evidenceは保持）
- predecessor: `lattice-research-campaign-1-v4`（[Phase-rejected archive](2026-07-15-plan-lattice-research-campaign-1-v4-phase-rejected.md)、SHA-256 `831485b08de5ecc6624b7b1ed2175dce931dd480b5cfe247911499ae029d5fa2`）
- v5 Phase gate rejection: [ADR 0028](../adr/0028-rc1-v5-phase-gate-rejection.md)
- v4 Phase gate Decision: [ADR 0022](../adr/0022-rc1-v4-phase-gate-rejection.md)
- v5 behavior evidence contract: [ADR 0023](../adr/0023-rc1-v5-behavior-evidence-contract.md)
- v5 behavior envelope acceptance: [ADR 0024](../adr/0024-rc1-v5-behavior-envelope-accepted.md)
- v5 oracle observation acceptance: [ADR 0025](../adr/0025-rc1-v5-oracle-observation-accepted.md)
- v5 transform／campaign integration acceptance: [ADR 0026](../adr/0026-rc1-v5-transform-campaign-integration-accepted.md)
- v5 immutable closed loop acceptance: [ADR 0027](../adr/0027-rc1-v5-immutable-closed-loop-accepted.md)
- v4 corrected closed loop record: [ADR 0021](../adr/0021-rc1-v4-corrected-closed-loop.md)
- RC1 root Decision: [ADR 0002](../adr/0002-research-campaign-1-closed-loop.md)
- 製品思想: [../../PLAN.md](../../PLAN.md)
- 公開契約: [00_product-contract.md](../00_product-contract.md)

## Plan version diff

v4はsingle boundary compiler、production＋test seam、control／treatment各2 fresh Codegraph run、negative state、
portable preimage、source invariant、plan version barrierを接続し、境界観測→隔離変換→再index→再compileの閉ループを実行した。
実測はcontrolのwrite conflict 3／test-write conflict 1／2 wavesからtreatmentの0／0／1 waveへ変化した。

一方、Phase gateは保存behavior evidenceの非識別を再現した。実装はpre／post oracleを実行するが、full receiptを保存せず、
receipt preimageに観測role、base SHA、entrypoint content digest、code snapshot identityがない。保存pre／post digestは同じで、
postをpreへ再利用した世界も15／15のmachine predicateを通る。

v5はv4 topologyへ追記しない。v4のmachine support、comparison behavior claim、agent context、partial patch、
interface assumptionをactive predecessorから失効する。single compiler、accepted production＋test seam、full Codegraph preimage、
source invariant、version barrierはhistorical mechanism evidenceとして引き継ぎ、behavior observationだけをsnapshot-boundな
versioned artifactへ作り直す。v4 artifactは上書きせず、全conditionをimmutableなv5 artifactへ再発行する。

Observer fixtureとdotagents統合は引き続き後続であり、v5の内的妥当性を外部dogfoodで埋めない。

## Research Campaign 1 v5 correction

### 核心仮説と対立仮説

- **核心仮説 H1-v5:** 同じbase、boundary compiler、candidate spec、TODO outcome、manual state／effect evidence、query set、
  capacity、black-box oracleへ、accepted production＋test seamだけを独立変数として加えると、外部挙動を保ったまま全shared writeを
  除去し、hard precedenceを増やさずminimum feasible wavesを2から1へ減らせる。この因果鎖は、full pre／post receiptを
  exact code snapshotとpatchへbindしたartifactだけから再計算できる。
- **対立仮説 H0-a:** production、test、schema、state、effect、semantic resourceのいずれかがseam後も共有され、1 waveにならない。
- **対立仮説 H0-b:** conflict減少はcondition別compiler、candidate／query drift、missing evidenceのsafe defaultによる測定器artifactである。
- **対立仮説 H0-c:** transformがblack-box behaviorを変える、またはtransform対象testがoracleを自己正当化する。
- **対立仮説 H0-d:** portable Codegraph outcomeまたはartifact digest chainを保存preimageから再計算できない。
- **対立仮説 H0-e:** post oracle receiptがpre receiptの再利用、別base、別snapshot、別patchに属してもmachine predicateがsupportを返す。

### Experimental conditions

- **control condition:** monolithic production symbolとpolicy-specific shared test expectationを変換せず、fixed query setで2回fresh
  indexし、single boundary compilerへ入力する。behaviorのpre receiptはbase SHAと変換前fixed surfaceへbindする。
- **treatment condition:** 同じbaseへaccepted production＋test seam patchだけを加えたdisposable worktreeを、同じquery set、
  compiler、manual evidence、capacity、oracleで2回fresh index／compileする。behaviorのpost receiptはexact transformed surface、
  transform artifact、accepted patchへbindする。
- **independent variable:** accepted seam transformation artifactの有無。compiler identity、candidate spec、TODO outcome、
  manual evidence、query set、capacity、oracle、Codegraph versionは条件間で固定する。
- **negative control:** normalと同じsnapshot／compilerへ両TODOのshared `dispatch-registry` state writeを与え、pathとtestを
  分離してもserialを保持する。
- **corruption controls:** post→pre receipt差替え、role、base、entrypoint content、surface snapshot、patch、transform digest、
  manifest payloadを一項目ずつ壊し、すべてsupportをrejectする。

fixed behavior surfaceはaccepted transformの全allowed pathを、`present | absent`、content digest付きで同じ順序へ正規化する。
各oracle receiptは実行直前と直後のsurface snapshot一致を要求し、観測中のdriftをacceptedへ丸めない。

### 測定指標

| 指標 | control | treatment success |
|---|---|---|
| boundary compiler identity | fixed digest | 同一digest |
| production write overlap | 実測 | 0 |
| test／schema／artifact write overlap | 実測・省略禁止 | 0 |
| total write conflict records | 実測 | 0 |
| hard precedence | 実測 | 増加なし |
| minimum feasible waves（capacity 2） | 2以上を実測 | 1 |
| unknown | graph／manual provenance付き | hidden unknown 0 |
| behavior outcome | full pre receipt green | full post receipt green |
| receipt role／base | `pre`＋base SHA | `post`＋同じbase SHA |
| entrypoint content binding | pre surfaceと一致 | transform output surfaceと一致 |
| surface snapshot binding | full typed preimage＋digest | full typed preimage＋digest |
| patch／transform binding | control predecessor | accepted patch／artifact digest一致 |
| negative shared state | serial | serial |
| portable Codegraph evidence | 2 run full preimage | 2 run full preimage |
| artifact-only predicate | underlying artifactから再計算 | corruption全reject |
| source invariant | typed protected scope receipt | drift 0 |

actual wall-clock、index／query、compile、review、rework、rollbackも記録する。v5も単一fixtureであり、任意repoの成功率や
一般的速度改善率は主張しない。

### 成功条件

1. control／treatmentが同じexported boundary compilerと同じfixed inputを使い、condition-specific branchを持たない。
2. compilerはexact graph outcome、manual state／effect、typed unknownから全TODOのwrite intersectionとconflictを導出する。
3. controlはproduction＋test shared boundaryをtyped conflictにし、empty／absent／unresolvedをindependenceへ丸めない。
4. accepted transformはproduction concernとfuture TODO-owned testを分離し、transform scope外の固定oracleがpre／postでgreenになる。
5. treatmentはshared write conflict 0、hidden unknown 0、hard precedence増加なし、minimum feasible waves 1である。
6. shared-state negativeはstate conflictと2 wavesを保持する。
7. control／treatment各2 fresh runのcanonical portable Codegraph payloadを保存し、per-query／aggregate digestを再計算できる。
8. full pre／post oracle receiptを別payloadとして保存し、schema、role、base SHA、oracle digest、entrypoint／export、
   entrypoint content digest、case results、fixed surface preimage／digestをexact検証できる。
9. pre receiptのsurfaceはbase worktreeの変換前snapshot、post receiptのsurfaceはtransform artifactのexact output snapshotと一致する。
10. versioned behavior envelopeはfull receipt digest、transform artifact digest、patch digest、pre／post surface digestをcross-bindする。
11. artifact writerはbehavior payloadをmanifestへ含め、manifestのbyte hashと全cross-artifact relationを独立再計算できる。
12. machine evaluatorはcomparison summaryを信頼せずunderlying artifactから全条件を再計算し、各single-field corruptionをrejectする。
13. new plan diffはv4 machine supportとcontextを失効し、v5 accepted transform、behavior envelope、evidence bundleをpredecessorに持つ。

### 反証・設計変更条件

- pre／postでcompiler、candidate spec、query set、manual evidence、capacity、oracleのいずれかが違えば非識別としてrunをrejectする。
- post receiptをpre receiptへ差し替えてもsupportがtrueなら、evaluatorとbinding schemaをrejectする。
- receiptのentrypoint content digestがsurface内entrypoint digestと一致しない、またはoracle前後snapshotが違えば観測をrejectする。
- post surfaceがtransform artifact output、patch digest、base SHAのいずれかとcross-bindできなければ再index／recompileへ進めない。
- shared test、generated artifact、state／effect conflictが残れば1 waveを主張せず、追加seamまたはjoin TODOへplanを変更する。
- transformed testだけがoracleならbehavior gateをrejectし、transform scope外oracleを先に固定する。
- portable payload欠落、digest不一致、unknown fieldの暗黙drop、manifest外payloadはfail closedにする。
- negative controlがparallelになればboundary compilerをrejectする。
- protected canonical scopeへcontent driftがあればartifactをrejectし、cleanup成功へ丸めない。
- v5実測が1 waveまたはbehavior bindingを支持しなければfixtureを都合よく変えず、H1-v5を反証して次plan versionへ再compileする。

## Hard dependencyと並列研究lane

```text
RC1-M2 v4 Phase reject + v5 plan
  └─ RC1-N behavior-binding characterization safety net
       ├─ RC1-O1 full oracle receipt lane ─────────────┐
       └─ RC1-O2 behavior envelope/evaluator lane ────┴─ RC1-P transform/campaign integration
                                                            └─ RC1-Q immutable v5 reissue
                                                                 └─ RC1-R Phase gate
```

| node | hard dependency | lane／effect | evidence artifact | gate |
|---|---|---|---|---|
| RC1-M2 | v4 related green＋Phase P1 | F: 親直轄／Decision・docs write | ADR 0022、v4 archive、plan v5 | sourceなし独立commit |
| RC1-N | ADR 0022の非識別反例 | F: artifact identity契約／test-first | post→pre差替え等のred characterization | Codegraph preflight＋expected red |
| RC1-O1 | RC1-N fixed receipt schema | F: observation identity／source write | full oracle receipt、surface capture | role／base／pre-post drift corruption |
| RC1-O2 | RC1-N fixed cross-bind schema | F: causal evidence／source write | behavior envelope、artifact-only evaluator | snapshot／patch／manifest corruption |
| RC1-P | RC1-O1＋O2 | F: isolation・campaign integration／source write | v5 transform receipt、writer、plan compiler | exact output relation＋focused green |
| RC1-Q | RC1-P related green | F: experiment execution／artifact write | v5 control／treatment／negative、plan diff | 2 fresh run／condition＋source invariant |
| RC1-R | RC1-Q immutable evidence | A: read-only refuter＋F親裁定 | independent refutation、full CI、Decision | Phase audit 1回 |

RC1-O1とO2はRC1-Nが固定したschemaを変えず、非交差source／test scopeにできる範囲だけ並列研究する。
schema、fixed surface、oracle input、query setの変更は親直轄で新plan versionを要求し、lane内の便宜で書き換えない。

## TODO

### RC1-M2 — v4をrejectしv5へ再compileする

- [x] refuter reportをControlへ回収し、read-scope逸脱のためworker resultをparent rejectする。
- [x] oracle executor、transform、campaign writer、evaluator、v4 artifactからP1を親が独立再現する。
- [x] ADR 0022とPhase evidenceでmachine supportの失効とmechanism evidenceの保持を裁定する。
- [x] v4 planをSHA-256付きPhase-rejected archiveへ固定し、active topologyをv5へ全再compileする。
- [x] plan／ADR／evidence更新だけを独立commitにし、source変更を混ぜない。

### RC1-N — behavior-binding characterizationを先に置く

- [x] source編集前にCodegraphでowned symbol／path、caller／callee、impact、affected test、unknownを再確認する。
- [x] 現v4 artifactへpost→pre receipt差替えを適用しても15／15が維持される最小反例をtestへ固定する。
- [x] full receipt、fixed surface snapshot、behavior envelope、artifact-only evaluatorのexact schemaをtest fixtureで固定する。
- [x] role、base、entrypoint content、surface snapshot、patch、transform digest、manifest payloadを一つずつ壊すtestを赤にする。
- [x] safety-netだけを独立commitする。

### RC1-O1 — full oracle receiptとsurface observation

- [x] oracle receiptへrole、base SHA、entrypoint content digest、full case results、fixed surface preimage／digestを追加する。
- [x] oracle実行直前／直後に同じsurfaceを観測し、content driftをtyped rejectionにする。
- [x] preとpostが同じbehaviorでもrole／surfaceが異なればreceipt identityが異なることを証明する。
- [x] oracle input／executorをtransform write scope外に保ち、scope violationをrejectする。

### RC1-O2 — behavior envelopeとartifact-only evaluator

- [x] pre／post full receipt、transform artifact、patch、surface snapshotをversioned envelopeへcross-bindする。
- [x] comparison summaryを信頼せずunderlying artifactからbehavior条件を再計算するv5 evaluatorを実装する。
- [x] 依存digestを再封印したpost→pre差替えと各single-field corruptionをすべてfalse supportへする。
- [x] manifestに必要behavior payloadが一件でも欠ければartifact setをrejectする。

### RC1-P — v5 transform／campaign integration

- [x] disposable worktree内でpre snapshot＋oracle→transform→post snapshot＋oracleの順序を固定する。
- [x] accepted transformのexact output／patchとbehavior envelopeをbindし、rejected transformから後段artifactを作らない。
- [x] single compiler、production＋test writes、negative state、portable preimage、source invariant、version barrierをv5へ接続する。
- [x] focused gate収束後にrelated testをTODO完了候補で一回だけ実行する。

### RC1-Q — immutable v5 closed loopを再発行する

- [x] v5 controlを2回fresh indexし、same compilerがproduction＋test shared writesを導出する。
- [x] accepted seamだけを加え、同じquery setでv5 treatmentを2回fresh indexする。
- [x] normal／negativeを同じcompilerへ通し、conflict、hard precedence、waves、unknownを比較する。
- [x] full behavior receipt／envelope、Codegraph preimage、compiled artifacts、plan diffを`artifacts/v5`へatomic保存する。
- [x] artifact-only verifierでmanifest byte hashと全cross-bindingを再計算し、corruption suiteをgreenにする。
- [x] v4 causal artifactとcontextのinvalidationを新plan versionへbindする。

### RC1-R — v5 Phase gate

- [x] TODO単位の軽量監査を各完了候補で一回だけ行う。
- [x] source収束後のfull `npm run ci`を一回だけ実行し、3 failureを隠さず記録する。
- [x] behavior evidence P1だけを対象に独立refuterとCriticへ一回再監査する。
- [x] v5をrefuteする不変DecisionとPhase evidenceを残す。
- [x] v5をSHA-256付きPhase-rejected archiveへ固定し、correction plan v6へ全再compileする。

## Evidence artifact

v5は少なくとも次をLattice内へ保存する。

- v4から固定継承するcandidate spec v2、query set v2、TODO outcome、manual state／effect、test-write provenance、oracle input。
- pre／post full behavior receipt、観測role、base SHA、entrypoint content digest、fixed surface typed preimage／digest。
- full receipt、transform artifact、accepted patch、pre／post surfaceを結ぶversioned behavior envelope。
- control／treatment各2 fresh runのcanonical portable Codegraph outcomes、sanitized diagnostic、opaque raw receipt。
- single compiler identity、resolved production／test owns、writes、unknown、conflict derivation trace。
- control／treatment／negativeのmanifest、verdict、plan、comparison、underlying-artifact hypothesis evaluation。
- source invariant、cleanup、v4→v5 plan diff、失効context、intervention時間、review、rework、rollback、未検証範囲。
- corruption caseごとのexpected／actual rejectionとartifact-only verifier receipt。

machine artifactは`research/campaigns/rc1/artifacts/v5`へ新規保存し、v4 artifactを上書きしない。
raw telemetryと絶対pathをplan identityへ入れず、sanitization methodとportable preimageを独立に監査可能にする。

## Non-goalsとwriter境界

- v5では任意repo向けgoal decomposition、汎用seam synthesis、最適scheduler、actual multi-agent dispatchを完成させない。
- 単一fixtureから一般的速度改善率、任意repo成功率、製品価値、新規性、freedom-to-operateを主張しない。
- v4のaccepted mechanismを失敗へ丸めず、behavior causal acceptanceとの境界だけを修正する。
- behavior receiptを署名・remote attestationへ拡張しない。RC1のcooperative isolated-worktree threat modelに限定する。
- Observerをfixtureにせず、Observer関連repoを編集しない。Observer dogfoodはv5 Phase gateのhard dependency後に限る。
- dotagents repoはread-only参照のみ。Control stateはLatticeの`.git/`、artifactはLattice repo内に置く。
- remote作成、push、publish、credential／login、production／external effectは行わない。
