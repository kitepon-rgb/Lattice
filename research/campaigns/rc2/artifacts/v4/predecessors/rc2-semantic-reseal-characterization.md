# RC2 artifact semantic reseal誤受理characterization

- 観測日: 2026-07-16
- 対象commit: `aaee9a5`
- 対象Task: `RC2-H1a-oracle-mutation-reseal-characterization-v1`
- 分類: P1／F（artifact trust boundary、behavior evidence、plan versionの因果binding）
- 関連Decision: [ADR 0038](../adr/0038-rc2-closed-loop-version-and-artifact-contract.md)、
  [ADR 0040](../adr/0040-rc2-post-publication-codegraph-scope-and-artifact-v2.md)

## Finding

`verifyRc2CampaignArtifactSet`は、transform evidence自身と下流artifactのdigest relationを検査する一方、保存されたoracle source、
oracle receipt、mutation matrixの意味をtrusted contractから再計算していない。攻撃者が意味改竄後に全downstream digestとmanifestを
再封印すると、現verifierは次の3件をすべて`valid: true`として受理した。

1. `fixed_oracle.source_base64`を別sourceへ差し替え、宣言済み`source_digest`との不一致を残す。
2. pre／post oracle receiptの同一caseを偽のoutput digestへ変え、`case_set_digest`も偽receiptから再計算する。
3. mutation matrixのowner test cellを`passed`／exit 0へ変え、owner sensitivityを消す。

これはSHA-256 collisionやmanifest破損ではない。manifest、behavior／mutation evidence、accepted artifact／receipt、new planのcausal
predecessor、plan diff、comparison、execution evidenceまで、公開されているdigest規則に従って整合的に再封印したsemantic
substitutionである。

## Source編集前Codegraph preflight

sourceを変更する前にLatticeのlive indexを確認した。`codegraph status . --json`はCodegraph `1.4.1`、76 files、1907 nodes、
7265 edges、state `complete`、pending changes 0を返した。`codegraph files --json`では
`src/rc2-artifact-set.mjs`と`test/rc2-campaign.test.mjs`の収載を確認し、immutable artifact配下の`identity/`はtracked
`codegraph.json`どおり除外されていた。

| owned symbol／path | caller／callee | impact／affected test | disposition |
|---|---|---|---|
| `verifyRc2CampaignArtifactSet` (`src/rc2-artifact-set.mjs:1074`) | campaign test、writer、disk verifier、campaign入口から到達。`artifactContext`、identity／Codegraph config／transform／run／plan／cost verifier等を呼ぶ | impact 6 nodes | exact owned verifier |
| `verifyTransform` (`src/rc2-artifact-set.mjs:380`) | callerはartifact verifierだけ。calleeは`stripDigest`、`sha256`、`digestArtifact` | writer、disk verifier、campaign testまで波及 | semantic transform bindingの所有点 |
| `src/rc2-artifact-set.mjs` | path-level | affected testは`test/rc2-campaign.test.mjs`、traversed 2 | focused gate |
| `test/rc2-campaign.test.mjs` | path-level | test自身、traversed 0 | characterization先行 |

`verifyTransform`のcalleeにはoracle source／receipt／mutation matrixをtrusted semanticsから検証するsymbolが存在しない。この空白を
「依存なし」へ丸めず、missing capabilityとして扱う。Codegraphはsource identity relationを示す構造sensorであり、保存bytesのbehavior
preservationを単独では証明しない。

## Characterization

既存のartifact v2 fixtureをmemory上で複製し、各caseで意味だけを一変数変更した。その後、次を実artifact writerと同じcanonical
digest関数で再計算した。

- behavior `evidence_digest`、mutation `matrix_digest`／`evidence_digest`
- accepted artifactのbehavior／mutation summary
- accepted receiptと`receipt_digest`
- new planのcausal predecessor digest
- plan diff、comparison、execution evidenceの全下流digest
- `replacePayload`によるmanifest byte length／SHA-256

production source、canonical `research/campaigns/rc2/artifacts/v1`／`v2`、RC1 artifactは変更していない。

focused expected-red:

```text
node --test test/rc2-campaign.test.mjs

tests 9
pass 5
fail 4
cancelled 0
skipped 0
todo 0
duration_ms 48896.700709

oracle-source-substitution:              actual valid=true, expected false
false-passed-oracle-receipt:             actual valid=true, expected false
owner-test-mutation-matrix-substitution: actual valid=true, expected false
```

fail 4は3 subtestと親testの集計であり、独立した意味改竄は3件である。既存5 testはgreenのまま、追加characterizationだけがexpected-redに
なった。

## 判定

このP1はRC2成功条件13、15、23とADR 0038 §7を破る。既存verifierは未再封印のbyte corruptionをrejectできるが、保存bytesから
oracle semanticsとtest sensitivityを再計算するartifact-only verifierにはなっていない。そのため、現artifact v2だけでPhase supportを
裁定することはできない。

修正条件は次のとおりとする。

- RC2 artifact v1／v2と対応ADRはimmutable predecessorとして保持する。
- 新しい不変ADRでtrusted oracle semantics、exact receipt、exact 6×4 mutation matrixの検証契約を固定する。
- canonical v1／v2のread compatibilityを保ったsemantic verifierを先にgreenにする。
- corrected sourceからartifact v3とplan v4を新規発行し、v2をcausal predecessorにする。
- source変更後はfresh reindexと新しいfull CIを行い、Phase反証を一回だけ再開する。

ChatGPT consultationはcaller既知slugで2回試したが、いずれもterminal timeoutで回答を得られなかった。timeout sessionは回収済みで、
本findingの根拠や反証には使用していない。dotagents／Observer関連repo write、remote作成、push、publishは0である。
