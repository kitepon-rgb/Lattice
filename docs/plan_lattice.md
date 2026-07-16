# Lattice 実装計画

- 状態: Active
- 更新日: 2026-07-16
- 現在のplan version: `lattice-research-campaign-2-v1`
- predecessor: `lattice-research-campaign-1-v6`（[Phase-supported archive](archive/2026-07-16-plan-lattice-research-campaign-1-v6-phase-supported.md)、SHA-256 `b655ded0a9c11dac33a79dfd3b347bc3c69ea2e5ec37af7bb688d3b9fd49a35c`）
- predecessor Decision: [ADR 0031](adr/0031-rc1-v6-phase-gate-support.md)
- campaign Decision: [ADR 0032](adr/0032-rc2-bounded-graph-compiler-and-three-way-seam.md)
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
  新3-TODO fixture内ではaccepted 3-way registry shardだけを独立変数にすると、外部挙動を保ったままwrite conflictを3から0、
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
- **failure controls:** third-only unknownはplan dispatch／transformを拒否する。不完全registry shardはoracle failure→rejected transformとなり、
  fresh treatment plan／version barrierを発行しない。

### 測定指標

| 指標 | control | treatment／control success |
|---|---|---|
| compiler core identity | fixed digest | 全fixture／conditionで同一 |
| current write conflicts | K3 = 3 | primary treatment 0 |
| primary exact waves（capacity 3） | 3 | 1 |
| partial state negative | control topologyに包含 | treatment exactly 1 conflict／2 waves |
| capacity-only（capacity 2） | N/A | empty 3-node graph／2 waves |
| A-B-C path | N/A | 2 waves、3へ過大直列化しない |
| conflict semantics | unordered | same-waveだけ禁止 |
| hard need semantics | ordered | predecessorより後 |
| optimality | producer witness | independent enumeratorが短い割当なしを確認 |
| metamorphic invariance | original IDs/order | rename／permutation後もisomorphic |
| unknown | provenance付き | dispatchable planなし |
| behavior oracle | fixed exact cases | pre／post全case一致 |
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
11. 3-TODO primary controlはwrite conflict 3、capacity 3でminimum 3 wavesになる。
12. registry-shard adapterはaccepted seam candidate digest、candidate witness digest、adapter source digest、allowed paths、oracleをtransformへbindし、
    conflict、expected waves、proposed ownershipを注入しない。
13. accepted transformはcanonical worktreeを変えず、pre／post black-box oracleを全case greenにし、scope外write／cleanup leakを0にする。
14. treatmentはwrite conflict 0、hidden unknown 0、capacity 3でminimum 1 waveになる。
15. partial-state negativeはexactly one conflict、minimum 2 wavesで、第三TODOをいずれかのwaveへco-scheduleする。
16. capacity-only controlは同じempty treatment graphをcapacity 2で2 wavesにする。
17. incomplete transformとunknown controlからaccepted artifact、fresh treatment compile、new plan diffを発行しない。
18. RC1 transfer blockとRC2 primary blockは同じcore source digestを持ち、condition-specific selectorを持たない。
19. control／treatment各2 fresh runのsnapshot preimage、Codegraph identity、raw／portable evidence、patch identityを保存する。
20. new plan diffはaccepted transform、behavior envelope、run evidence、v6 archive／ADR digestをpredecessorに持ち、旧plan／context／partial patchを失効する。
21. artifact-only verifierはsummary booleanを信頼せず、normalized graph、schedule、oracle、snapshot、patch、predecessor、stage costを保存bytesから再計算する。
22. stage別elapsed、patch bytes／files／review lines、reject／retry／rollback回数を保存し、未実測を0へ丸めない。
23. focused／related収束後のfull `npm run ci`がgreenで、Phase反証に生き残るP0／P1 findingが0になる。

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

- [ ] `boundary_verdict.v2`と`plan_graph.v2`を旧validator非変更の別moduleで実装する。
- [ ] fixture front-end outputのprovenance付きnormalized graph contractを実装する。
- [ ] candidate／path非依存のdeterministic bounded schedulerを実装する。
- [ ] producerと独立したenumerating verifierでfeasibility／minimumを再計算する。
- [ ] metamorphic／unknown／capacity focused testをgreenにする。

### RC2-D — 既存2-TODO fixtureをv2へtransferする

