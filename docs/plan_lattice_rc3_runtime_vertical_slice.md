# Lattice RC3 — runtime feedback loop vertical slice 計画

- 状態: Ready-for-admission
- 作成日: 2026-07-16
- plan version: `lattice-runtime-rc3-v1`
- predecessor plan: `lattice-research-campaign-2-v1`（`docs/plan_lattice.md`、Phase-supported）
- predecessor Decision: [ADR 0043](adr/0043-rc2-v4-phase-gate-support.md)
- canonical predecessor artifact: `research/campaigns/rc2/artifacts/v4`
- writer境界: `/Users/kite/Developer/Lattice`のみ

## 目的

RC2は、manual ownership witnessからprovenance付きboundary graphを作り、bounded exact schedulerと独立verifierで
minimum scheduleを計算し、隔離seam-refactor、behavior／mutation検証、fresh Codegraph再index、全affected TODOの
新plan versionへの再compileまでをLattice内fixtureで実証した。

RC3は、この研究pipelineをtest内のcampaignから外へ出し、versioned JSONとheadless CLIを介して実行可能なruntime
vertical sliceへする。runtimeはplanを一度発行して終わらず、複数executorの実diffを観測し、後から見つかった競合に対して
affected TODOだけをholdし、無関係TODOを証拠付きで継続し、旧contextを失効してplan vN+1へ再compileできなければならない。

```text
manual TODO witness + Codegraph observation
                 │
                 ▼
       compile + independent verify
                 │
                 ▼
      ready-frontier dispatch ───────────────┐
                 │                           │
                 ▼                           │
       worktree diff observation             │
                 │                           │
       no conflict ── continue               │
                 │                           │
       late conflict / unknown               │
                 ▼                           │
 affected hold + checkpoint + invalidation   │
                 │                           │
      seam treatment or intentional serial   │
                 │                           │
                 ▼                           │
        reindex + plan vN+1 compile          │
                 │                           │
                 └─ carry-over / redispatch ─┘
```

## RC2から保存するもの

次を不変predecessorとして再利用し、作り直さない。

- `compileSchedulabilityGraphV2`のcandidate／fixture非依存な1〜8 TODO exact scheduler。
- `verifySchedulabilityPlanV2`のproducer非依存なfeasibility／minimum再計算。
- manual witness、Codegraph portable outcome、state／effect／unknownを分離する証拠規律。
- isolated worktree transform、allowed path、fixed oracle、mutation matrix、cleanup、typed rejection。
- active witness epoch、base relation、manifest、plan barrierを保存bytesから再計算するartifact verifier。
- canonical artifact v4、plan v5、ADR 0041〜0043、RC1／RC2 predecessor artifact。

RC3はcanonical artifact v4へ追記せず、RC2 plan／ADR／evidenceを後続裁定の可変台帳として使わない。

## 核心仮説

### H1-RC3

cooperative isolated-worktree executor、manual ownership witness、1〜8 TODO、Lattice-owned dogfood fixtureの範囲で、
Lattice runtimeは次を一つの保存可能な因果鎖として実行できる。

1. generic repo requestとfresh Codegraph観測からdispatchable planをcompileし、独立verifyする。
2. precedence、conflict、capacityを満たすready frontierだけを複数executorへdispatchする。
3. 実行中diffから宣言scope外write、後発path／resource conflict、runtime unknownを検出する。
4. affected TODOだけをholdし、非交差を再証明できるin-flight TODOだけをcarry overする。
5. stale plan／context epochのreceiptを拒否し、accepted checkpointをpredecessorにplan vN+1へ再compileする。
6. 切断可能な競合は既知のseam treatment contractへ送り、切断不能な競合はintentional serialへ落とす。
7. dispatch、観測、hold、継続、失効、再compile、再dispatchの裁定をevent bytesだけから再計算する。

### 反対仮説

