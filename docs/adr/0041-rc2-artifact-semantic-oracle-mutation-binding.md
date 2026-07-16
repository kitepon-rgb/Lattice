# ADR 0041: RC2 artifactへoracle／mutation semanticsをbindしv3へ再compileする

- Status: Accepted
- Date: 2026-07-16
- Scope: RC2-H1のartifact-only verifier、behavior evidence、mutation evidence、version barrier
- Amends: [ADR 0038](0038-rc2-closed-loop-version-and-artifact-contract.md)、
  [ADR 0040](0040-rc2-post-publication-codegraph-scope-and-artifact-v2.md)
- Evidence: [RC2 artifact semantic reseal誤受理characterization](../evidence/2026-07-16-rc2-artifact-semantic-reseal-characterization.md)

## Context

RC2 artifact v2のPhase反証で、`verifyRc2CampaignArtifactSet`がtransform evidenceのself digestと下流artifact relationだけを検査し、
保存されたoracle source、oracle receipt、mutation matrixの意味を再計算していないことが再現した。意味改竄後にmanifestを含む全downstream
digestを正規規則で再封印すると、次の3件をすべて`valid: true`として誤受理した。

- `fixed_oracle.source_base64`と宣言済み`source_digest`が一致しないsource substitution。
- pre／post receiptと`case_set_digest`を一緒に差し替えたfalse-passed oracle receipt。
- owner testが失敗しないように変えたmutation matrix。

これは成功条件13、15、23とADR 0038 §7を破るP1である。v1／v2のcanonical artifactを後から修正するとimmutable evidenceとplan predecessor
relationを壊す一方、digest relationだけを追加してもfalse receiptとfalse matrixを識別できない。また、保存されたoracle sourceをartifact
verifierが実行すると、ADR 0030以来の「保存executableはuntrusted input」というtrust boundaryを破る。

## Decision

### 1. verifierのtrust boundaryを明示する

`verifyRc2CampaignArtifactSet`はcurrent trusted Lattice sourceを実行し、artifact manifest／payloadはすべてuntrusted inputとして扱う。
保存された`identity/*.mjs`、oracle source、patchを検証のために実行しない。保存sourceはbytes、digest、path、semantic receiptとのrelationだけを
検証する。

artifact-onlyは「manifestとpayload以外のcampaign runtime objectを要求しない」という意味であり、保存実行物をtrustするという意味ではない。
署名、remote attestation、敵対者によるtrusted verifier自体の置換はRC2のnon-goalのままにする。

### 2. fixed oracle sourceを唯一の期待値正本にする

`src/rc2-delivery-policy-oracle.mjs`は既存`CASES`からpureかつ同期的にexpected receiptを作るexportを持つ。black-box oracle実行と
artifact verifierは同じexportを利用し、期待output digestやcase IDを別JSON／別tableへ複製しない。

artifact verifierはartifact versionにかかわらず次をfail-closedで検査する。

1. `fixed_oracle`、pre／post receipt、各case resultがexact key、exact schema、exact orderを持つ。
2. `source_base64`がcanonical base64でdecodeでき、そのbytesのSHA-256が`source_digest`に一致する。
3. oracle path／source digestがaccepted candidate、accepted transform source、control／output snapshot、保存
   `identity/rc2-delivery-policy-oracle.mjs` bytesへcross-bindされる。
4. pre／post receiptがtrusted expected receiptとbyte-semanticに一致し、互いにも一致する。
5. `case_set_digest`をpre receiptのordered `{id, output_digest}`から再計算し、behavior evidence、mutation evidence、accepted transform summaryへ
   同じ値をbindする。
6. `equivalent`をsummary booleanとして信頼せず、pre／post exact一致から導出し、accepted transform summaryも同じ導出値を持つ。

v1／v2の保存oracle sourceは実行しないが、そのreceipt semanticsは現在のtrusted `CASES`と同一なので、canonical v1／v2のread compatibilityを
維持できる。将来case semanticsを変更する場合は、旧version用contractを消さず新artifact versionへ加算する。

### 3. mutation matrixをaccepted candidate witnessから再構成する

artifact verifierは保存candidateをmanual design witnessとして検証し、candidate digestをaccepted transform、behavior evidence、mutation evidenceへ
cross-bindする。そのcandidateのordered case partition、proposed production owner、dedicated test ownerとcomposition test surfaceから、期待matrix
topologyを再構成する。

