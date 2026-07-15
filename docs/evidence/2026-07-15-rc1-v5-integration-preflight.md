# RC1 v5 transform／campaign integration preflight

- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-P
- 対象Control: `lattice-rc1-closed-loop-v3` revision 100
- classification: F（isolation、artifact binding、version barrier）／親直轄
- writer scope: Latticeのみ

dotagentsとObserver関連repoはread-onlyであり、Control stateはLatticeの`.git`配下だけを更新した。
remote作成、push、publishは行っていない。

## Source編集前Codegraph

`codegraph status . --json`はCodegraph 1.4.1、`41 files / 845 nodes / 3,254 edges`、index state
`complete`、pending changes／refs `0`、worktree mismatchなし、reindex recommended falseを返した。

既存接続面をexact ownerで解決し、`query`、`callers`、`callees`、`impact`、path-level `affected`を確認した。

| owned symbol | exact path | callers／主要callee | impact | affected tests |
|---|---|---|---:|---|
| `runRc1V4SeamTransform` | `src/rc1-v4-transform.mjs:359` | v4 campaign、v4 transform test／isolation、v4 oracle、artifact validator | 6 nodes／10 edges | v4 campaign、v4 transform |
| `applyRc1V4Transform` | `src/rc1-v4-transform.mjs:345` | v4 transform test／fixed outputs | 2／2 | v4 campaign、v4 transform |
| `runRc1V4Campaign` | `src/rc1-v4-campaign.mjs:472` | v4 unit・integration／fresh index、single compiler、v4 transform、v4 evaluator | 3／4 | v4 campaign |
| `writeRc1V4Artifacts` | `src/rc1-v4-campaign.mjs:643` | v4 unit・integration／bundle validator、artifact files、atomic writer | 3／4 | v4 campaign |
| `runIsolatedTransform` | `src/isolation-runner.mjs:260` | v4 campaign／transform、旧seam、runner tests／snapshot、verifier、source invariant | 13／23 | isolation、v4 campaign、v4 characterization、v4 transform、旧seam |
| `runRc1V5BlackBoxOracle` | `src/rc1-black-box-oracle.mjs:522` | oracle test／Git HEAD、surface capture、fresh Worker、artifact digest | 2／1 | oracle、v4 campaign、v4 characterization、v4 transform |
| `compileRc1V5BehaviorEvidence` | `src/rc1-v5-behavior-evidence.mjs:344` | v5 behavior test／receipt、transform、patch、binding checks | 2／1 | oracle、v5 behavior |
| `evaluateRc1V5Hypothesis` | `src/rc1-v5-behavior-evidence.mjs:418` | v5 behavior test／behavior binding、v4 pure evaluator | 2／1 | oracle、v5 behavior |
| `validateTransformArtifact` | `src/artifact-contracts.mjs:766` | transform、behavior、treatment各laneとtests／exact source、scope、patch、output | 24／33 | 14 unit test file |

Codegraphのpath-level affected集合はsymbol impactより広い場合があるため、両方を保持した。特にoracleとbehavior
moduleは現時点のexact callerが各testだけでも、path affectedに既存v4 callerを含む。既存moduleはPで編集せず、
新しいv5 moduleから公開APIを使う。

### Planned symbol／path unknown

`runRc1V5SeamTransform`、`runRc1V5Campaign`、`writeRc1V5Artifacts`の`query`はexact result 0で、
各v4 symbolをfuzzy hitした。続く`callers`、`callees`、`impact`もそのfuzzy v4 nodeを起点にv4の関係を返したため、
planned v5 relationの証拠には採らない。

未存在の`src/rc1-v5-transform.mjs`と`src/rc1-v5-campaign.mjs`に対する`affected`はtests 0、
未存在のv5 test pathは各path自身だけを返した。いずれも`new_surface_unknown`であって依存なしではない。
characterization追加後とsource追加後に明示reindexし、exact owner／caller／callee／impact／affected testを再確認する。

## Integration contract

### Transform boundary

1. v4 source、API、artifact bytesを変更せず、v5 transformを別module／別APIにする。
2. callerはcontrol boundary manifest／verdict／planとquery setのdigestだけを渡す。
3. v5 transformはresolved base SHAを固定した一つのdisposable worktree内で、pre v5 oracle、transform、post v5
   oracleをこの順に実行する。
4. transform artifactの`source.code_snapshot_digest`はcaller自己申告やCodegraph snapshotではなく、実pre receiptの
   fixed-surface digestから生成する。control Codegraph snapshotの帰属は`boundary_manifest_digest`に残す。
5. accepted artifactのoutputはpost surfaceの全present projection、patchはisolated runnerのexact bytesへ一致させ、
   O2 behavior envelopeをその場でcompileする。
6. pre failure、post behavior divergence、scope violation、verification、cleanup、source invariant、cross-bindingのいずれかが
   rejectならbehavior envelopeを生成せず、campaignのtreatment index／recompileへ進めない。

### Campaign boundary

1. control／treatment各2回を同じquery set、single `compileBoundaryCondition`、manual evidence、capacity、oracleで実行する。
2. treatmentはaccepted v5 patch bytesだけをreplayし、各runのpatch digestをtransform artifactへ照合する。
3. v5 comparisonはbehavior summaryを持たず、O2 envelope digestだけを参照し、artifact-only evaluatorへunderlying
   pre／post receipt、envelope、transform artifact、patch digestを渡す。
4. plan diffはPhase-rejected v4をcausal predecessorにし、v4 machine support、agent context、partial patch、
   shared-test assumptionを失効する。
5. writerは新規`artifacts/v5`だけへatomic writeし、full receipt、envelope、transform、patchをmanifest v5へ含める。
   既存rootは上書きしない。canonical repoへの実発行はRC1-Qまで行わない。

## Characterization gate

- v4 transform receiptがfull v5 receipt／behavior envelopeとして検証不能な反例をgreenで保持する。
- pre surfaceにbaselineのpresent／absent、post surfaceにexact transformed outputを要求する。
- pre surface digest、transform source、post output、patch、envelopeの全relationを一つずつassertする。
- rejected transformのenvelopeが`null`であり、後段へaccepted predecessorを渡せないことをassertする。
- actual 2+2 fresh Codegraph、single compiler、production＋test conflict、negative state、version barrier、immutable v5
  writerの契約を固定する。
- 未実装v5 moduleによるredを実装欠落として記録し、v4 testやfixtureを都合よく変更しない。

### Expected red実測

実行:

~~~text
node --check test/rc1-v5-transform.test.mjs
node --check test/rc1-v5-campaign.test.mjs
node --test test/rc1-v5-transform.test.mjs test/rc1-v5-campaign.test.mjs
git diff --check
~~~

結果はsyntax 2件とdiff checkが成功し、focusedは`4 tests / 1 pass / 3 fail / 0 skip`だった。

- green: v4 transform receiptはpre／post digestが同一でrole／surfaceを持たず、v5 receipt validatorを通らない実反例。
- red: v5 accepted transform、v5 rejected barrier、actual 2+2 v5 campaign。
- red原因: `src/rc1-v5-transform.mjs`と`src/rc1-v5-campaign.mjs`が未実装のため、3件すべて
  `ERR_MODULE_NOT_FOUND`。既存v4 behavior failureやtest syntax failureではない。

full `npm run ci`はRC1-Rへ集約する。Pではfocusedを収束させた後、Codegraphが再列挙したrelated testを
TODO完了候補で一回だけ実行する。