- **H0-a:** runtimeはRC2 fixture名、既知path、期待waveを特判しなければ計画できない。
- **H0-b:** diff観測とmanual resource witnessをcross-bindできず、後発競合の正解集合を識別できない。
- **H0-c:** affected-only holdは旧plan全失効と両立せず、stale contextを継続または無関係TODOまで停止する。
- **H0-d:** waveを同期barrierとして実行し、独立TODOを最遅TODOへ不要に直列化する。
- **H0-e:** event summaryだけが成功を主張し、保存eventsからruntime裁定を再計算できない。
- **H0-f:** event／artifact stateが対象repoのCodegraph indexへ混入し、自分の観測で境界を変える。
- **H0-g:** scope violation、runtime unknown、stale receiptをsilent mergeまたは暗黙fallbackへ丸める。

## Claim境界

RC3でsupportを目指すのは、汎用I/Fとruntime閉ループの機構である。

- scheduler claimはRC2と同じ1〜8 TODOの`exact_minimum`だけを受理する。
- 9 TODO以上はtyped `NODE_LIMIT_EXCEEDED`とし、feasibleまたはminimum planを発行しない。
- generic adapterはfixture固有分岐を持たないが、任意repo成功率やownership自動発見をclaimしない。
- wall-clock、queue、review、reworkは観測するが、速度改善をH1-RC3の主claimにしない。
- actual multi-agent dogfoodは機構の外的妥当性観測であり、scripted conflict campaignを主たる識別実験にする。

9 TODO以上のfeasible-only modeは、minimum claim taxonomyとruntime correctnessを同時に変更するためRC3へ混ぜない。RC3の
bounded runtimeがsupportされた後、新しいplan versionで扱う。

## 公開I/F候補

### CLI

```text
lattice plan compile --request <run-request.json>
lattice plan verify  --request <run-request.json> --plan <plan.json>
lattice run start    --request <run-request.json> --executor <adapter>
lattice run observe  --run <run-directory>
lattice run status   --run <run-directory>
lattice event verify --run <run-directory>
```

- stdin／stdoutはversioned JSON、診断はstderrへ分離する。
- 成功時もsummary booleanだけでなく、artifact refとdigestを返す。
- unknown field、欠落field、不正path、過大入力、stale epochはfail closedにする。
- CLIはprovider固有sessionを所有せず、executor adapterのopaque handleだけを保存する。
- `--executor`省略時の暗黙provider fallbackは持たない。

### JSON契約

| schema | 役割 |
|---|---|
| `lattice.run_request.v1` | repo、base、TODO候補、capacity、manual witness、query set、executor capability |
| `lattice.boundary_manifest.v2` | path／symbol／resource、owns／reads／writes、state／effect、unknown、affected tests |
| `lattice.runtime_plan.v1` | node、precedence、conflict、capacity、manifest digest、context epoch、claim mode |
| `lattice.run_event.v1` | append-only event、sequence、previous digest、actor、plan epoch、subject、evidence |
| `lattice.executor_receipt.v1` | executor handle、worktree、base、context epoch、checkpoint、observed diff |
| `lattice.hold_decision.v1` | finding、affected closure、hold／continue集合、根拠digest |
| `lattice.carry_over_witness.v1` | vN→vN+1で継続可能なin-flight TODOの非交差証拠 |
| `lattice.runtime_plan_diff.v1` | old／new plan、accepted checkpoints、失効context、carry-over、redispatch |

schema名と必須fieldはRC3-AのADRで最終裁定する。RC2の公開済みschemaを同名変更しない。

## runtime意味論

### Ready frontier

compile時の`minimum_feasible_waves`は構造metricであり、runtimeの同期barrierではない。runtimeはeventごとに、未完了nodeの
hard predecessor、現在running nodeとのconflict、実capacityを再評価し、条件を満たすready frontierからdispatchする。

各dispatch decisionは、保存planと直前event prefixだけから独立verifierが再計算できなければならない。

### path／resource binding

manual witnessはTODOごとに少なくとも次を持つ。

- owned symbol／path。
- declared read／write path。
- pathが表現するstate／resource／external effect。
- Codegraph query provenanceとaffected tests。
- dynamic／semantic／effect unknown。

