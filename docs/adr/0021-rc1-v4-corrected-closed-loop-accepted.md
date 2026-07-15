# ADR 0021: RC1 v4のcorrected closed loop artifactをacceptする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v4` / RC1-L
- 対象Control: `lattice-rc1-closed-loop-v3` / `RC1-L-corrected-closed-loop-v4`
- depends on: ADR 0016、ADR 0017、ADR 0018、ADR 0019、ADR 0020

## Context

RC1 v3のPhase gateは、condition別compiler、future TODOのshared test-write脱落、fresh evidence preimage欠落、不完全なsuccess
predicate、bounded source invariant gapにより因果結論をrejectした。RC1-H〜Kはそれぞれ識別性safety net、single compiler、production＋test
seam、evidence preimageとsource invariantをacceptしたが、実Codegraph 2＋2 run、accepted transformの実発行、same-query reindex、全plan
recompileはまだ接続されていなかった。

## Decision

- base SHA `44f9b1aa0d6b15938a3c6c934097d4f75a1744b2`から、control 2 runとtreatment 2 runを別々のdetached disposable
  worktreeでfresh indexし、fixed query set v2のfull evidence bundleを保存したcampaignをacceptする。
- control／treatmentはcondition selectorを持たない同じ`compileBoundaryCondition`、同じsource digest、candidate spec、manual evidence、query
  set、capacity、black-box oracleを使う。独立変数は一度だけacceptedされたproduction＋test seam binary patchの有無に限定する。
- accepted patchはtreatment 2 worktreeへexact byte列でreplayし、各runで同じquery setを再収集する。canonical worktreeへpatchを適用しない。
- normalとshared-state negativeを同じcompilerへ通し、controlのproduction／test write conflict、treatmentのparallel-ready、negativeの
  intentional serialを同一write-intersection規則からcompileする。
- comparison v2、15条件のmachine hypothesis evaluation、v3→v4 plan diff、execution evidenceを
  `research/campaigns/rc1/artifacts/v4/`へimmutableに保存する。manifestの23 payloadはpath、byte length、SHA-256でbindする。
- v3のold plan、agent context、partial patch、shared-test interface assumptionをinvalidated contextとし、v3 active topologyへ結果を追記しない。
- actual metrics、digest chain、fail-loud correction、accepted source identityは
  [RC1-L acceptance evidence](../evidence/2026-07-15-rc1-v4-corrected-closed-loop.md)へ固定する。
- machine predicateの`supported=true`はRC1-L artifactの観測値としてacceptするが、RC1 v4のPhase-level support／refute Decisionは
  RC1-Mの独立反証とfull CI後まで保留する。

## Rejected alternatives

- **control／treatmentを別compilerで再発行する:** conditionと測定器が交絡し、v3の非識別性を再導入する。
- **各condition 1 runまたはdigest-onlyで済ませる:** fresh telemetryとportable graph identityを分離できず、再現性とpreimageを監査できない。
- **accepted transformをcanonical worktreeへ適用してから観測する:** experiment interventionと製品source変更が混ざり、rollback／source invariantを弱める。
- **sensor cleanupでtracked bootstrapも削除する:** 実repoのpreimageを変える。generated `.codegraph` stateだけを捨て、既存bootstrap bytesは復元する。
- **normalで1 waveになったためnegativeもparallelへする:** shared manual state conflictを隠し、seamの効果範囲を過大評価する。
- **v3 planへv4 topologyを追記する:** rejected causal contextとpartial patchが新しいagent contextへ混入する。
- **machine `supported=true`をそのままPhase acceptanceにする:** TODO-level related gateとPhase-level独立反証／full regressionの責務が混ざる。

## Consequences

- RC1-Lの実装、実4-run artifact、comparison、plan version barrierは完了し、RC1-Mは保存済みpreimageとsource identityを対象に一度だけ
  P1 correction独立反証を行える。
- observed normal resultはwrite conflicts 3→0、test-write conflicts 1→0、hard precedence 0→0、minimum feasible waves 2→1である。
  shared-state negativeはstate conflict 1、2 wavesを保持する。
- control／treatmentの各2 runはcondition内でportable digestが一致し、raw digestはrunごとに異なる。portable evidenceはfull outcome本文から
  再計算可能であり、raw process stdout／stderr archiveではない。
- transformと4 index runはHEAD、visible status、ignored path status、`src/`／`test/` fingerprintのtyped source invariantを通した。
  このbounded invariantを全repo content invariantとは呼ばない。
- 本DecisionはLattice内の固定fixtureに対するcorrected closed loop artifactのacceptであり、任意repoへの一般化、actual agent dispatch、
  Observer dogfood、dotagents統合、RC1 Phase完了を意味しない。
- dotagents／Observer関連repoのwriter境界とremote作成／push／publish禁止は変えない。
