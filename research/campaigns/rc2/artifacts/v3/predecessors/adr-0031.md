# ADR 0031: RC1 v6は固定fixtureでschedulability compilerの閉ループ仮説をsupportする

- 状態: Accepted
- 日付: 2026-07-16
- 対象plan: `lattice-research-campaign-1-v6` / RC1-Y
- 対象Control: `lattice-rc1-closed-loop-v3`
- predecessor: ADR 0028、ADR 0029、ADR 0030
- evidence: [RC1 v6 Phase gate](../evidence/2026-07-16-rc1-v6-phase-gate.md)
- machine artifact: `research/campaigns/rc1/artifacts/v6`

## Context

ADR 0028はv5のmechanism evidenceを保持しつつ、保存oracle semantics、runtime、source snapshot preimage、Codegraph executable
identity、plan predecessorの因果binding不足によりPhase-level supportをrejectした。ADR 0029とADR 0030はこれらをtyped preimage、
exact artifact set、実行主体bytes、artifact-only verifierへ置き換えた。

RC1 v6は、複数TODOがproductionとtestの同じwrite boundaryを争うLattice内fixtureに対し、control／treatment各2 fresh Codegraph
index、同じcompiler、normal／shared-state negative、隔離seam transform、fixed-runtime black-box oracle、全plan recompileを実行した。

## Decision

核心仮説H1-v6を、固定fixtureとcooperative isolated-worktree threat modelの範囲でsupportする。

- controlは3 write conflicts（うちtest 1）を観測し、`seam_candidate`、minimum 2 wavesになった。
- accepted production＋test seamだけを適用したtreatmentはwrite conflicts 0、unknown 0、`parallel_ready`、minimum 1 waveになった。
- shared state writeを加えたnegativeはtreatmentでもstate conflict 1、`intentional_serial`、minimum 2 wavesを保持した。
- pre／post oracleは保存exact case semanticsと固定runtimeへ一致し、source invariantは両条件trueだった。
- plan diff v3は8 predecessorから旧planを失効し、新plan全体を再compileした。
- immutable v6 disk verifierは12 checksを保存payloadから再計算し、failed conditions 0だった。
- full `npm run ci`は97 pass、0 fail、0 skipで、静的checkも成功した。

このsupportは「任意repoで常に1 waveになる」「一般的速度改善率が確定した」「artifact発行者の真正性を暗号学的に証明した」
という主張ではない。

## 対立仮説の裁定

- **H0-a: fixture境界は本質的に直列:** treatment 1 waveとnegative 2 wavesの分離により、このfixtureでは反証された。
- **H0-b: 改善はcompiler／input／Codegraph drift:** compiler source、candidate、query、manual evidence、capacity、oracle、runtime、
  Codegraph identityをfixed inputと全runへ結合したため、生き残らない。
- **H0-c: seamは挙動を変える:** fresh Worker oracleのpre／post exact case一致とaccepted output snapshotにより、生き残らない。
- **H0-d: digest再封印だけで偽のsupportを作れる:** v5反例をcharacterizationへ保持し、v6 semantic verifierがoracle、case、runtime、
  snapshot、raw evidence、predecessor、identity bytes、media typeのsubstitutionをrejectするため、生き残らない。

## Rejected alternatives

- **v5 Phase supportを復活させる:** ADR 0028の再現反例を解消しない。
- **temp fixture testだけでsupportする:** canonical 2+2 artifactとdisk replayを欠く。
- **media type誤分類candidateを手補正する:** immutable writerと再現可能性を破る。候補全体をrejectし新baseから再発行した。
- **単一fixtureの結果を一般化する:** RC1の識別対象を越える。
- **保存実行codeをverifierが実行する:** untrusted artifactによる任意コード実行になる。

## Consequences

- Latticeは、TODO境界観測、typed conflict／verdict、seam候補、隔離挙動不変変換、fresh reindex、negative control、
  新plan versionへの全再compileという最小閉ループを実証済みと扱う。
- v6 artifactとplan versionは不変であり、後続研究は追記変更せず新しいplan versionを作る。
- 次の研究で一般化を主張するには、別fixture／別repo、複数seam class、失敗case、cost／rework指標を独立変数を崩さず追加する。
- signing、transparency、remote attestation、敵対的な実行中PATH差替えは別のtrust-root研究として扱う。