git diffはwriteの一次sensor、Codegraphはsymbol／edge／impact／affected testの構造enrichmentとして使う。Codegraphの空結果、
fuzzy解決、index lagを依存なしへ丸めない。宣言外pathへのwriteはtyped `scope_violation`としてaffected closureをholdする。

### 後発競合

少なくとも次を別kindで扱う。

- `observed_write_conflict`: running TODO間のpath／generated artifact overlap。
- `semantic_conflict_unknown`: 別pathだが同じstate／schema／invariantを変更する疑い。
- `effect_conflict_unknown`: 同じ外部effectまたはH surfaceへ到達する疑い。
- `scope_violation`: 宣言write scope外の変更。
- `stale_context`: active plan epochと一致しないdispatch／receipt。

観測不能なsemantic／effect conflictを安全と推測せず、evidence acquisitionまたはholdへ送る。

### selective holdとcarry-over witness

競合発見時はactive planへ追記しない。runtimeはevent intakeを一度freezeし、観測済みevent prefixを固定してaffected closureを計算する。

vNでrunning中のTODOをvN+1へcarry overできるのは、少なくとも次を保存bytesから再証明できる場合だけとする。

- TODO input、boundary manifest、validator、context packetのdigestが不変。
- accepted checkpoint／seam transformのchanged scopeとread／write／state／effectが非交差。
- hard predecessor、conflict、capacity、affected test契約が新planでも同値。
- executor receiptがworktree、base、plan epoch、checkpoint digestへbindされる。
- freeze後に未取り込みdiff eventが存在しない。

一件でも証明不能なら、そのTODOもholdして新contextでredispatchする。これはsilent fallbackではなく、発動理由と集合を
`hold_decision.v1`へ残すfail-closed規則である。

carried-over TODOへ発行する新context packetは、task、scope、verifier、boundary manifestのcontent digestを不変に保ち、
plan epochとplan refだけを更新する`epoch rebind packet`とする。rebindはeventとして保存する。rebind event以前のvN receiptは
carry-over witness経由でだけ有効とし、rebind以後のreceiptはvN+1 epochを要求する。この経路以外でvN epoch receiptを受理した場合は
`stale_context`としてrejectする。carry-overは旧contextの継続利用ではなく、失効後の内容同一性を証明した新epochへの再認可である。

### event store

- append-only canonical eventとdigest chainを持つ。
- sequence gap、重複、fork、digest mismatch、未知event kindを拒否する。
- runtime stateはevent projectionとして再構成し、可変summaryを証拠にしない。
- 対象repoのCodegraph index対象外かつsource snapshot identity対象外のLattice-owned pathへ置く。
- target repo内へ置く必要がある場合は、tracked exclusionとcoverage testを先行させる。
- credential、prompt全文、cookie、token、無関係な会話をeventへ保存しない。

## 実験設計

### Primary: scripted late-conflict campaign

Lattice-owned fixture sourceからdisposable git repoと複数worktreeを作り、正解集合が既知の条件を同一baseで比較する。
dogfood fixtureは1〜8 TODOの設計制約を持ち、TODO数上限を越えるfixture分割で成功を作らない。

| condition | 注入 | 期待 |
|---|---|---|
| clean parallel | 非交差write | hold 0、全TODO継続 |
| late path conflict | running 2 TODOが同じpathへ到達 | exact 2 TODO hold、無関係TODO継続、継続outputをvN+1へdigest bind |
| scope violation | 一方が宣言外pathを変更 | offenderとaffected closure hold |
| semantic unknown | 別pathだがshared state witnessが追加 | evidence取得までdispatch不可 |
| stale receipt | 旧epoch receiptをvN+1へ提出 | typed reject、accepted output 0 |
| irreducible conflict | seamなしのshared state | intentional serialへ再compile |
| accepted seam | predeclared bounded treatmentをaccept | fresh reindex後にconflict減少、new plan発行 |
| event corruption | event改竄／順序欠落／fork | runtime verifier reject |

各条件でaffected set、hold set、continue set、invalidated context、new plan、receiptを保存し、summary値を信じず再計算する。

### Secondary: actual multi-agent dogfood

