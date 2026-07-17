# Lattice 実装計画

- 状態: Phase-supported
- 更新日: 2026-07-16
- 現在のplan version: `lattice-research-campaign-2-v1`
- predecessor: `lattice-research-campaign-1-v6`（[Phase-supported archive](archive/2026-07-16-plan-lattice-research-campaign-1-v6-phase-supported.md)、SHA-256 `b655ded0a9c11dac33a79dfd3b347bc3c69ea2e5ec37af7bb688d3b9fd49a35c`）
- predecessor Decision: [ADR 0031](adr/0031-rc1-v6-phase-gate-support.md)
- campaign Decision: [ADR 0032](adr/0032-rc2-bounded-graph-compiler-and-three-way-seam.md)
- transform Decision: [ADR 0037](adr/0037-rc2-delivery-policy-transform-transaction.md)
- closed-loop Decision: [ADR 0038](adr/0038-rc2-closed-loop-version-and-artifact-contract.md)
- Phase gate Decision: [ADR 0043](adr/0043-rc2-v4-phase-gate-support.md)
- reconsideration evidence: [2026-07-16 RC2 plan reconsideration](evidence/2026-07-16-rc2-plan-reconsideration.md)
- 製品思想: [../PLAN.md](../PLAN.md)
- 公開契約: [00_product-contract.md](00_product-contract.md)

## Plan version diff

RC1 v6は固定2-TODO fixtureで、production＋test shared writeを3件から0件、minimum wavesを2から1へ減らし、
shared-state negativeを2 wavesへ保持した。隔離変換、control／treatment各2 fresh Codegraph run、black-box oracle、
snapshot-bound evidence、旧context失効、artifact-only verifier、full CIを一つのclosed loopとしてsupport済みである。

RC2はこの証拠へ追記しない。現行compiler／contractの2-TODO固定、全件直列scheduler、conflict／precedence混同、
自己申告minimum、fixture固有transformを、別のexperimental v2 module群で反証する。RC1 v6 source入口とartifactは凍結し、
実装前後にdisk verifier 12 checksを同じ結果で再生する。

新fixtureは3 TODOが一つのdelivery policy registry symbol／pathとshared testを争う。behavior-preservingな3-way registry shardで
production／test ownershipを分ける。これは別seam classの一般化ではなく、RC1と同じwrite ownership partitionを3-way arity、
partial conflict、capacityへ拡張する実験である。

RC2はrequirementsからownershipを自動発見しない。candidate specのcurrent／proposed ownershipはmanual design witnessとして
provenance付き入力へ固定する。fixture front-endはCodegraph evidenceとmanual evidenceをnormalized graphへ変換し、generic coreは
candidate ID、fixture path、repo path、oracle、transform adapterを見ずにscheduleだけをcompileする。

## Research Campaign 2 v1

### 核心仮説と対立仮説

- **核心仮説 H1-RC2:** 同一digestのbounded normalized graph compilerは、明示されたboundary witnessから、既存2-TODO fixtureと
  新3-TODO fixture、K3、empty、single edge＋isolated、A-B-C path、hard need＋conflict、capacity 2／3をfixture固有分岐なしにcompileできる。
  新3-TODO fixture内ではaccepted 3-way registry shardだけを独立変数にすると、外部挙動を保ったままdistinct write-conflict pairを
  3（resource records 12）から0、
  capacity 3のexact minimum wavesを3から1へ減らす。二TODOだけがshared stateを持つnegativeは1 conflict、2 wavesを保持し、
  第三TODOを同じwaveへpackする。accepted transform、fresh reindex、new plan versionの因果鎖は保存artifactから再計算できる。
- **H0-a:** coreがcandidate ID、path、TODO数、capacity、K3 shapeを特判し、二fixtureの期待値だけを返す。
- **H0-b:** conflictをprecedenceへ誤変換するか、producerが非最小scheduleを`minimum`と自己申告してもverifierが受理する。
- **H0-c:** candidate specへdisjoint ownershipを書いた自己成就を、自動ownership discoveryまたはCodegraph由来semantic independenceと誤認する。
- **H0-d:** registry shardがproductionまたはtest behaviorを変える、不完全shardをacceptする、あるいはscope外writeを行う。
- **H0-e:** third-only unresolved／dynamic unknown、shared state、capacity超過をparallelへ丸める。
- **H0-f:** v2実装がRC1 v6 trusted replayを変え、過去12-check evidenceを失効させる。
- **H0-g:** aggregate elapsedだけを記録し、transform／reindex／oracle／compile／review／rework費用を構造便益から分離できない。

