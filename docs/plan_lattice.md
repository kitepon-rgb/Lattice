# Lattice 実装計画

- 状態: Active
- 更新日: 2026-07-16
- 現在のplan version: `lattice-research-campaign-1-v6`
- predecessor: `lattice-research-campaign-1-v5`（[Phase-rejected archive](archive/2026-07-16-plan-lattice-research-campaign-1-v5-phase-rejected.md)、SHA-256 `31edaf03f00e1b0600e9a63b9f556c527dfde9428a451a68563d0c86afc2b7a3`）
- v5 Phase gate Decision: [ADR 0028](adr/0028-rc1-v5-phase-gate-rejection.md)
- v5 immutable mechanism record: [ADR 0027](adr/0027-rc1-v5-immutable-closed-loop-accepted.md)
- RC1 root Decision: [ADR 0002](adr/0002-research-campaign-1-closed-loop.md)
- 製品思想: [../PLAN.md](../PLAN.md)
- 公開契約: [00_product-contract.md](00_product-contract.md)

## Plan version diff

v5は、同じboundary compiler、accepted production＋test seam、control／treatment各2 fresh Codegraph run、
shared-state negative、隔離worktree、再compile、immutable artifact writerを接続した。実測はcontrolのwrite conflict 3、
test-write conflict 1、2 wavesからtreatmentの0、0、1 waveへ変化し、negativeはstate conflict 1、2 wavesを保持した。
この閉ループ機構と保存bytesは削除・上書きしない。

しかしv5 Phase gateでは、保存artifact全体を依存digestごと再封印しても、保存oracleと無関係な`oracle_digest`と、
`expected_digest != observed_digest`のcaseを`passed`のままfull verifierが受理した。また各Codegraph runは
`code_snapshot_digest`の64桁形式を検査するだけでsnapshot preimageへbindされず、plan diffはv5のaccepted transform、
behavior envelope、evidence bundleを実predecessor digestとして持たない。したがってH1-v5 supportは非識別であり、
成功条件8、11〜13を満たさない。

v6はv5 topologyへ追記しない。v5 machine support、comparison、plan diff、agent context、partial patchをactive predecessorから
失効する。accepted seam、2+2 reindex、single compiler、negative control、source invariant、cleanupはmechanism evidenceとして保持し、
oracle semantics、runtime identity、snapshot preimage、Codegraph identity、plan predecessorをtyped artifactへcross-bindして全条件を
immutable v6 artifactへ再発行する。

full CIの3 failureも製品findingへ混ぜない。2件は並列testがcanonical repo全体のtemporary worktree集合を共有するtest harness競合、
1件はimmutable v4 artifact rootをcanonical repoへ再発行するstale testである。専用cloneへ隔離してPhase gateを修復する。

Observer fixtureとdotagents統合は引き続き後続であり、v6の内的妥当性を外部dogfoodで埋めない。

## Research Campaign 1 v6 correction

### 核心仮説と対立仮説

- **核心仮説 H1-v6:** 同じbase、boundary compiler、candidate spec、TODO outcome、manual state／effect evidence、query set、
  capacity、Codegraph executable identity、black-box oracle、oracle runtime identityへ、accepted production＋test seamだけを独立変数として
  加えると、外部挙動を保ったまま全shared writeを除去し、hard precedenceを増やさずminimum feasible wavesを2から1へ減らせる。
  この因果鎖は、oracle expected case、runtime、fixed surface、Codegraph snapshot preimage、raw query evidence、patch、transform、
  predecessor artifactを保存bytesだけから再計算して識別できる。
- **対立仮説 H0-a:** production、test、schema、state、effect、semantic resourceのいずれかがseam後も共有され、1 waveにならない。
- **対立仮説 H0-b:** conflict減少はcondition別compiler、candidate／query／Codegraph version drift、missing evidenceのsafe defaultによる
  測定器artifactである。
- **対立仮説 H0-c:** transformがblack-box behaviorを変えるか、保存receiptが別oracle、任意case、別runtimeのgreenを受理する。
- **対立仮説 H0-d:** raw Codegraph evidenceが保存snapshot以外から得られてもrecompile chainが通り、seamへ因果帰属できない。
- **対立仮説 H0-e:** v4／v5 archive、accepted transform、behavior envelope、evidence bundleの実bytesを変えてもversion barrierが通る。
- **対立仮説 H0-f:** full CIの一時worktree競合またはimmutable artifact再発行が実験失敗へ混入し、Phase判定を識別できない。

### Experimental conditions

- **control condition:** monolithic production symbolとpolicy-specific shared test expectationを変換せず、fixed query setで2回fresh
  indexし、single boundary compilerへ入力する。各runはbase fixed surface snapshot preimage、digest、Codegraph identity、raw query
  evidenceを一つのevidence bundleへbindする。