- scripted campaign green後にだけ行う。
- 2以上の実executorを隔離worktreeへdispatchする。
- Lattice canonical worktreeへ直接書かせず、commit／push／branch切替／merge／rebase／reset／stashを禁止する。
- provider固有handleはopaqueに保持し、timeout時は同じhandleを回収して重複dispatchしない。
- dogfood targetはLattice-owned disposable fixture repoとし、dotagents／Observerをwriter targetにしない。
- natural conflictを待たず、scripted条件と同じ既知注入をactual executorで再現する。
- actual wall-clock、queue、review、reworkは観測値として保存し、0や改善率を捏造しない。

## 成功条件

1. RC1 v6とRC2 artifact v1〜v4をbyte不変でreplayできる。
2. `bin/lattice.mjs`が新CLI surfaceをexact argument contractで公開する。
3. generic front-endがfixture名、期待conflict、期待waveを入力または分岐に持たない。
4. 2つ以上の異なるLattice-owned fixture topologyを同じadapter／coreでcompileできる。
5. 1〜8 TODOのexact minimumを既存producerと独立verifierが一致して返す。
6. 9 TODO以上、unknown、探索budget exhaustionからdispatchable planを発行しない。
7. ready-frontier dispatchが各時点のprecedence、conflict、capacityを満たす。
8. 最遅TODOを待つ同期wave barrierをruntimeが要求しない。
9. executor receiptがhandle、worktree、base、plan epoch、checkpoint digestへbindされる。
10. runtime diffがdeclared path／resource witnessへcross-bindされる。
11. late path conflictの正解affected集合とhold集合がexact一致する。
12. 無関係TODOの継続にはcarry-over witnessが必須である。
13. carry-over witnessを一fieldでも破壊すると継続せずholdになる。
14. event intake freeze中の後着eventを取りこぼさず、次prefixへ順序付ける。
15. stale context／receiptをtyped rejectし、carried-over TODOの旧epoch receiptはrebind event経由のwitness bindingがある場合だけ受理する。
16. scope violationをsilent mergeせず、offenderとaffected closureをholdする。
17. semantic／effect unknownを安全と推測せず、evidence acquisitionへ送る。
18. seam treatment failure、scope failure、behavior failureからnew planを発行しない。
19. accepted seam後はfresh Codegraph reindex、coverage照合、全affected TODO recompileを行う。
20. irreducible conflictはprecedenceへ偽装せず、unordered conflictとintentional serial decisionを保持する。
21. event chainを保存bytesからreplayし、runtime stateと全decisionを再構成できる。
22. event改竄、欠落、重複、fork、未知kindをtyped rejectする。
23. event／artifact pathがtarget Codegraph coverageとplan identityへ混入しない。
24. actual executor 2以上でdispatch→観測→hold→vN+1→再dispatchを一度完遂する。
25. timeoutまたは中断したexecutorを同一handleで回収し、同一taskを重複起動しない。
26. TODO完了候補ごとにdiff、受入条件、related gate、手補正有無を親が一回確認する。
27. source収束後のrelated gateとPhase終了時のfull `npm run ci`を各一回実行する。
28. `npm run check`が新CLI／runtime production moduleを漏れなく検査する。
29. Phase反証で生き残るP0／P1 findingが0である。
30. accepted artifact、runtime evidence、新plan、最終Decisionが相互digestでbindされる。
31. event payloadへcredential、token、prompt全文、無関係な会話が混入しないことをredaction testで固定する。

## 反証・設計変更条件