### Experimental conditions

- **primary control condition:** untransformed 3-TODO registry fixtureを同一base、query set、candidate witness、manual evidence、oracle、
  Codegraph identity、compiler、capacity 3で2回fresh index／compileする。current production＋test resourceはK3を作る。
- **primary treatment condition:** 同じbaseへaccepted registry-shard patchだけを加えたdisposable worktreeを、同じfixed inputで2回fresh
  index／compileする。proposed production＋test resourceはpairwise disjointになる。
- **independent variable:** accepted registry-shard transform artifactの有無。candidate witnessはcontrol／treatment共通のimmutable inputで、
  surface modeだけをsnapshot-bound Codegraph evidenceから選ぶ。compiler、capacity、manual state／effect、oracle、runtime、query set、
  Codegraph executable identityを固定する。
- **RC1 transfer block:** 既存2-TODO fixtureをv2 front-end／同じnormalized graph coreでfresh control／treatment各1回compileし、
  v6の3→0 write conflict、2→1 waves、shared-state negative 2 wavesとisomorphicな結果を要求する。RC1 artifactは再発行しない。
- **partial-conflict negative:** treatment snapshotへTODO 2件だけのshared `delivery-policy-registry` state writeを同じmanual evidenceで与え、
  exactly one unordered state conflict、2 waves、isolated TODOのco-schedulingを要求する。
- **capacity control:** 同じtreatment graphでcapacityだけ3→2にし、0 conflictsでも2 wavesになることを別条件として測る。seam効果へ混ぜない。
- **metamorphic controls:** A-B-C path、disconnected edge＋isolated、hard need＋conflict、TODO順列、ID／resource renameをcoreへ入力し、
  graph isomorphismに沿う同じminimumを要求する。
- **failure controls:** third-only unknownはplan dispatch／transformを拒否する。不完全registry shardはtyped `incomplete_transform` rejectionとなり、
  fresh treatment plan／version barrierを発行しない。

### 測定指標

| 指標 | control | treatment／control success |
|---|---|---|
| compiler core identity | fixed digest | 全fixture／conditionで同一 |
| current write conflicts | K3 = 3 pairs／12 resource records | primary treatment 0／0 |
| primary exact waves（capacity 3） | 3 | 1 |
| partial state negative | control topologyに包含 | treatment exactly 1 conflict／2 waves |
| capacity-only（capacity 2） | N/A | empty 3-node graph／2 waves |
| A-B-C path | N/A | 2 waves、3へ過大直列化しない |
| conflict semantics | unordered | same-waveだけ禁止 |
| hard need semantics | ordered | predecessorより後 |
| optimality | producer witness | independent enumeratorが短い割当なしを確認 |
| metamorphic invariance | original IDs/order | rename／permutation後もisomorphic |
| unknown | provenance付き | dispatchable planなし |
| behavior oracle | fixed source＋6 exact cases | pre／post全case＋source digest一致 |
| test seam sensitivity | shared exact test | 6 mutationsでowner testだけ失敗 |
| Codegraph evidence | control 2 run | treatment 2 run＋RC1 transfer 1+1 |
| transform failure | N/A | rejected、new plan未発行 |
| RC1 v6 compatibility | 12/12 | 実装後も12/12 |
| stage cost | stage別elapsed | transform／oracle／index／compile／verify別 |
| intervention surface | 0 | patch bytes、file数、review lines |
| rework | 0基準 | reject／retry／rollback回数を保存 |

wave差は構造的schedulability指標であり、actual multi-agent wall-clock短縮とは呼ばない。queue、review、reworkを含む外的経済効果は
後続dogfoodで測る。

### 成功条件

1. RC1 v6 archive／ADR／artifact／v1 source入口を変更せず、変更前後のdisk verifierが12/12 greenになる。
2. v2 contractは1〜8 TODOをbounded受理し、N件pairwise verdict、typed precedence、unordered conflict、unknownを表現する。
3. normalized graph core inputにcandidate ID、fixture path、repo path、oracle、adapter、期待wave数を含めない。
4. fixture front-endは全resourceへ`codegraph | manual_candidate_spec | manual_state_effect` provenanceを付け、missing／empty／unresolvedを
   independenceへ丸めない。