- **treatment condition:** 同じbaseへaccepted production＋test seam patchだけを加えたdisposable worktreeを、同じquery set、
  compiler、manual evidence、capacity、Codegraph identity、oracle、runtimeで2回fresh index／compileする。各runのsnapshotはaccepted
  transform outputから再構成する。
- **independent variable:** accepted seam transformation artifactの有無。compiler identity、candidate spec、TODO outcome、manual evidence、
  query set、capacity、oracle、oracle runtime、Node identity、Codegraph version／executable identityは条件間で固定する。
- **negative control:** normalと同じsnapshot／compilerへ両TODOのshared `dispatch-registry` state writeを与え、pathとtestを分離しても
  serialを保持する。
- **corruption controls:** oracle digest、case ID／順序／件数／expected／observed／outcome、runtime identity、snapshot preimage／digest、
  Codegraph identity、raw evidence、patch、transform、predecessor digest、manifest payloadを依存digestごと再封印しても全てrejectする。

### 測定指標

| 指標 | control | treatment success |
|---|---|---|
| boundary compiler identity | fixed source digest | 同一digest |
| Codegraph identity | version＋executable identity固定 | 同一identity |
| production write overlap | 実測 | 0 |
| test／schema／artifact write overlap | 実測・省略禁止 | 0 |
| total write conflict records | 実測 | 0 |
| hard precedence | 実測 | 増加なし |
| minimum feasible waves（capacity 2） | 2以上を実測 | 1 |
| unknown | graph／manual provenance付き | hidden unknown 0 |
| behavior cases | oracleから再計算した完全列 | 全case expected=observed |
| oracle runtime | Node／flags／executor source digest | 同一identity |
| code snapshot | typed preimage＋digest | transform outputから再構成一致 |
| raw Codegraph evidence | snapshot-bound 2 run | snapshot-bound 2 run |
| negative shared state | serial | serial |
| predecessor set | v5 reject実体 | transform／behavior／bundle実digestを追加 |
| artifact-only predicate | underlying artifactから再計算 | corruption全reject |
| source invariant | typed protected scope receipt | drift 0 |
| full CI | isolated integration harness | pass |

actual wall-clock、index／query、compile、review、rework、rollbackも記録する。v6も単一fixtureであり、任意repoの成功率や
一般的速度改善率は主張しない。

### 成功条件

1. control／treatmentが同じexported boundary compilerと同じfixed inputを使い、condition-specific branchを持たない。
2. compilerはexact graph outcome、manual state／effect、typed unknownから全TODOのwrite intersectionとconflictを導出する。
3. controlはproduction＋test shared boundaryをtyped conflictにし、empty／absent／unresolvedをindependenceへ丸めない。
4. accepted transformはproduction concernとfuture TODO-owned testを分離し、transform scope外の固定oracleがpre／postでgreenになる。
5. treatmentはshared write conflict 0、hidden unknown 0、hard precedence増加なし、minimum feasible waves 1である。
6. shared-state negativeはstate conflictと2 wavesを保持する。
7. control／treatment各2 fresh runについて、fixed surface snapshot preimageとdigest、Codegraph identity、raw／portable query evidence、
   patch identityを同じbundleへ保存し、controlはbase、treatmentはtransform outputからsnapshotを独立再構成できる。
8. pre／post oracle receiptを別payloadとして保存し、保存oracleからcase ID、順序、件数、expected kind、expected digestを再計算する。
9. `passed` caseは`expected_digest === observed_digest`を必須とし、overall outcomeをcase結果だけから再計算する。
10. Workerの`execArgv`と必要envを明示固定し、Node version、runtime flags、oracle executor source digestをreceiptへbindする。
11. behavior envelopeはsaved oracle digest、full receipt、runtime、transform artifact、patch、pre／post surfaceをcross-bindする。
12. Codegraph version／executable identityはfixed inputと全4 raw status、evidence bundle、comparison、executionでexact一致する。
13. artifact writerは全typed preimageをmanifestへ含め、full verifierはsummaryや自己申告digestを信頼せず保存bytesから再計算する。
14. new plan diffはv5 rejected archive／Decision、accepted transform、behavior envelope、4 evidence bundle descriptorをdigest付きpredecessor集合に持つ。
15. oracle、case、runtime、snapshot、Codegraph identity、raw evidence、predecessorの依存digest再封印corruptionをsemantic checkでrejectする。
16. canonical source／HEAD／既存worktreeを変えずimmutable v6 artifactを発行し、focused／related収束後のfull `npm run ci`がgreenになる。

### 反証・設計変更条件

