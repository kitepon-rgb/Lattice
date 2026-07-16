# RC2 semantic binding implementation

- 観測日: 2026-07-16
- implementation predecessor: `9e56df0159a12e50755fe1aa00e07f225696b423`
- Decision: [ADR 0041](../adr/0041-rc2-artifact-semantic-oracle-mutation-binding.md)
- expected-red predecessor: `2094c83`／[semantic reseal characterization](2026-07-16-rc2-artifact-semantic-reseal-characterization.md)

## 実装結果

`expectedRc2DeliveryPolicyOracleReceipt`をruntime oracleとartifact-only verifierが共有する唯一のexpected receiptとして追加した。
runtime childの実出力はこのreceiptへcase順・ID・output digestを照合し、verifierは保存済みprocess outputを真とせず同じ期待値を
pureに再計算する。

`verifyTransformSemantics`は保存artifactだけから次をfail-closedで検証する。

- `fixed_oracle.source_base64`のcanonical base64、decoded bytes SHA-256、candidate／accepted source digest、保存identity source bytes。
- pre／post receiptのexact schema、順序付き6 case、oracle唯一正本との完全一致、case-set digest。
- candidate、behavior、mutation、accepted artifact間のcandidate digestとtransform adapter identity。
- candidateの3 TODO、各2 case、proposed production owner／dedicated test、composition testから導出したexact 6×4 mutation matrix。
- 各rowのowner TODO／resolver／mutated path／oracle mismatch／restore digestと、owner cellだけがfailedかつnon-zero、他3 cellが
  passedかつexit 0であること。
- control／output surface snapshot、behavior／mutation evidence、accepted summaryの再計算。

artifact contractはv1／v2を変更せずv3を追加した。v3はimmutable v2 manifest／plan v3、ADR 0041、expected-red evidenceを
predecessorに取り、execution identity v3、artifact manifest v3、plan `rc2-delivery-policy-v4`を発行する。disk readerはv1／v2／v3を
version別exact path setで読む。canonical v3は本TODOでは発行していない。

## Characterization反転と互換性

新規一時Lattice cloneへ作業diffを適用し、clean test commitからfocused campaignを実行した。canonical rootはclone内のv3だけを
一時発行し、終了後にclone全体を削除した。

| gate | 結果 |
|---|---|
| `test/rc2-campaign.test.mjs` focused | 9 pass／0 fail。全digest再封印後のoracle source substitution、false-passed receipt、owner cell false-passを全て`transform_binding`でreject |
| `test/rc2-delivery-policy-fixture.test.mjs` focused | 10 pass／0 fail。runtime receiptとpure expected receiptを照合 |
| `test/rc2-delivery-policy-front-end.test.mjs` focused | 14 pass／0 fail。current candidate／oracle pairと孤立corruption reject |
| `test/rc2-delivery-policy-transform.test.mjs` focused | 5 pass／0 fail。current candidate digestとisolated transactionを照合 |
| saved artifact disk replay | v1 14 checks／v2 15 checks、どちらもvalid |
| changed source／test syntax | `node --check` 6 source＋campaign test、全て成功 |

campaign testは47.433秒。front-endの最初のrelated runでは、synthetic source snapshotだけが旧oracle digestを保持していたため
positive 6件がfail-closedになった。fixture anchorをcurrent oracle digestへ同期し、front-end failure scopeだけを再実行して14／14へ
収束した。これはproduction fallbackではない。

full `npm run ci`は未実行。canonical v3発行とfresh reindexがsource／artifact stateを変えるため、H1d完了後のPhase gateへ一回だけ
集約する。

## Source変更後Codegraph

source編集前preflightは[別証拠](2026-07-16-rc2-semantic-binding-codegraph-preflight.md)で固定済み。編集後の
`codegraph status . --json`はmodified 8を示したためfreshと扱わず、明示`codegraph sync .`を実行した。syncは8 files／381 nodesを
更新し、最終状態はCodegraph 1.4.1、76 files、1,926 nodes、7,405 edges、pending added／modified／removed 0、index complete、
pending refs 0、worktree mismatch `null`だった。`codegraph files`で変更source 5件とcampaign testのlive bytes／nodesを照合した。

| exact symbol | definition | caller／callee | impact |
|---|---|---|---:|
| `expectedRc2DeliveryPolicyOracleReceipt` | `src/rc2-delivery-policy-oracle.mjs:63` | callers: semantic verifier、runtime oracle、fixture test。callees: `expectedDigest`、`CASES` | 11 nodes／12 edges |
| `verifyTransformSemantics` | `src/rc2-artifact-set.mjs:573` | caller: `verifyTransform`。callees: expected mutation contract、oracle expected receipt、surface／matrix verifier等13 | 3／2 |

`codegraph affected`へ変更source 5件を渡すとcampaign、fixture、front-end、transformの4 test、traversed dependents 8を返し、事前に
定めたrelated setと一致した。candidate JSONはCodegraph対象外なのでaffected 0へ丸めず、campaign dynamic read、front-end／transform
digest anchor、test loaderをmanual consumerとして維持する。Codegraphはsaved process outputの真実性やbase64／oracle semanticsを
証明しないため、上記characterizationとdisk replayがそのunknownを閉じる。

## Scope

- canonical artifact v1／v2、ADR 0041、expected-red evidenceは未変更。
- canonical artifact v3／plan v4発行、fresh experimental reindex、full CI、Phase反証、最終DecisionはH1d以降。
- dotagents／Observer関連repo write、remote作成、push、publishは0。