- affected-only holdと全plan version barrierをcarry-over witnessで同時に説明できなければ、実装へ進まずADRを作り直す。
- 実diffからpath／resource relationを識別できない場合、後発競合検出を成功扱いせずtyped unknownへ戻す。
- runtimeがsummary boolean、executor自己申告、Codegraph空結果だけで継続を裁定するなら設計をrejectする。
- ready frontierのdispatch decisionを保存eventから再計算できなければdispatcherをrejectする。
- scripted条件の正解affected／hold／continue集合と一件でも違えばfixtureを都合よく変えずH1-RC3をrefuteする。
- 無関係TODO継続のためにstale contextを許容する経路があればP1として閉じる。
- canonical RC2 artifact、ADR、plan v5へwriteが必要なら加算module設計をやり直す。
- event store除外が`codegraph files`で確認できなければcampaignを開始しない。
- actual executorだけで再現しscripted executorで再現不能な結果は、provider差として分離しcore成功へ丸めない。
- runtime correctnessが不成立なら、wall-clockが改善していてもsupportしない。
- RC2 seam adapterをdisposable dogfood repoへ安全にbindできない場合は、accepted seam条件を黙って削らず、RC3-owned fixture／oracle／
  predeclared treatmentを加算設計する。契約自体が成立しない場合だけ新しいDecisionでscopeを再裁定する。

## Phase DAG

```text
RC3-A contract Decision + plan admission
  └─ RC3-B characterization safety net
       └─ RC3-C versioned runtime contracts + event verifier
            ├─ RC3-D generic front-end + plan CLI
            └─ RC3-E ready-frontier runtime + scripted executor
                  └─ RC3-F isolated executor + diff observer
                       └─ RC3-G late-conflict hold + carry-over + recompile
                            └─ RC3-H scripted closed-loop campaign
                                 └─ RC3-I actual multi-agent dogfood
                                      └─ RC3-J Phase gate
```

| node | classification | hard dependency | 主成果 | gate |
|---|---|---|---|---|
| RC3-A | F | ADR 0043／本plan | carry-over、ready frontier、event、claim boundary ADR | docs-only commit |
| RC3-B | F受入＋A test | RC3-A | RC2 replay、expected-red runtime controls | source前safety net |
| RC3-C | F契約＋A実装 | RC3-B | schema validator、canonical event chain、runtime verifier | corruption focused green |
| RC3-D | A | RC3-C | generic Codegraph/manual front-end、compile／verify CLI | 2 topology、fixture特判0 |
| RC3-E | F意味論＋A実装 | RC3-C | ready frontier、state projection、scripted executor | decision replay green |
| RC3-F | A | RC3-D＋RC3-E | isolated worktree adapter、diff observer、receipt | scope／stale focused green |
| RC3-G | F意味論＋A実装 | RC3-F | affected closure、hold、carry-over、barrier、recompile | injected conflict exact |
| RC3-H | F | RC3-G | multi-condition immutable campaign artifact | disk replay＋related green |
| RC3-I | H dispatch＋F受入 | RC3-H | actual executor 2+ dogfood | no duplicate、causal replay |
| RC3-J | F＋H final | RC3-I | full CI、Phase反証、support／refute ADR | P0／P1 0またはcorrection |

RC3-C完了後、RC3-DとRC3-Eはwrite scopeが非交差なら並列化できる。RC3-F以降はruntime contractとCLIを統合するため直列の
critical chainとする。source編集TODOは着手前にCodegraphでowned symbol／path、caller／callee、impact、affected tests、unknownを
exact照合する。

## TODO

### RC3-A — runtime契約を不変Decisionへ固定する

- [x] 本planをFable Highのread-only相談と親の反対仮説で再検証する。
- [x] current git、RC2 replay、Codegraph coverage、CLI surfaceをbaseline evidenceへ固定する。
- [x] carry-over witnessと「全plan失効／一部in-flight継続」の両立条件をexpected examplesで定義する。
- [x] minimum waveとready-frontier runtime dispatchを分離する。
- [x] path／resource binding、event order、freeze window、stale epoch、receipt帰属を定義する。
- [x] schema version、CLI command、executor adapter、artifact rootの所有境界を裁定する。
- [x] RC2 delivery-policy fixture／adapterの再利用可否と、RC3-owned dogfood fixture／oracle／predeclared treatmentの所有境界を裁定する。
- [x] ADR 0044へRC3 contract Decisionを固定し、既存ADRへ追記しない。
- [x] plan／ADR／baseline evidenceだけをpathspec付きdocs commitにする。