5. candidate specはmanual ownership witnessとしてartifactへ固定され、自動ownership発見のmachine claimを出さない。
6. producerはdeterministic feasible scheduleを作り、独立enumeratorがcapacity、precedence、conflictと最小性を保存graphから再計算する。
7. conflictは同wave禁止、hard needはstrict orderingとして別検査され、A-B-C pathを2 wavesでcompileする。
8. K3、empty、single edge＋isolated、capacity-only、hard need＋conflictがそれぞれ期待minimumを持つ。
9. TODO order permutationとID／resource renameがisomorphic verdict／scheduleを返す。
10. third-only unknown、探索上限外、budget exhaustionはtyped non-dispatchable／unsupportedとなり、minimumを自己申告しない。
11. 3-TODO primary controlはwrite conflict 3 pairs／12 resource records、capacity 3でminimum 3 wavesになる。
12. registry-shard adapterはaccepted seam candidate digest、candidate witness digest、adapter source digest、allowed paths、oracleをtransformへbindし、
    conflict、expected waves、proposed ownershipを注入しない。
13. fixed oracle sourceを期待値の唯一の正本にし、candidate、control／treatment source snapshot、保存source bytesのdigestとpre／post case-set
    digestをcross-bindする。期待値を複製するoracle JSONを作らない。
14. accepted transformはcanonical worktreeを変えず、pre／post black-box oracleを全case greenにし、scope外write／cleanup leakを0にする。
15. oracle 6 caseを3 dedicated testsへexact partitionし、各single-case mutationでowner testだけが失敗、他2 testsとshared composition testが
    成功する。空／常時pass testはacceptしない。
16. treatmentはwrite conflict 0、hidden unknown 0、capacity 3でminimum 1 waveになる。
17. partial-state negativeはexactly one conflict、minimum 2 wavesで、第三TODOをいずれかのwaveへco-scheduleする。
18. capacity-only controlは同じempty treatment graphをcapacity 2で2 wavesにする。
19. incomplete transformとunknown controlからaccepted artifact、fresh treatment compile、new plan diffを発行しない。
20. RC1 transfer blockとRC2 primary blockは同じcore source digestを持ち、condition-specific selectorを持たない。
21. control／treatment各2 fresh runのsnapshot preimage、Codegraph identity、raw／portable evidence、patch identityを保存する。
22. new plan diffはaccepted transform、behavior envelope、run evidence、v6 archive／ADR digestをpredecessorに持ち、旧plan／context／partial patchを失効する。
23. artifact-only verifierはsummary booleanを信頼せず、normalized graph、schedule、oracle、snapshot、patch、predecessor、stage costを保存bytesから再計算する。
24. stage別elapsed、patch bytes／files／review lines、reject／retry／rollback回数を保存し、未実測を0へ丸めない。
25. focused／related収束後のfull `npm run ci`がgreenで、Phase反証に生き残るP0／P1 findingが0になる。

### 反証・設計変更条件

- v6 disk replayが一件でも変わる場合はv2実装を止め、旧入口へのwriteを特定して分離する。
- v2を実装するためにv1 schema／RC1 compilerを可変化する必要が出た場合は、加算module設計をやり直す。
- coreがcandidate／fixture／pathを必要とする、またはadapterがconflict／expected wavesを供給するなら責務分離をrejectする。
- path graphを3 wavesへする、conflictを方向付きprecedenceへする、capacity-onlyを1 waveへする、短いfeasible scheduleを見逃す場合は
  scheduler／verifierをrejectする。
- rename／permutationでnon-isomorphic resultになる場合は特判またはcanonicalization欠陥としてrejectする。
- third-only unknownが第三TODOだけedgeなしでdispatchされる場合はfail-closed契約をrejectする。
- proposed ownershipのsemantic妥当性をCodegraphだけで証明できない場合は、manual witness claimを維持し、自動発見へ拡張しない。
- shared production／test／state resourceがtreatmentに残れば1 waveを主張せず、追加seamまたはintentional serialへ再compileする。
- oracle failure、scope violation、cleanup failureからnew planを発行できる場合はtransform protocolをrejectする。
- fixed oracle source／case-set identityを保存bytesから再計算できない、またはdedicated test mutation matrixがexact partitionを示さない場合は
  behavior／test seam claimをrejectする。
