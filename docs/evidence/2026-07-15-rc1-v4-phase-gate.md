# RC1 v4 Phase gate evidence

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v4`
- Control: `lattice-rc1-closed-loop-v3` / Task `RC1-M-correction-refutation-v4`
- Decision: [ADR 0022](../adr/0022-rc1-v4-phase-gate-rejection.md)
- outcome: `rejected_for_behavior_evidence_identifiability`

## Gate result

RC1 v4は境界観測からseam変換、同一query setでのfresh再index、新planへのrecompileまでを実行し、related gate 27 pass、
control／treatment各2 runのportable digest再現、manifest 23 payloadのbyte hash、source invariantを通過した。
しかしPhase反証で、保存behavior evidenceがpost receiptをtransformed snapshotへbindせず、pre receipt再利用を区別できないP1を再現した。
このため15／15のmachine predicateと`supported=true`をrejectし、mechanism evidenceを保持してv5 correctionへ戻す。

## Independent laneとControl hygiene

| item | value |
|---|---|
| Task | `RC1-M-correction-refutation-v4` |
| Worker Run | `RC1-M-correction-refutation-run-01-v4` |
| routing | `refuter` / `gpt-5.6-sol` / high |
| packet digest | `ffb5bd533fc329b529623812693ca0f9436df2433d524be72f1786cd4c9b5b5a` |
| report result digest | `07214ae4d912d49ac993d3c369aa344037a095347479b2e733dcf5d8f2052e62` |
| workspace changes | 0、開始／終了status empty |
| Control lifecycle | revision 83で`completed`へimport、revision 84でparent `rejected` |

routingのrole／model／effort／developer instructionsはTOMLと一致した。実効sandboxは`danger-full-access`だったため、
Registryには`readonly.enforceable=false`を記録した。Taskは`effect=read`、`write_scope=[]`だった。

ただし親が作ったTask read scopeに`src/rc1-black-box-oracle.mjs`が欠落し、workerは監査中に同fileを読んだ。
これは必要dependencyをPacketへ含めなかった親のTask設計漏れであり、同時にworkerのControl read-scope逸脱である。
reportはterminal lifecycleを失わないためstrict schemaでimportしたが、worker resultは親acceptせずrejectする。
findingは以下の親再現だけを根拠に採用した。

## Parent reproduction

| surface | 実コード／artifact | 再現した欠落 |
|---|---|---|
| oracle executor | `src/rc1-black-box-oracle.mjs` | entrypoint content digestをimport cache keyへ使うがreceiptへ保存しない。role、base SHA、snapshotもない。 |
| transform | `src/rc1-v4-transform.mjs` | pre→transform→postの実呼出しはあるが、`behaviorSummary`がfull receiptをoutcome＋digestへ縮約する。 |
| campaign comparison | `src/rc1-v4-campaign.mjs` | control／treatment behaviorをoutcome＋oracle digestへ再縮約する。 |
| artifact writer | `src/rc1-v4-campaign.mjs` | full pre／post receiptを別payloadとして保存しない。 |
| evaluator | `src/rc1-comparison.mjs` | behavior checkは両outcome passed＋oracle digest一致だけを検査する。 |
| stored transform receipt | `artifacts/v4/transform/transform-receipt.json` | pre／post receipt digestが同じで、観測roleとsnapshot identityを復元できない。 |
| stored manifest | `artifacts/v4/artifact-manifest.json` | 23 payloadにpre／post behavior receiptが存在しない。 |

保存transform receiptのbehavior blockは次の事実を持つ。

- oracle digest: `abb844fa0325140cb4e73365f02429f2ec0b6006bd2b5bcc88f4727b988e7d23`
- pre receipt digest: `a75f1ff55f5f40a1950a4d95b2b8920f7b58a73be574b54a2c06c38f1814e6ee`
- post receipt digest: `a75f1ff55f5f40a1950a4d95b2b8920f7b58a73be574b54a2c06c38f1814e6ee`
- equivalent: `true`

現在のreceipt schemaでは、実際のpost receiptをpre receiptで置換してもこのbehavior blockはbyte-identicalである。
comparisonとhypothesis evaluationもfull receiptを参照しないため、15条件はそのままgreenになる。
これがartifact-only verifierに対する具体的な非識別反例である。

## Test policy

- focused／related: RC1-L完了候補で27 pass / 0 fail / 0 skipを実施済み。今回再実行していない。
- full: **未実施**。Phase gateでsource correctionを要するP1が見つかりsource未収束になったため、v5収束後のPhase gateへ集約する。
- Codegraph mutation: 今回のdocs裁定では未実施。

archive確認用のshell検索patternへbacktickを含めた際、command substitutionとして`npm run ci`を誤起動したため、
完了前に該当exec sessionをterminateした。exit resultとtest集計は得ておらず、full gateとして数えない。terminate後に
Latticeの変更pathがdocs 3件だけであることを確認した。以後の検索patternはsingle-quoteへ固定した。

full regression未実施をgreen扱いしない。既存related greenはv4 mechanism regressionの証拠であり、receipt非識別を反証しない。

## Invalidated and retained artifacts

### Active conclusionとして失効

- `hypothesis-evaluation.json`の`supported=true`
- comparisonのbehavior preservation claim
- v4 planのPhase完了候補と、そのagent context／partial patch／interface assumption
- outcome＋oracle digestだけでpost transformed observationを識別できるという解釈

### Historical mechanism evidenceとして保持

- same compilerで導出したcontrol／treatment／negativeのboundary manifest、typed verdict、plan
- production＋test seamのaccepted patch、output snapshot、scope、cleanup
- control／treatment各2 fresh runのportable／diagnostic／raw evidence
- source invariant、digest chain、plan diff、version barrier
- v4 related gate 27 pass

## Required correction

v5はfull pre／post behavior receipt、role、base SHA、entrypoint content digest、fixed behavior-surface snapshot、patch／transform bindingを
保存し、underlying artifactからmachine predicateを再計算する。post→pre差替え、role／snapshot／patch破損、manifest payload欠落を
characterization testで先に赤へし、修正後にimmutableな`artifacts/v5`を2 fresh run／conditionで再発行する。

## Writer boundary

LatticeのdocsとLattice `.git`内Control stateだけをwrite対象にした。dotagentsはorchestrate CLI／文書のread-only利用のみ、
Observer関連repoは不使用。remote作成、push、publishは実施していない。