RC3-A成果: [ADR 0044](adr/0044-rc3-runtime-contract.md)（10 schema・event契約・rebind規則・再利用裁定、
異provider refuter 8 P1 objection全採用の反証記録を含む）、[RC3 baseline evidence](evidence/2026-07-16-rc3-baseline.md)。

### RC3-B — characterization safety netを先行する

- [x] RC1 v6とRC2 v1〜v4 artifact replayを互換baselineとして一回固定する。
- [x] 現CLIが`--version`／`doctor --json`以外をrejectする現挙動をcharacterizeする。
- [x] late conflict、scope violation、semantic unknown、stale receipt、carry-over欠落をexpected-redで固定する。
- [x] ready frontierがwave completionを待たずに次nodeをunlockするcaseをexpected-redで固定する。
- [x] event欠落、重複、fork、digest mismatch、unknown kindをexpected-redで固定する。
- [x] target repoへのevent store混入を`codegraph files`で検出するintegration safety netを置く。

RC3-B成果: green 7（互換replay 12／14／15／15／15 checks、CLI fail-closed characterization、event store scope
integration）、intentional expected-red 17（全件`ERR_MODULE_NOT_FOUND`のみ、対象は`src/runtime-event-store.mjs`と
`src/runtime-decision-verifier.mjs`）。詳細は[RC3 characterization safety net](evidence/2026-07-17-rc3-characterization-safety-net.md)。

### RC3-C — versioned runtime contractとevent verifier

- [x] RC2 schemaを変更せず、runtime schema validatorを加算moduleで実装する。
- [x] canonical event serialization、sequence、previous digest、actor／epoch bindingを実装する。
- [x] event prefixからruntime stateを再構成するprojectionを実装する。
- [x] dispatch／hold／continue／invalidate decisionをproducer非依存に再計算するverifierを実装する。
- [x] credential／prompt／無関係会話をevent payloadへ入れないredaction contractを実装する。
- [x] corruption focused testをgreenにし、手補正と未検証範囲を監査する。

RC3-C成果: 加算module 4（`src/runtime-contracts.mjs`／`src/runtime-event-store.mjs`／`src/runtime-projection.mjs`／
`src/runtime-decision-verifier.mjs`）。RC3-B expected-red 17は期待変更なしで全green化。異provider review
（codex-sidecar `review`、gpt-5.6-sol×high）の10 finding（P0×3・P1×6・P2×1）を全件採用し、fail-closed方向の
修正と敵対test 10件を加算した。RC3対象41 test green・`npm run check` pass。詳細は
[RC3 runtime contract実装](evidence/2026-07-17-rc3-runtime-contract-implementation.md)。

### RC3-D — generic front-endとplan CLI

- [ ] front-end source編集前Codegraph preflightを行う。
- [ ] `run_request.v1`のmanual path／resource／state／effect witnessをnormalized graphへcompileする。
- [ ] Codegraph raw telemetryとportable outcomeを分離し、exact symbol／pathを検査する。
- [ ] `plan compile`と`plan verify`をJSON stdin／stdout、typed stderr／exitで実装する。
- [ ] 2 fixture topologyを同じadapterでcompileし、fixture名／期待値分岐がないことを検査する。
- [ ] dogfood fixture source、fixed behavior oracle、predeclared seam treatment、candidate witnessをexpected-red先行で用意する。
- [ ] disposable repo内でallowed path、oracle、candidate、base、Codegraph query bindingを検証する。
- [ ] 9 TODO、unknown、query drift、affected test driftをtyped non-dispatchableにする。

### RC3-E — ready-frontier runtimeとscripted executor

- [ ] plan、accepted predecessor、running state、capacityからready frontierを計算する。
- [ ] synchronous wave barrierを要求せず、各dispatch decisionをeventへ保存する。
- [ ] provider非依存なexecutor adapter interfaceと決定論的scripted executorを実装する。
- [ ] dispatch、observe、checkpoint、hold request、terminal reportの状態遷移を実装する。
- [ ] timeoutをunknownとして同一handle回収し、重複dispatchを拒否する。
- [ ] runtime decision verifierで全dispatch prefixを再計算する。

### RC3-F — isolated worktree executorとdiff observer