- cost stageがaggregateへ潰れる、未実測が0になる、rejected attemptが消える場合はcost artifactをrejectする。
- primary実測が3→1またはpartial negative 2 wavesを支持しなければfixtureを都合よく変更せず、H1-RC2をrefuteする。

## Hard dependencyと並列研究lane

```text
RC2-A v6 archive + ADR 0032 + RC2 plan
  └─ RC2-B compatibility + characterization safety net
       └─ RC2-C v2 contract + normalized graph core
            ├─ RC2-D RC1 transfer front-end ───────────────────┐
            └─ RC2-E 3-TODO registry fixture + oracle          │
                  └─ RC2-F registry-shard transform adapter ───┤
                                                               └─ RC2-G fresh reindex + artifact chain
                                                                    └─ RC2-H Phase gate
```

| node | hard dependency | lane／effect | evidence artifact | gate |
|---|---|---|---|---|
| RC2-A | ADR 0031／v6 immutable artifact | F: 親直轄 docs／Decision | v6 archive、ADR 0032、RC2 plan | docs-only独立commit |
| RC2-B | RC2-A | F acceptance＋A test実装 | v6 12-check、expected-red topology／unknown／failure controls | Codegraph preflight前はtestのみ |
| RC2-C | RC2-B expected red | F: schema／conflict／minimum契約 | v2 validators、normalized core、independent enumerator | focused metamorphic green |
| RC2-D | RC2-C | A: 既存fixture front-end | RC1 v2 transfer control／treatment | v6 isomorphic result |
| RC2-E | RC2-C | A: 新fixture／oracle | 3-TODO characterization、oracle exact cases | pre-transform behavior固定 |
| RC2-F | RC2-E＋C | A: 隔離transform adapter | accepted／rejected artifact、patch、cleanup | behavior／scope focused green |
| RC2-G | D＋F | F: causal campaign／version barrier | fresh 1+1＋2+2 run、immutable RC2 artifact | disk replay＋related green |
| RC2-H | RC2-G | F: 親裁定 | full CI、Phase audit、Decision | Phase反証1回 |

RC2-DとRC2-EはRC2-Cのcontractを変えず、非交差fixture／test scopeで並列にできる。RC2-Gが同じcore digest、固定input、
artifact relationを統合する。Controlはこのplanのdocs-only commit後に初期化する。

## TODO

### RC2-A — v6をarchiveしRC2へ再compileする

- [x] RC1 v6 Phase support、97-test baseline、現source／test tree identityを再確認する。
- [x] 実コードの2-TODO固定、全件直列、conflict／precedence混同、minimum未検証、v6 replay couplingを確認する。
- [x] 候補planをread-only refuter／Criticで一回ずつ反証し、非識別条件だけを採用する。
- [x] v6 planをPhase-supported archiveへ移し、実SHA-256をpredecessorにする。
- [x] ADR 0032でv1凍結、normalized core、bounded exact claim、manual ownership witnessを固定する。
- [x] plan／ADR／reconsideration evidenceだけを独立commitにし、source／test変更を混ぜない。

### RC2-B — compatibilityとcharacterizationを先に置く

- [x] source編集前に対象path／symbolのCodegraph owned、caller／callee、impact、affected test、unknownを記録する。
- [x] committed v6 artifactのdisk verifier 12/12を互換baselineとして一回保存する。
- [x] v1が3 TODOをrejectし、現scheduler／validatorがpartial graphとminimumを表現できない実挙動をcharacterizeする。
- [x] K3、empty、single edge＋isolated、A-B-C path、capacity-only、hard need＋conflictをexpected-red／green oracleへ固定する。
- [x] TODO順列、ID／resource rename、third-only unknown、node／探索上限をtest-firstで固定する。
- [x] producerと独立したminimum verifierのfeasible／non-minimum／conflict／precedence／capacity corruptionをtest-firstで固定する。
- [x] characterizationだけを独立commitする。

### RC2-C — v2 contractとnormalized graph core

- [x] provenance bundle、v2 verdict／plan validator、corruption rejectionをproduction source前のexpected-redで固定する。
- [x] `boundary_verdict.v2`と`plan_graph.v2`を旧validator非変更の別moduleで実装する。
- [x] fixture front-end outputのprovenance付きnormalized graph contractを実装する。
- [x] candidate／path非依存のdeterministic bounded schedulerを実装する。
- [x] producerと独立したenumerating verifierでfeasibility／minimumを再計算する。
- [x] metamorphic／unknown／capacity focused testをgreenにする。

