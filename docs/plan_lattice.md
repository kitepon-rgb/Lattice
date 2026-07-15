# Lattice 実装計画

- 状態: Active
- 更新日: 2026-07-15
- 現在のplan version: `lattice-research-campaign-1-v4`
- predecessor: `lattice-research-campaign-1-v3`（[Phase-rejected archive](archive/2026-07-15-plan-lattice-research-campaign-1-v3-phase-rejected.md)、SHA-256 `13a5ffa8580ac54dd1b63a556736b7fa888010483780660029cb938399a9baf7`）
- Phase gate Decision: [ADR 0016](adr/0016-rc1-v3-phase-gate-rejection.md)
- RC1 root Decision: [ADR 0002](adr/0002-research-campaign-1-closed-loop.md)
- Portability Decision: [ADR 0012](adr/0012-portable-codegraph-evidence-and-rc1-v3.md)
- 製品思想: [../PLAN.md](../PLAN.md)
- 公開契約: [00_product-contract.md](00_product-contract.md)

## Plan version diff

v3はproduction seam、隔離worktree、same-query fresh index、negative state control、plan diffまで接続したが、Phase gateで
`supported_in_fixture`をrejectした。controlとtreatmentが別compilerを使う測定器交絡、future TODOのshared test-write脱落、
fresh Codegraph outcome preimage欠落、success predicate不足、bounded source-invariant gapが実コードで再現したためである。

v4はv3 topologyへ追記しない。v3 comparison、plan v2、causal agent context、partial patch、interface assumptionをactive
dispatch predecessorから失効し、accepted production transformとdigest chainだけをhistorical mechanism evidenceとして引き継ぐ。
同じboundary compiler、production＋test seam、保存可能なevidence preimageでcontrol／treatmentを再発行する。

Observer fixtureとdotagents統合は引き続き後続であり、v4の内的妥当性を外部dogfoodで埋めない。

## Research Campaign 1 v4 correction

### 核心仮説と対立仮説

- **核心仮説 H1-v4:** pre／post snapshotへ同じboundary compiler、candidate spec、manual evidence、query set、capacity、
  black-box behavior oracleを適用し、productionとfuture TODOがwriteするtest architectureの両方へaccepted seam変換を加えると、
  全shared write resourceを除去し、hard dependencyを増やさずcapacity 2のminimum feasible wavesを1へできる。
- **対立仮説 H0-a:** production seam後もtest、schema、state、effect、semantic resourceのいずれかが共有され、1 waveにはできない。
- **対立仮説 H0-b:** conflict減少はcondition別rule、candidate／query drift、missing evidenceのsafe defaultによる測定器artifactである。
- **対立仮説 H0-c:** test seamがbehavior oracleも同時に書き換え、behavior preservationを独立に検証できない。
- **対立仮説 H0-d:** full portable outcome payloadからexact resolution／digestを再計算できず、再indexの主張を独立監査できない。

### Experimental conditions

- **control condition:** monolithic production symbolとpolicy-specific shared test expectationを変換せず、v4 fixed query setでfresh indexし、
  single boundary compilerへ入力する。
- **treatment condition:** 同じbaseへaccepted production＋test seam patchだけを加えたdisposable worktreeを、同じquery set、
  compiler、manual evidence、capacity、black-box oracleでfresh index／compileする。
- **independent variable:** accepted seam transformation artifactの有無。compiler identity、candidate spec、TODO outcome、
  manual evidence、query set、capacity、oracle、Codegraph versionは条件間で固定する。
- **negative control:** normalと同じsnapshot／compilerへ両TODOのshared `dispatch-registry` state writeを与え、pathとtestを
  分離してもserialを保持する。

candidate specは各TODOについて、現anchor production／test surfaceとproposed production／test surfaceを同時に固定する。
single compilerはcondition名を受け取らず、exact graph outcomeからどのsurfaceが存在するかを解決し、同じwrite-intersection演算で
conflictを導出する。期待conflict数を入力しない。

### 測定指標

| 指標 | control | treatment success |
|---|---|---|
| boundary compiler identity | fixed digest | 同一digest |
| production write overlap | 実測 | 0 |
| test／schema／artifact write overlap | 実測・省略禁止 | 0 |
| total write conflict records | 実測値を採る | 0 |
| hard precedence | 実測 | 増加なし |
| minimum feasible waves（capacity 2） | 2以上を実測 | 1 |
| unknown | graph／manual provenance付き | 0へなるなら各解消根拠あり |
| behavior preservation | transform外black-box oracle green | 同一oracle green |
| negative shared state | serial | serial |
| portable evidence | runごとのfull preimage＋digest | 独立再計算一致 |
| diagnostic evidence | sanitized payload＋sanitization manifest | 絶対pathなし |
| success predicate | 全条件truth table | single-field corruptionを全reject |
| source invariant | typed protected scope receipt | drift 0 |

actual wall-clock、index／query、compile、review、rework、rollbackも記録する。v4も単一fixtureであり、任意repoの成功率や
一般的速度改善率は主張しない。