- [ ] RC1 candidate／Codegraph／manual evidenceをnormalized graphへ変換するfront-endを追加する。
- [ ] disposable worktreeで既存accepted patchを使い、fresh control／treatment各1 runを同じcoreへ通す。
- [ ] v6のnormal／negative conflictとwavesにisomorphicで、v6 artifact非変更を確認する。

### RC2-E — 3-TODO registry fixtureとoracle

- [ ] Lattice内へmonolithic delivery policy registryと3 TODO outcomeを持つfixtureを追加する。
- [ ] current／proposed production＋test ownership、manual state／effect、query setを一つのcandidate witnessへ固定する。
- [ ] transform外のblack-box oracleとshared composition characterizationを先にgreenにする。
- [ ] new pathのCodegraph空／absent結果を依存なしへ丸めず、初回index後にexact surfaceを再確認する。

### RC2-F — registry-shard transform adapter

- [ ] adapter責務をpatch、allowed paths、oracle／verifier、output snapshotへ限定する。
- [ ] accepted seam candidate／witness／adapter source／patchをtransform artifactへcross-bindする。
- [ ] incomplete shardをoracle failureでrejectし、accepted artifact／new planが出ないことを固定する。
- [ ] canonical source invariant、scope、cleanup、rollback cutをfocused gateで確認する。

### RC2-G — closed loopとimmutable artifact

- [ ] primary control／treatment各2 fresh indexを同じquery set、core、Codegraph identityで実行する。
- [ ] normal、partial-state negative、capacity controlを同じnormalized graph compilerへ通す。
- [ ] pre／post oracle、snapshot-bound Codegraph evidence、schedule proof、cost／reworkをartifactへ保存する。
- [ ] v6 archive／ADR、accepted transform、behavior envelope、run evidenceをpredecessorにしてnew plan全体を再compileする。
- [ ] `research/campaigns/rc2/artifacts/v1`へatomic発行し、RC1 artifactを上書きしない。
- [ ] disk verifierで保存bytesから全relationとminimumを再計算する。

### RC2-H — Phase gate

- [ ] TODO単位の軽量監査を各完了候補で一回だけ行う。
- [ ] source収束後のfull `npm run ci`を一回だけ実行する。
- [ ] RC2成功条件だけを対象にPhase反証を一回行う。
- [ ] H1-RC2をsupport／refuteする新しい不変DecisionとPhase evidenceを残す。

## Evidence artifact

RC2は少なくとも次をLattice内へ保存する。

- v6 Phase-supported archive／ADR digestと実装前後の12-check compatibility receipt。
- v2 candidate witness、manual evidence、query set、behavior oracle、Codegraph／runtime identity。
- normalized graph、pairwise verdict、precedence／conflict、capacity、producer schedule、independent minimum verification。
- K3、empty、single edge＋isolated、A-B-C path、hard need＋conflict、capacity-only、rename／permutation、unknownのcontrol結果。
- RC1 transfer control／treatment各1 runとRC2 primary control／treatment各2 fresh runのsnapshot-bound raw／portable evidence。
- accepted／rejected transform、adapter source、allowed paths、patch、oracle receipt、source invariant、cleanup。
- normal／partial-state negative／capacity controlのmanifest、verdict、plan、comparison、underlying-artifact hypothesis evaluation。
- transform、oracle、index、compile、verify別elapsed、patch bytes／files／review lines、reject／retry／rollback、未検証範囲。
- old→new plan diff、失効context、digest付きpredecessor集合、artifact-only verifier receipt、Phase Decision。

machine artifactは`research/campaigns/rc2/artifacts/v1`へ新規保存する。RC1 artifact、ADR、archiveを上書きせず、Decision pathを
後続裁定の可変台帳として再利用しない。

## Non-goalsとwriter境界

- RC2ではrequirements／自然言語からTODO ownershipやseamを自動発見したと主張しない。
- registry shardを別seam class一般化の証拠にせず、production／test ownership partitionの3-way arity／topology実証に限定する。
- 9 TODO以上のexact最適scheduler、large-N heuristic、任意repo成功率、一般的速度改善率を完成させない。
- experimental v2 schemaをRC2 Phase gate前に公開contractへ昇格しない。
- RC1 v1 moduleの統合、rename、削除、artifact再発行を行わない。
- actual multi-agent dispatch、signing、remote attestation、敵対的実行中PATH差替えを扱わない。
- Observerをfixtureにせず、Observer関連repoを編集しない。dotagents repoはread-only参照だけに限定する。
- Lattice以外へControl state／artifactを書かない。remote作成、push、publish、credential／login、production effectを行わない。