### RC2-D — 既存2-TODO fixtureをv2へtransferする

- [x] RC1 v6の4条件、v2 validator、candidate／query／manual bindingをexpected-red characterizationで固定する。
- [x] RC1 candidate／Codegraph／manual evidenceをnormalized graphへ変換するfront-endを追加する。
- [x] disposable worktreeで既存accepted patchを使い、fresh control／treatment各1 runを同じcoreへ通す。
- [x] v6のnormal／negative conflictとwavesにisomorphicで、v6 artifact非変更を確認する。

### RC2-E — 3-TODO registry fixtureとoracle

- [x] 6 exact behavior、fail-loud input、fresh repoRoot oracleをexpected-red characterizationで固定する。
- [x] Lattice内へmonolithic delivery policy registryとfixed black-box oracleを追加する。
- [x] 3つのfuture behavior TODOをplan inputへ固定する。
- [x] currentのfixed oracleを含むproduction＋test ownership、proposed ownership、6 case partition、manual state／effect、query setを一つのcandidate witnessへ固定する。
- [x] fixed oracle source digestをcandidateとcontrol／treatment source snapshotへbindし、期待値JSONを重複作成しない。
- [x] fixture front-endをbundle生成だけに限定し、K3／treatment／partial-state／unknownをtest-firstで固定する。
- [x] front-end source前にfresh Codegraphでowned path／symbol、caller／callee、impact、affected test、bootstrap unknownを固定する。
- [x] `compileDeliveryPolicyBoundaryBundleV2`を実装し、同じnormalized graph coreへbundleだけを渡す。
- [x] transform外のblack-box oracleとshared composition characterizationを先にgreenにする。
- [x] new pathのCodegraph空／absent結果を依存なしへ丸めず、初回index後にexact surfaceを再確認する。

### RC2-F — registry-shard transform adapter

- [x] transform source／test前にCodegraphでplanned export／pathのbootstrap unknownと既存isolation／oracle／fixture影響を固定する。
- [x] writer、隔離transaction、snapshot binding、6×4 mutation matrix、rejection／cleanupをtest-firstで固定する。
- [x] shared exact testをcomposition-only＋3 dedicated testsへbehavior-preservingに分割する。
- [x] adapter責務をpatch、allowed paths、oracle／verifier、output snapshotへ限定する。
- [x] accepted seam candidate／witness／adapter source／patchをtransform artifactへcross-bindする。
- [x] 6 single-case mutationでowner dedicated testだけが失敗するexact partitionを検証し、各mutationを完全復元する。
- [x] incomplete shardをtyped `incomplete_transform`でrejectし、accepted output／new planを持たないことを固定する。
- [x] canonical source invariant、scope、cleanup、rollback cutをfocused gateで確認する。

実装証拠: [2026-07-16 RC2 delivery policy transform](evidence/2026-07-16-rc2-delivery-policy-transform-implementation.md)

### RC2-G — closed loopとimmutable artifact

- [x] G2a blocker: fuzzy-only Codegraph queryを`symbol_absent`にしたまま候補dataを残すadapter欠陥をcharacterizeし、exact候補だけへ正規化する。
- [x] G2b blocker: Codegraphがabsent test path自身をaffected testに返す場合も、filesystem existenceへbindしてtyped emptyとして保持する。
- [x] G2c blocker: accepted registry shardのcomposition entryから3 resolverへのexact callee linkをfresh Codegraphで観測可能にする。
- [x] G2d blocker: 16KiBを超えるraw evidence base64をbounded canonical chunksへ保存し、disk verifierでbyte-exactにrehydrateする。
- [x] G2e blocker: RC1 v6の3 opaque predecessor JSONをbyte-exactに保持し、RC2-owned JSONだけへcanonicalityを要求する。
- [x] primary control／treatment各2 fresh indexを同じquery set、core、Codegraph identityで実行する。
- [x] normal、partial-state negative、capacity controlを同じnormalized graph compilerへ通す。
- [x] pre／post oracle、fixed oracle source bytes／digest、snapshot-bound Codegraph evidence、schedule proof、cost／reworkをartifactへ保存する。
- [x] v6 archive／ADR、accepted transform、behavior envelope、run evidenceをpredecessorにしてnew plan全体を再compileする。
- [x] `research/campaigns/rc2/artifacts/v1`へatomic発行し、RC1 artifactを上書きしない。
- [x] disk verifierで保存bytesから全relationとminimumを再計算する。