### 成功条件

1. control／treatmentが同じexported boundary compilerと同じcandidate specを使い、condition-specific branchを持たない。
2. compilerはgraph evidenceからresolved ownershipとunknownを導出し、全TODOのwrite resource交差からconflictを作る。
3. controlではproductionとtestを含む実在shared boundaryがtyped conflictになり、空／absent／unresolvedをindependenceへ丸めない。
4. accepted transformはproduction concernとfuture TODOのwrite testを分離する。変換scope外の固定black-box oracleがpre／postでgreen。
5. treatmentはshared write conflict 0、hidden unknown 0、hard precedence増加なし、minimum feasible waves 1である。
6. shared-state negativeはstate conflictと2 wavesを保持する。
7. 2 fresh control runと2 fresh treatment runのcanonical portable payloadを保存し、per-query／aggregate digestをartifactだけから再計算できる。
8. sanitized diagnostic payloadは除外／置換fieldをversioned manifestへ列挙し、絶対pathを含まず、opaque raw receiptと役割を分ける。
9. machine success predicateは宣言済み条件を全て検査し、各一条件だけを壊すtestでfalse supportを拒否する。
10. source invariantはHEAD、git-visible status、ignored path集合、protected source／test scopeのcontent fingerprintを分けて記録する。
11. new plan diffはv3 causal artifactsとcontextを失効し、v4 accepted transformとevidence bundleをpredecessorに持つ。

### 反証・設計変更条件

- pre／postでcompiler export、compiler source digest、candidate spec、query set、manual evidence、capacity、oracleのいずれかが違えば
  非識別としてartifactをrejectする。
- shared testまたはgenerated artifactのwriteが残れば1 waveを主張せず、追加seamまたはjoin TODOへplanを変更する。
- transformed testだけがoracleになっていればbehavior gateをrejectし、transform scope外oracleを先に固定する。
- portable payloadが欠落、digest不一致、unknown fieldの暗黙drop、sanitization manifest外の削除を起こしたrunは再compileへ進めない。
- affected testがsharedでもwrite不要と分類する場合、TODO outcomeとtest assertionを照合したmanual provenanceを必須にする。
- negative controlがparallelになればboundary compilerをrejectする。
- protected canonical scopeへcontent driftがあればartifactをrejectし、cleanup成功へ丸めない。
- v4実測が1 waveを支持しなければfixtureを都合よく変えず、H1-v4を反証してplan topologyを再compileする。

## Hard dependencyと並列研究lane

```text
RC1-G2 v3 Phase reject + v4 plan
  └─ RC1-H identifiability characterization safety net
       ├─ RC1-I single boundary compiler lane ───────────────┐
       ├─ RC1-J production + test seam / oracle lane ───────┼─ RC1-L corrected control/treatment reissue
       └─ RC1-K evidence preimage + source invariant lane ──┘       └─ RC1-M correction Phase gate
```

| node | hard dependency | lane／effect | evidence artifact | gate |
|---|---|---|---|---|
| RC1-G2 | v3 full CI＋independent reject | F: 親直轄／docs write | ADR 0016、v3 archive、plan v4 | 独立commit |
| RC1-H | ADR 0016＋v3 failing surfaces | F: 実験契約／test-first | v4 candidate spec、query set、black-box oracle、red tests | Codegraph preflight＋expected red |
| RC1-I | RC1-H shared measurement contract | F: boundary semantics／source write | single compiler、derivation trace | same function pre／post＋corruption tests |
| RC1-J | RC1-H fixed oracle | F: isolated transform／fixture patch | production＋test seam artifact | transform外oracle＋scope＋cleanup |
| RC1-K | RC1-H evidence contract | F: evidence／runner source write | full portable、sanitized diagnostic、source receipt | preimage再計算＋path scrub |
| RC1-L | RC1-I＋J＋K | F: correction integration／artifact write | corrected control、treatment、comparison、plan diff | 2 fresh run／condition |
| RC1-M | RC1-L related green | A: read-only correction audit＋F親裁定 | focused refutation、full CI、Decision | P1 correction再監査1回 |

RC1-I／J／KはRC1-Hが固定したschemaと入力を変更せず、非交差source scopeにできる範囲だけ並列に進める。
candidate spec／query set／oracleの変更は親直轄で新plan versionを要求し、lane内の便宜で書き換えない。

## TODO

### RC1-G2 — v3 Phase rejectとplan v4

- [x] full `npm run ci`をPhase gateで1回実行し、49 pass / 0 fail / 0 skipとworkspace不変を記録する。
- [x] Find lane 7→6、Critic 9、cross-lane 16→11 familyをdedupし、supported 5／refuted 6を親裁定する。
- [x] ADR 0016でv3 causal acceptanceをrejectし、生き残ったmechanism evidenceと失効artifactを分離する。
- [x] 監査結果を`docs/evidence/`と`rag/`へ還流する。
- [x] v3 planをPhase-rejectedとしてarchiveし、active topologyをv4へ全再compileする。

### RC1-H — correction characterizationを先に置く