- compiler、candidate、query、manual evidence、capacity、oracle、runtime、Codegraph identityのいずれかが条件間で違えばrunをrejectする。
- receiptのoracle digestが保存oracle digestと違う、case集合が完全一致しない、またはpassed caseのdigestが違えばbehaviorをrejectする。
- runtime flagsを暗黙継承する、Node／executor identityを保存できない、実行前後surfaceが違う場合は観測をrejectする。
- raw Codegraph evidenceをfixed snapshot preimageへbindできない、またはtreatment snapshotをtransform outputから再構成できなければ
  recompile結果をseamへ帰属しない。
- shared test、generated artifact、state／effect conflictが残れば1 waveを主張せず、追加seamまたはjoin TODOへplanを変更する。
- negative controlがparallelになればboundary compilerをrejectする。
- predecessor artifactを一件変えてもplan diffが通るならversion barrier schemaをrejectする。
- protected canonical scopeへcontent drift、worktree leak、partial artifactがあればacceptedへ丸めない。
- full CI harnessが別testのtemporary resourceを自分の所有物として比較するなら、製品sourceではなくtest isolationを修正する。
- v6実測が1 waveまたはartifact-only因果bindingを支持しなければfixtureを都合よく変えず、H1-v6を反証して次versionへ再compileする。

## Hard dependencyと並列研究lane

```text
RC1-S v5 Phase reject + v6 plan
  ├─ RC1-T full CI harness isolation
  └─ RC1-U causal-binding characterization safety net
       ├─ RC1-V1 oracle semantics + runtime identity ─────┐
       └─ RC1-V2 snapshot + Codegraph identity ──────────┴─ RC1-W artifact chain + version barrier
                                                               └─ RC1-X immutable v6 reissue
                                                                    └─ RC1-Y Phase gate
```

| node | hard dependency | lane／effect | evidence artifact | gate |
|---|---|---|---|---|
| RC1-S | v5 full CI＋Phase P1 | F: 親直轄／Decision・docs write | ADR 0028、v5 archive、plan v6 | sourceなし独立commit |
| RC1-T | full CIの3 failure | F: Phase gate isolation／test write | 3 scope単独characterization | dedicated clone＋focused green |
| RC1-U | ADR 0028の再封印反例 | F: artifact identity契約／test-first | oracle／case／snapshot／predecessor expected-red | Codegraph preflight＋expected red |
| RC1-V1 | RC1-U oracle red | F: observation identity／source write | semantic receipt＋runtime receipt | exact oracle cases＋fixed Worker runtime |
| RC1-V2 | RC1-U snapshot red | F: measurement identity／source write | snapshot-bound evidence bundle | base／transform projection＋Codegraph identity |
| RC1-W | V1＋V2 | F: causal artifact／source write | v6 verifier、plan diff v3 | dependency-reseal corruption green |
| RC1-X | RC1-T＋W related green | F: experiment execution／artifact write | immutable v6 2+2 campaign | source invariant＋disk replay |
| RC1-Y | RC1-X immutable evidence | F親裁定 | full CI、Phase evidence、Decision | Phase audit 1回 |

RC1-V1とV2はRC1-Uが固定した契約を変えず、非交差source／test scopeにできる範囲だけ並列研究する。schema、fixed surface、
oracle、query setの変更は親直轄で新plan versionを要求し、lane内の便宜で書き換えない。

## TODO

### RC1-S — v5をrejectしv6へ再compileする

- [x] full CIを一回実行し、87 pass／3 failを実験findingへ丸めず保存する。
- [x] refuter／Critic reportをControlへimportし、親の再封印実験でfindingの実在性と価値を確認してacceptする。
- [x] oracle substitution、false-passed case、snapshot preimage欠落、plan predecessor欠落を親が独立裁定する。
- [x] ADR 0028とPhase evidenceでmachine supportの失効とmechanism evidenceの保持を固定する。
- [x] v5 planをSHA-256付きPhase-rejected archiveへ移し、active topologyをv6へ全再compileする。
- [x] plan／ADR／evidence更新だけを独立commitにし、source／test変更を混ぜない。

### RC1-T — full CI harnessを並列安全にする

- [x] source編集前にCodegraphで3 integration testのowned path／symbol、caller／callee、impact、affected test、unknownを確認する。
- [x] 3 failure scopeを単独実行し、2件greenの並列干渉と1件redのimmutable root再発行を識別する。
- [ ] control portabilityを専用cloneへ隔離し、canonical repo全worktree集合を所有物として比較しない。
- [ ] treatment recompileはclone内worktreeだけをexact比較し、canonical repoはHEAD／status不変だけを検証する。
- [ ] v4 campaign writerを専用cloneの空artifact rootへ発行し、canonical immutable artifactを再発行しない。
- [ ] 3 focused scopeを一回greenにし、full gateはRC1-Yまで再実行しない。

### RC1-U — causal-binding characterizationを先に置く