- [ ] source編集前にworktree／git／Codegraph ownership boundaryをpreflightする。
- [ ] canonical worktreeを直接変更しないdisposable worktree provision／cleanupを実装する。
- [ ] executor packetへtask、scope、base、plan epoch、verifier、禁止操作をbindする。
- [ ] checkpoint diffをbounded canonical recordへ変換する。
- [ ] observed pathをdeclared path／resourceへcross-bindし、scope外writeを検出する。
- [ ] receiptのhandle／worktree／base／epoch／checkpoint欠落とstale値をrejectする。
- [ ] cleanup failureを成功へ丸めず、残存pathと回収条件を記録する。

### RC3-G — 後発競合、selective hold、recompile

- [ ] event intake freezeと後着eventの順序契約を実装する。
- [ ] path／semantic／effect／scope／stale kindごとのaffected closureを計算する。
- [ ] hold decisionへfinding、hold／continue集合、根拠event digestを保存する。
- [ ] carry-over witnessを独立verifierで再計算し、証明不能TODOをholdへ戻す。
- [ ] epoch rebind packetとrebind eventを発行し、rebind前後のreceipt epoch規則を検証する。
- [ ] accepted checkpointまたはseam artifactをpredecessorにplan vN+1をcompileする。
- [ ] old plan、agent context、partial patch、interface assumption、boundary evidenceを失効する。
- [ ] carried-over TODOとredispatch TODOへ異なる新context packetを発行する。
- [ ] irreducible conflictをintentional serial、predeclared seamをtransform laneへ送る。

### RC3-H — scripted closed-loop campaign

- [ ] 8 conditionを同一base、同一request、同一runtime identityで実行する。
- [ ] clean／late conflict／scope／semantic unknown／stale／serial／seam／corruptionを保存する。
- [ ] 正解affected／hold／continue集合と実測を比較する。
- [ ] event、receipt、plan diff、Codegraph、test、cost／reworkをartifactへ保存する。
- [ ] immutable artifact rootへatomic no-overwrite発行する。
- [ ] artifact-only verifierで全decisionを保存bytesから再計算する。
- [ ] related gateを一回実行し、失敗scopeだけを収束させる。

### RC3-I — actual multi-agent dogfood

- [ ] actual dispatch前にH gate、provider、quota、Control budget、回収手順を確認する。
- [ ] actual executor 2以上へ非交差taskを隔離dispatchする。
- [ ] known late conflictを注入し、affected holdと無関係継続を観測する。
- [ ] stale receipt、timeout recovery、重複dispatch拒否を一度ずつ観測する。
- [ ] vN+1へcarry over／redispatchし、最終artifactを受入する。
- [ ] scripted campaignとの差をprovider runtime observationとして分離する。
- [ ] wall-clock、queue、review、rework、retry、rollbackを未実測0へ丸めず保存する。

### RC3-J — Phase gate

- [ ] maintenance queueの再現項目をdedupし、P0／P1だけをPhase gate前に閉じる。
- [ ] source収束後のfull `npm run ci`を一回実行する。
- [ ] Fable Highをread-onlyの反証相談へ使い、親がfindingを実コードと証拠で裁定する。
- [ ] H1-RC3と全成功条件を対象にPhase反証を一回行う。
- [ ] P0／P1が無ければsupport範囲とnon-goalを新しいADRへ固定する。
- [ ] 実問題があれば完了扱いせず、correction versionと新ADRを立てる。
- [ ] plan、evidence、Control、artifact、testが全て完了してからarchiveする。

## Controlと配置

- 本planのdocs-only commit後、execution開始前に新しいElastic Controlを初期化する。
- riskはhigh、behavior laneはbehavior-preservingを既定とし、挙動修正は別Decisionを要求する。
- Fは親が直接裁定する。Aは仕様、書込scope、gateが固定できた時だけ委譲する。
- Hはactual external executor dispatch、credential／login、canonical外write、publish／push／remote、本番effectである。
- Claude-pのFable HighはLattice内read-only相談に限定し、Worker、writer、独立受入者として数えない。
- Fable相談は少なくともplan設計、runtime contract収束、Phase反証の3点で使い、同一論点の反復相談を増殖させない。
- Consultation handle、model、effort、terminal成否だけをControlへ記録し、prompt全文や会話をartifactへ保存しない。
- worker／consultation／campaign予算はControl init時に上限を固定し、sidecar等で迂回しない。
- 外部executorへcommit、push、branch切替、merge、rebase、reset、stash、他者変更revertをさせない。