- rowはcandidateの6 caseとexactly 1対1、順序も一致する。
- 各rowの`case_id`、`owner_todo_id`、`resolver_symbol`、`mutated_path`、`oracle_mismatch_id`、`restore_digest`はcandidate、behavior output
  snapshot、case自身から導出した値と一致する。
- 各rowは3 dedicated testsと1 composition testのexact 4 cellsを一度ずつ持つ。
- owner dedicated testだけが`failed`かつnon-zero exit、他2 dedicated testsとcomposition testは`passed`かつexit 0になる。
- stdout／stderr digestはSHA-256形状を持つ。artifact verifierは保存されていないprocess outputを再実行したとは主張しない。
- 6 rows／24 cells、`matrix_digest`、mutation `evidence_digest`、accepted transformのrow／cell countを保存rowsから再計算する。

matrix shapeを満たすよう全artifactを捏造できないというremote authenticityまでは主張しない。RC2で識別するのは、accepted manual witnessとtrusted
oracle semanticsに反する保存artifact、およびsummary／digestだけを整合させたsemantic substitutionである。

### 4. v1／v2を不変に保ちartifact v3／plan v4を発行する

`research/campaigns/rc2/artifacts/v1`と`v2`、ADR 0038／0040は変更しない。writerのcurrent targetを
`research/campaigns/rc2/artifacts/v3`へ進め、disk verifierはv1／v2／v3をversion-awareに読む。

artifact v3は少なくとも次をv2 exact setへ加算する。

- 本ADRとP1 characterization evidenceのexact bytes。
- RC2 artifact v2 manifestと`rc2-delivery-policy-v3` planのexact bytes。
- 既存artifact input pathに置く、source digestを更新したactive candidate witness bytes。旧bytesはv1／v2 artifact内で保持する。

manifestは`lattice.rc2.artifact_manifest.v3`、execution identityはv3として識別する。new planは
`rc2-delivery-policy-v4`、predecessor versionはv2 artifactの`rc2-delivery-policy-v3`とする。v2 artifact manifest、predecessor plan v3、
本ADR、本P1 evidenceをcausal predecessorへ含め、3 TODO全件をrecompileする。

plan diffは少なくとも旧plan、旧agent context、旧partial patch、旧interface assumption、旧boundary evidenceを失効する。artifact v2のplanへ
追記してv4を作らない。

### 5. correction gateを独立して閉じる

実装順は次で固定する。

1. source編集前にoracle、transform、artifact verifier、campaign、candidate witness、affected testsのCodegraph境界を開き直す。
2. 3件のsemantic reseal characterizationをgreenにし、canonical v1／v2 disk replayを維持する。
3. corrected clean source commitからaccepted transform、control／treatment fresh repeat、同じquery set、fresh Codegraph index、全condition compileを再実行する。
4. artifact v3をatomicかつno-overwriteで発行し、plan v4と旧context失効をdisk-only verifierで再生する。
5. source／artifact収束後にrelated testとfull `npm run ci`を各一回実行し、RC2成功条件だけを対象にPhase反証を再開する。

semantic bindingの一件でも再計算不能、canonical v1／v2が新verifierで不正になる、v3がv2 planをpredecessorにできない、fresh runの構造結果が
変わる場合はartifact v3を発行せず、このDecisionを後続ADRで再裁定する。

## Consequences

- digest chainの整合だけでbehavior preservationやtest ownershipを受理できなくなる。
- runtime oracleとartifact verifierが同じcase正本を使い、期待値JSONの二重管理を避けられる。
- oracle source export追加によりactive candidate source digestとCodegraph topologyは変わるため、v3 campaignのfresh observationが必要になる。
- v1／v2 artifactは欠陥の履歴を含むimmutable predecessorとして残り、corrected claimはv3／plan v4だけが担う。
- full CIの再実行は「念のため」ではなく、P1修正後にsourceとcanonical artifactが変わるための新しいPhase gateである。

## Non-goals

- 保存source／patchの実行、署名、remote attestation、malicious trusted-verifier replacementを解決しない。
- mutation process stdout／stderrを保存bytesだけから再現したとは主張しない。
- registry-shard以外のseam class、自然言語からのownership自動発見、actual multi-agent wall-clock効果へ一般化しない。
- Observerをfixtureにせず、dotagents／Observer関連repoを編集しない。remote作成、push、publishを行わない。