実行証拠: [2026-07-16 RC2 canonical closed loop](evidence/2026-07-16-rc2-canonical-closed-loop.md)

### RC2-H — Phase gate

- [x] H0a post-artifact fresh indexで保存`identity/*.mjs`がlive graphへ混入するfailureをcharacterizeする。
- [x] H0b tracked `codegraph.json`でartifact identityだけを除外し、config actual bytesをexecution identityへbindする。
- [x] H0c.1 artifact v2／plan v3／v1 read compatibilityの期待値をproduction変更前のcharacterizationへ固定する。
- [x] H0c.2 immutable v1をpredecessorにしたartifact v2 writer／version-aware verifier／plan v3 barrierを実装する。
- [x] H0c.3 canonical artifact v2を発行し、v1／v2をdisk replayする。
- [x] TODO単位の軽量監査を各完了候補で一回だけ行う。
- [x] source収束後のfull `npm run ci`を一回だけ実行する。
- [x] H1a Phase反証P1として、全digestを再封印したoracle source／false receipt／mutation matrix意味改竄の誤受理を
  characterization testとevidenceへ固定する。
- [x] H1b 新しい不変ADRでsemantic oracle／mutation verifier、artifact v3、plan v4のversion barrierを裁定する。
- [x] H1c.0 source編集前Codegraph preflightを開き直し、oracle／front-end／transform／artifact verifier／campaignとdynamic candidate
  consumerのowned boundary、affected test、unknownを固定する。
- [x] H1c.1 v1／v2 read compatibilityを保つversion-aware semantic verifierを実装し、3件のcharacterizationと関連契約をgreenにする。
- [x] H1d immutable v2をpredecessorにcanonical artifact v3／plan v4を発行し、fresh reindex、旧context失効、related／full gateを
  新しいevidenceへ固定する。
- [x] H2a Phase再反証で、canonical v2 common setをv3へ正規再包装しても15／15 validになる旧witness再包装P1を固定する。
- [x] H2b 新しい不変ADRでartifact version固有のactive candidate／oracle epoch bindingとartifact v4／plan v5 barrierを裁定する。
- [x] H2c v2→v3再包装をexpected-red回帰testへ固定し、v1／v2／v3 compatibilityを同時に保持する。
- [x] H2d source編集前Codegraph preflightでepoch verifier／campaign／candidate consumerとaffected testsを開き直す。
- [x] H2e version-aware active witness bindingとbase cross-bindingを実装し、世代不整合testをgreenにする。
- [x] H2f.1 immutable v3をpredecessorにcanonical artifact v4／plan v5をatomic発行する。
- [x] H2f.2 post-artifact Codegraph affected-set期待値へ新version witness testを加え、失敗scopeをgreenにする。
- [x] H2f.3 fresh reindex、4-version replay、related／full gateをevidenceへ固定する。
- [x] RC2成功条件だけを対象にPhase反証を一回行う。
- [x] H1-RC2をsupport／refuteする新しい不変DecisionとPhase evidenceを残す。

post-publication correction実装証拠:
[2026-07-16 RC2 artifact v2 implementation](evidence/2026-07-16-rc2-artifact-v2-implementation.md)

canonical successor証拠:
[2026-07-16 RC2 canonical artifact v2](evidence/2026-07-16-rc2-canonical-artifact-v2.md)

full regression証拠:
[2026-07-16 RC2 full CI](evidence/2026-07-16-rc2-full-ci.md)

semantic reseal expected-red証拠:
[2026-07-16 RC2 artifact semantic reseal characterization](evidence/2026-07-16-rc2-artifact-semantic-reseal-characterization.md)

semantic binding Decision:
[ADR 0041: RC2 artifactへoracle／mutation semanticsをbindしv3へ再compileする](adr/0041-rc2-artifact-semantic-oracle-mutation-binding.md)

semantic binding preflight証拠:
[2026-07-16 RC2 semantic binding Codegraph preflight](evidence/2026-07-16-rc2-semantic-binding-codegraph-preflight.md)

semantic binding実装証拠:
[2026-07-16 RC2 semantic binding implementation](evidence/2026-07-16-rc2-semantic-binding-implementation.md)