- [ ] source編集前にCodegraphでplanned owned symbol／path、caller／callee、impact、affected test、unknownを再確認する。
- [ ] v3 findingごとに、現実装が失敗する最小characterization testを先に追加する。
- [ ] conditionを受け取らないcandidate spec v2とfixed query set v2をversioned inputへ固定する。
- [ ] transform scope外black-box behavior oracleと、future TODOのtest write ownership provenanceを固定する。
- [ ] focused testが測定器交絡、shared test-write、missing preimage、incomplete predicate、protected ignored driftを赤にすることを記録する。
- [ ] safety-netだけを独立commitする。

### RC1-I — single boundary compiler

- [ ] control／treatmentのduplicate manifest／verdict／plan derivationをsingle compilerへ置換する。
- [ ] exact graph outcomeからanchor／proposed production＋test surfaceを解決し、writes intersectionからconflictを導出する。
- [ ] graph absence／empty／unresolvedとmanual state／effect／unknownを同じtyped ruleで扱う。
- [ ] conflict数やunknown数のexpected constantをcompiler input／condition branchへ持たせない。
- [ ] single-field corruptionとnegative stateのfocused gateをgreenにする。

### RC1-J — production＋test seamと固定oracle

- [ ] current behaviorを変換scope外oracleで固定したまま、policy実装とfuture TODO-owned testsをconcern別surfaceへ分ける。
- [ ] shared composition testをpolicy-specific expected valueの共同write先にせず、stable composition contractへする。
- [ ] scope violation、oracle divergence、test seam欠落をaccepted artifactへ進めない。
- [ ] canonical source、sensor、disposable worktreeのcleanup receiptを型付きで残す。

### RC1-K — evidence preimageとsource invariant

- [ ] raw opaque receipt、sanitized diagnostic payload、canonical portable payloadを別schema／digestへ分ける。
- [ ] control／treatment各2 runのfull portable payloadとper-query digestを保存する。
- [ ] sanitization manifest外のfield削除と絶対path混入をfail closedにする。
- [ ] protected source／test scopeの既存ignored content fingerprintを開始／終了で比較する。
- [ ] artifactだけからportable aggregate digestを再計算するfocused testをgreenにする。

### RC1-L — corrected closed loopを再発行する

- [ ] v4 controlをfresh indexし、single compilerがproduction＋test shared writesとunknownを導出する。
- [ ] accepted production＋test transformだけを加え、同じquery setでfresh treatment indexする。
- [ ] normal／negativeを同じcompilerへ通し、実測conflict、hard precedence、waves、unknownを比較する。
- [ ] full success predicateとplan diffを新artifact versionへcompileする。
- [ ] 2 fresh run／conditionのportable payload、compiled identities、sanitized diagnosticを再生成一致させる。
- [ ] v3 causal artifactsとcontextのinvalidationを新plan versionへbindする。

### RC1-M — correction Phase gate

- [ ] TODO単位のfocused／related gateと軽量監査を各完了候補で一回行う。
- [ ] P1 correctionだけを対象に独立refuterへ一回再監査し、同じfindingの無限シーソーをしない。
- [ ] source収束後のfull `npm run ci`を一回だけ実行する。
- [ ] v4をsupport／refuteする不変Decisionとevidenceを残す。
- [ ] RC1完了時だけplanをarchiveし、次campaignを正本化する。

## Evidence artifact

v4は少なくとも次をLattice内へ保存する。

- candidate spec v2、query set v2、TODO outcome、manual state／effect、test-write provenance、black-box oracle digest。
- pre／post各fresh runのcanonical portable outcomes full payload、sanitized diagnostic payload、opaque raw receipt。
- single compiler identityと、各TODOのresolved production／test owns、writes、unknown、conflict derivation trace。
- control／treatment／negativeのmanifest、verdict、plan、comparison、complete success predicate truth table。
- production＋test seam patch、transform外oracle receipt、bounded scope、cleanup、protected source fingerprint。
- v3→v4 plan diff、失効context、intervention時間、review、rework、rollback、未検証範囲。

machine artifactは`research/campaigns/rc1/artifacts/`の新versionへ置き、v3 artifactを上書きしない。
raw telemetryと絶対pathをplan identityへ入れず、sanitization methodとportable preimageを独立に監査可能にする。

## Non-goalsとwriter境界

- v4では任意repo向けgoal decomposition、汎用seam synthesis、最適scheduler、actual multi-agent dispatchを完成させない。
- 単一fixtureから一般的速度改善率、任意repo成功率、製品価値、新規性、freedom-to-operateを主張しない。
- v3のaccepted production transformを失敗へ丸めず、causal acceptanceとの境界だけを修正する。
- Observerをfixtureにせず、Observer関連repoを編集しない。Observer dogfoodはv4 Phase gateのhard dependency後に限る。
- dotagents repoはread-only参照のみ。Control stateはLatticeの`.git/`、artifactはLattice repo内に置く。
- remote作成、push、publish、credential／login、production／external effectは行わない。
