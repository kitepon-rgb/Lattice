# RC1 v5 immutable closed loop受入証拠

- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v5` / RC1-Q
- 対象Control: `lattice-rc1-closed-loop-v3`
- characterization commit: `6edfcc6ee447ae8e6cdf24f39a5d3f37fdf50c1a`
- source commit: `b5e1029418b1eba8a0fb61215361e577f0065928`
- canonical artifact commit: `39c4471eee04c4e35ada15e0b90c98795d30e06b`
- Decision: [ADR 0027](../adr/0027-rc1-v5-immutable-closed-loop-accepted.md)
- preflight: [artifact verifier preflight](2026-07-15-rc1-v5-artifact-verifier-preflight.md)

## Scope

F（artifact identity、compiler replay、plan version barrier、canonical experiment）として親が直轄した。

- 追加: `src/rc1-v5-artifact-set.mjs`
- 更新: `src/rc1-v5-campaign.mjs`、`test/rc1-v5-campaign.test.mjs`
- 新規machine artifact: `research/campaigns/rc1/artifacts/v5`の33 file

fixture、input、oracle、v4 source／artifact、dotagents、Observer関連repoは変更していない。Control stateとfile-backed
campaign runnerはLatticeの`.git/`配下だけに置いた。remote作成、push、publishは行っていない。

## Test-first characterization

source変更前にfixed input 6件、exact 32 payload、8 compiler replay、12 verification check、8 corruption controlを
`test/rc1-v5-campaign.test.mjs`へ追加した。

~~~text
node --test test/rc1-v5-campaign.test.mjs
~~~

結果は`1 test / 0 pass / 1 fail / 0 skip`。planned `src/rc1-v5-artifact-set.mjs`の
`ERR_MODULE_NOT_FOUND`だけでfail loudし、既存campaignの挙動やtest typoをred原因にしていない。

## Full artifact verifier

manifestとdisk payloadから次の12 checkを再計算し、全件passedした。

| check | 根拠 |
|---|---|
| `behavior_artifact_set` | pre／post receipt、surface、transform、patch、envelope、manifest resultの既存O2 relation |
| `exact_artifact_set` | manifestとpayloadが固定32 pathへ全単射 |
| `canonical_payloads` | 全31 JSON payloadをpretty canonical bytesとして再parse、patchはnon-empty bytes |
| `input_identity` | 保存6 inputのdigest、oracle、query setをexecution／2+2 bundleへ照合 |
| `evidence_campaign` | 4 bundleのschema、raw／diagnostic／portable、condition内再現性 |
| `compiler_replay` | raw preimage＋run snapshotから2条件×2run×2 variantの8 compileを再実行 |
| `transform_binding` | control manifest／verdict／plan、query、base、pre surface、patch、receipt、executionへ照合 |
| `plan_diff_binding` | control／treatment artifactからv4 predecessorと4 invalidationを再構成 |
| `comparison_binding` | fixed inputs、single compiler、4 compilation、evidence、behavior、version barrierを再構成 |
| `hypothesis_evaluation` | comparison summaryのbehavior自己申告を使わずunderlying artifactから15 check再評価 |
| `execution_evidence` | 2+2 run receipt、timing、snapshot、component digest、source invariant、全結果digestへ照合 |
| `result_binding` | manifest base／resultをexecution、transform、pre／post、envelopeへ照合 |

manifest SHA-256は`e85d84fbd113c5887adfbe3995d38aa07ef5c84784a168f457858a7643e2a778`、
result／behavior envelope digestは`02fdcac26dd88aea83f58f612c9e7adf9b2c6ff97f8c7837c4cc6e5d93846e67`。

## Corruption controls

全caseで改ざんpayloadをpretty bytesへ戻し、manifestのbytes／SHA-256を再封印した。複数artifactへ参照されるcaseは
plan diff、comparison、hypothesis evaluation、execution evidenceの依存digestも更新した。

| case | 再封印した依存 | expected／actual rejection |
|---|---|---|
| saved plan input preimage | manifest | `input_identity`／一致 |
| compiled control plan | execution compilation digest、manifest | `compiler_replay`／一致 |
| control run snapshot | manifest | `compiler_replay`／一致 |
| transform source manifest digest | artifact、envelope、receipt、plan diff、comparison、evaluation、execution、manifest result | `transform_binding`／一致 |
| v4 invalidation reason | plan diff、comparison、execution、manifest | `plan_diff_binding`／一致 |
| comparison fixed input | comparison、evaluation、execution、manifest | `comparison_binding`／一致 |
| hypothesis evaluation | evaluation、execution、manifest | `hypothesis_evaluation`／一致 |
| execution raw receipt digest | manifest | `execution_evidence`／一致 |

単なる`byte_hashes` failureへ依存したcaseはない。

## Canonical execution

base `b5e1029418b1eba8a0fb61215361e577f0065928`を固定し、Lattice canonical repoからfile-backed runnerで実行した。
manifestは32 payload、diskはmanifestを含む33 file／約656 KiB。保存前と保存後のfull verifierはいずれも12／12 passed。

| 指標 | control | treatment | 判定 |
|---|---:|---:|---|
| verdict | `seam_candidate` | `parallel_ready` | expected |
| write conflict | 3 | 0 | expected |
| test-write conflict | 1 | 0 | expected |
| hard precedence | 0 | 0 | 不増加 |
| unknown | 0 | 0 | hidden unknownなし |
| minimum feasible waves | 2 | 1 | expected |
| state conflict（negative） | 1 | 1 | causal control保持 |
| waves（negative） | 2 | 2 | intentional serial保持 |

- campaign elapsed: `16,217.635 ms`
- seam intervention elapsed: `445.35 ms`
- accepted patch digest: `016e2e40a758b1588d9fe0daf8bb97027c5ae6c509ce9a77951a8ff3ccf1a307`
- compiler source digest: `5b4f4272e396b6e257ab0bfd4997382dddae9eb38cc19a0bf707d7ae8017e733`
- control portable digest: `12f08d33ef2c2c40be1f1be91f0f953a01596c31ebfc5a73135ebdbd07ebe030`
- treatment portable digest: `2b22197b3e7089b3e94db37e87d7fa380b31ff2d4be893ccdb9c0843c643c4ef`
- condition内2 runはraw digestが別で、portable／diagnostic digestが一致した。
- pre／post receipt、oracle outcome、source invariant、cleanup、exact patch replayはpassed。
- HEAD、tracked diff、既存worktree集合は実行前後で不変。artifact rootだけを新規作成した。

plan diffは`rc1-v5-control`から`rc1-v5-treatment`へ移り、Phase-rejected v4 plan、agent context、partial patch、
receipt-reuse interface assumptionを失効した。hypothesis evaluationは15／15 passed、failed conditionなし。

## Review、rework、rollback

- **review:** TODO完了候補の軽量監査を1回行い、source／test diff、Codegraph impact、artifact全path、manifest、execution、
  comparison、plan diff、disk verifier、related gateを親が確認した。
- **source rework:** 初回focused green後、campaign全体時間だけではseam介入時間を識別できない欠陥を発見し、transform区間の
  `elapsed_ms`を追加してfocusedを再実行した。
- **runner rework:** 初回canonical invocationを`node --input-type=module -e`で起動したため、`--input-type`がfresh Workerへ
  継承されpre oracle前でrejectされた。source invariantはpassed、artifact rootは未作成だった。file-backed `.mjs` runnerへ
  正して同じbase／inputで成功した。製品結果へfallbackしていない。
- **patch適用rework:** timing追加時の`apply_patch` context mismatchはno-opで、実位置を再読して適用した。
- **artifact diff gate:** `git diff --cached --check`はunified diff内の空context markerをtrailing whitespaceとして検出した。
  `seam.patch`以外へcached check、patch自体へ`git apply --check --whitespace=error-all`を通し、patch bytesは変更していない。
- **rollback:** 0。失敗runはいずれもcanonical source／artifactを変更せず、rollback操作は不要だった。

標準経路外の手補正、証拠再構成、artifact byteの手編集はない。

## Gates

### Focused

- 初回full verifier実装: `1 pass / 0 fail / 0 skip`、約14.12秒。
- intervention timing補正後: `1 pass / 0 fail / 0 skip`、約14.28秒。
- `node --check`はartifact set、campaign、campaign testの3件でgreen。

### Related

post-indexのaffected testは`test/rc1-v5-campaign.test.mjs`だけだった。TODO完了候補で一回実行した。

~~~text
node --test test/rc1-v5-campaign.test.mjs
~~~

結果: `1 pass / 0 fail / 0 skip`、約14.22秒。続けてcommit済みdisk artifactを再読込し12／12 checks passed。

full `npm run ci`はRC1-Rへ集約し、ここでは実行していない。

## Post-index Codegraph

source収束後のindexは`46 files / 1,036 nodes / 3,952 edges`、up to dateだった。

- `verifyRc1V5CampaignArtifactSet`: `src/rc1-v5-artifact-set.mjs:829`、callerはwriterとcampaign test、
  impact `4 nodes / 5 edges`。
- `runRc1V5Campaign`: `src/rc1-v5-campaign.mjs:505`、impact `2 / 1`。
- `writeRc1V5Artifacts`: `src/rc1-v5-campaign.mjs:745`、impact `2 / 1`。
- source 2件のaffected testはcampaign test 1件。空結果や未解決参照はindependenceへ丸めていない。

source／test SHA-256は次である。

- `src/rc1-v5-artifact-set.mjs`: `0064cfa0b4c00e38bc21e738ca7fd6e3e206f6ca228cd91b267eb977304da883`
- `src/rc1-v5-campaign.mjs`: `49bcb80207b2b22af6717987b2ff287b85f2015d2c6c037861caee520dd4d8a0`
- `test/rc1-v5-campaign.test.mjs`: `ca556539c1711f97fe53dd89c99c85b0a3a942919771e2f984616ebd257c88f7`

## TODO軽量監査と未検証範囲

RC1-Qの受入条件6件は全て実artifactで充足した。再現した欠陥はintervention timing欠落だけで、source correctionとtestで
閉じた。canonical runner失敗はunsupportedなeval invocationのexecArgv継承であり、file-backed runnerから同じ正規APIを
実行して閉じた。seam変換、2+2 reindex、single compiler recompile、version barrier、immutable writerを縮小していない。

未検証は次であり、greenへ丸めない。

- full `npm run ci`（RC1-Rで一回）
- behavior evidence P1の独立refuter（RC1-Rで一回）
- 任意repo、Observer、複数fixtureへの一般化
- actual multi-agent dispatchとwall-clock speedup
- remote attestation、署名、悪意あるexecutorへの耐性