canonical semantic successor証拠:
[2026-07-16 RC2 canonical artifact v3／plan v4](evidence/2026-07-16-rc2-canonical-artifact-v3.md)

semantic correction full regression証拠:
[2026-07-16 RC2 semantic binding full CI](evidence/2026-07-16-rc2-semantic-binding-full-ci.md)

v3 witness再包装反証証拠:
[2026-07-16 RC2 artifact v3 witness再包装 Phase refutation](evidence/2026-07-16-rc2-v3-version-downgrade-refutation.md)

version witness epoch Decision:
[ADR 0042: artifact versionをactive witness epochへbindしv4へ再compileする](adr/0042-rc2-artifact-version-witness-epoch-and-v4.md)

version-contract expected-red証拠:
[2026-07-16 RC2 artifact version-contract回帰test](evidence/2026-07-16-rc2-version-downgrade-characterization.md)

version witness preflight証拠:
[2026-07-16 RC2 version witness Codegraph preflight](evidence/2026-07-16-rc2-version-witness-codegraph-preflight.md)

version witness実装証拠:
[2026-07-16 RC2 version witness consistency implementation](evidence/2026-07-16-rc2-version-witness-implementation.md)

canonical version witness successor証拠:
[2026-07-16 RC2 canonical artifact v4／plan v5](evidence/2026-07-16-rc2-canonical-artifact-v4.md)

version witness full regression証拠:
[2026-07-16 RC2 version witness full CI](evidence/2026-07-16-rc2-version-witness-full-ci.md)

RC2 v4 Phase反証証拠:
[2026-07-16 RC2 artifact v4／plan v5 Phase反証](evidence/2026-07-16-rc2-v4-phase-refutation.md)

RC2 v4 Phase gate Decision:
[ADR 0043: RC2 v4は3-way registry fixtureで世代固有witness付き閉ループをsupportする](adr/0043-rc2-v4-phase-gate-support.md)

## Evidence artifact

RC2は少なくとも次をLattice内へ保存する。

- v6 Phase-supported archive／ADR digestと実装前後の12-check compatibility receipt。
- v2 candidate witness、manual evidence、query set、fixed oracle source／case-set identity、Codegraph／runtime identity。
- normalized graph、pairwise verdict、precedence／conflict、capacity、producer schedule、independent minimum verification。
- K3、empty、single edge＋isolated、A-B-C path、hard need＋conflict、capacity-only、rename／permutation、unknownのcontrol結果。
- RC1 transfer control／treatment各1 runとRC2 primary control／treatment各2 fresh runのsnapshot-bound raw／portable evidence。
- accepted／rejected transform、adapter source、allowed paths、patch、oracle receipt、6-case mutation matrix、source invariant、cleanup。
- normal／partial-state negative／capacity controlのmanifest、verdict、plan、comparison、underlying-artifact hypothesis evaluation。
- transform、oracle、index、compile、verify別elapsed、patch bytes／files／review lines、reject／retry／rollback、未検証範囲。
- old→new plan diff、失効context、digest付きpredecessor集合、artifact-only verifier receipt、Phase Decision。

machine artifact v1は`research/campaigns/rc2/artifacts/v1`でimmutableに保持し、post-publication correctionは
`research/campaigns/rc2/artifacts/v2`へ新規保存する。RC1／RC2 v1 artifact、ADR、archiveを上書きせず、Decision pathを
後続裁定の可変台帳として再利用しない。Phase反証で見つかったsemantic reseal P1のcorrected successorはv1／v2を変更せず
`research/campaigns/rc2/artifacts/v3`へ新規保存する。

## Non-goalsとwriter境界

- RC2ではrequirements／自然言語からTODO ownershipやseamを自動発見したと主張しない。
- registry shardを別seam class一般化の証拠にせず、production／test ownership partitionの3-way arity／topology実証に限定する。
- 9 TODO以上のexact最適scheduler、large-N heuristic、任意repo成功率、一般的速度改善率を完成させない。
- experimental v2 schemaをRC2 Phase gate前に公開contractへ昇格しない。
- RC1 v1 moduleの統合、rename、削除、artifact再発行を行わない。
- actual multi-agent dispatch、signing、remote attestation、敵対的実行中PATH差替えを扱わない。
- Observerをfixtureにせず、Observer関連repoを編集しない。dotagents repoはread-only参照だけに限定する。
- Lattice以外へControl state／artifactを書かない。remote作成、push、publish、credential／login、production effectを行わない。