## テストと監査の頻度

- Phase開始時にfull baselineを一回取る。同一source digestの直近greenを再利用できる場合は根拠を記録する。
- 実装中は変更契約に直結するfocused testだけを回す。
- TODO完了候補でrelated gateと親の軽量監査を一回行う。
- failure修正中は失敗scopeだけを再実行する。
- source収束後のrelated gateを一回、Phase完了時のfull regressionを一回行う。
- 重い独立反証はPhase完了候補で一回に集約する。
- actual executorごとにfull suiteを回さず、親の統合gateへ集約する。

## Evidence artifact

RC3は少なくとも次をLattice内へ保存する。

- baseline source／CLI／Codegraph／RC1・RC2 replay receipt。
- versioned request、manual witness、query set、portable Codegraph outcome。
- runtime plan、ready-frontier dispatch decisions、event chain、state projection。
- executor packet／receipt、checkpoint diff、scope／resource binding。
- conflict finding、affected closure、hold／continue、carry-over witness。
- old→new plan diff、invalidated context、carried-over／redispatched packets。
- accepted／rejected seamまたはintentional serial decision。
- scripted campaign全条件とartifact-only verification。
- actual dogfood observation、timeout recovery、重複dispatch rejection。
- focused／related／full gate、maintenance、Phase反証、最終Decision。

event、artifact、Control stateはLattice所有pathへ置き、dotagents、Observer、Claude管理directoryへ書かない。

## 既知の罠

- Codegraph fuzzy解決または空結果をexact dependencyなしと誤読する。
- event／identity sourceがpost-publication indexへ混入する。
- active planへ追記して過去receipt／Decision digestを失効させる。
- wave metricを同期runtime barrierとして実行する。
- affected-only holdを理由にstale contextを継続する。
- diff path overlapだけでsemantic／effect conflictなしと断言する。
- process exitだけでClaude-p／executorのterminal成否を判断する。
- timeout後に同じtaskを新handleで重複dispatchする。
- `npm run check`の列挙へ新production moduleを追加し忘れる。
- Lattice自身をdogfood targetにし、runtime event書込と対象source観測を自己干渉させる。
- zshの連動変数`path`等を検証shellの一時変数へ使い、実行環境のPATHを壊す。

## Non-goals

- requirements／自然言語からTODO ownershipまたはseamを自動発見したと主張しない。
- 新しいseam classの自動生成、任意repo成功率、一般的wall-clock改善率を完成させない。
- 9 TODO以上のexact／feasible scheduler、heuristic schedulerを実装しない。
- signing、remote attestation、malicious executor、敵対的PATH差替えを扱わない。
- GUI、Web service、MCP server、production deploymentをRC3へ含めない。
- dotagents／Observerへ導入配線を書かず、両repoを編集しない。
- remote作成、push、publish、本番effect、credential／loginを暗黙実行しない。

## Plan作成時の相談記録

2026-07-16、Claude Code `-p`のFable、effort HighをLattice cwdでread-only相談に使用した。Fableは主要論点として、
carry-over witness、ready-frontier dispatch、path／resource binding、event store index隔離、識別可能なconflict injection、
`npm run check` coverageを提示した。親はこれらを採用した。

Fableが提案した9 TODO以上のfeasible-only modeは、runtime feedback loopと別のclaim変更であるためRC3から除外した。
actual dogfoodが自然発生競合を待つ案も棄却し、scripted campaignを主実験、actual executorを外的妥当性観測に置いた。

本planの最終採用、実装受入、Phase support／refuteはFableへ委ねず、親が実コード、diff、test、artifactから裁定する。