- [ ] source編集前に対象symbolのCodegraph preflightを更新する。
- [ ] oracle digestとfalse-passed caseを全依存digestごと再封印してもv5 verifierが通る反例をtestへ固定する。
- [ ] case欠落／追加／並替え、runtime drift、snapshot substitution、Codegraph version drift、predecessor substitutionをexpected-redにする。
- [ ] characterizationだけを独立commitする。

### RC1-V1 — oracle semanticsとruntime identity

- [ ] 保存oracleからexact case列とexpected kind／digestを導出し、receiptへ照合する。
- [ ] passed iff expected digest equals observed digestを強制し、overall outcomeを再計算する。
- [ ] Worker execArgv／envを明示固定し、Node／flags／executor source digestを保存する。
- [ ] pre／post receiptとbehavior envelopeをsaved oracle／runtimeへcross-bindする。

### RC1-V2 — snapshotとCodegraph identity

- [ ] 全4 runへfixed surface snapshot preimage／digestを保存する。
- [ ] control snapshotをbase surface、treatment snapshotをaccepted transform outputから独立再構成する。
- [ ] raw／portable Codegraph evidence、snapshot、condition、base、patch、Codegraph identityを同じbundleへbindする。
- [ ] compiler replayが自己申告snapshot digestを注入せず、bundle preimageから導出するようにする。

### RC1-W — artifact chainとversion barrier

- [ ] v6 exact artifact setとartifact-only verifierを実装する。
- [ ] Codegraph identityをfixed input／全run／comparison／executionへ固定する。
- [ ] plan diff predecessor集合へv5 archive／Decision、transform、behavior envelope、4 bundle descriptor digestを保存する。
- [ ] dependency-reseal corruption全件をsemantic checkでrejectする。
- [ ] focused収束後にrelated testを一回だけ実行する。

### RC1-X — immutable v6 closed loopを再発行する

- [ ] v6 control／treatment各2 fresh indexを同じquery set、compiler、Codegraph identityで実行する。
- [ ] normal／negativeを同じcompilerへ通し、conflict、hard precedence、waves、unknownを比較する。
- [ ] oracle／runtime、snapshot-bound evidence、compiled artifact、plan diffを`artifacts/v6`へatomic保存する。
- [ ] disk再読込full verifierで全relationを再計算し、v5 artifactを上書きしない。

### RC1-Y — v6 Phase gate

- [ ] TODO単位の軽量監査を各完了候補で一回だけ行う。
- [ ] source収束後のfull `npm run ci`を一回だけ実行する。
- [ ] v6成功条件だけを対象にPhase反証を一回行う。
- [ ] H1-v6をsupport／refuteする不変DecisionとPhase evidenceを残す。

## Evidence artifact

v6は少なくとも次をLattice内へ保存する。

- v5から固定継承するcandidate spec、query set、TODO outcome、manual state／effect、test-write provenance、oracle input。
- pre／post behavior receipt、oracle exact case列、runtime identity、fixed surface typed preimage／digest。
- control／treatment各2 runのsnapshot preimage、Codegraph identity、raw／portable evidence、sanitized diagnostic。
- accepted transform、patch、base／output projection、behavior envelope、snapshot-bound evidence bundleのcross-binding。
- single compiler identity、resolved production／test owns、writes、unknown、conflict derivation trace。
- control／treatment／negativeのmanifest、verdict、plan、comparison、underlying-artifact hypothesis evaluation。
- source invariant、cleanup、v5→v6 plan diff、digest付きpredecessor集合、intervention時間、review、rework、rollback、未検証範囲。
- corruption caseごとのexpected／actual semantic rejectionとdisk artifact verifier receipt。

machine artifactは`research/campaigns/rc1/artifacts/v6`へ新規保存し、v4／v5 artifactを上書きしない。raw telemetryと絶対pathを
plan identityへ入れず、sanitization methodとtyped preimageを独立に監査可能にする。

## Non-goalsとwriter境界

- v6では任意repo向けgoal decomposition、汎用seam synthesis、最適scheduler、actual multi-agent dispatchを完成させない。
- 単一fixtureから一般的速度改善率、任意repo成功率、製品価値、新規性、freedom-to-operateを主張しない。
- v5のaccepted mechanismを失敗へ丸めず、Phase-level causal supportとの境界だけを修正する。
- receiptを署名・remote attestationへ拡張しない。RC1のcooperative isolated-worktree threat modelに限定する。
- Observerをfixtureにせず、Observer関連repoを編集しない。Observer dogfoodはv6 Phase gateのhard dependency後に限る。
- dotagents repoはread-only参照のみ。Control stateはLatticeの`.git/`、artifactはLattice repo内に置く。
- remote作成、push、publish、credential／login、production／external effectは行わない。
