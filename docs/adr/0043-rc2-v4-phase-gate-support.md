# ADR 0043: RC2 v4は3-way registry fixtureで世代固有witness付き閉ループをsupportする

- Status: Accepted
- Date: 2026-07-16
- Scope: RC2-H3 Phase gate、canonical artifact v4、plan v5
- Predecessors: [ADR 0041](0041-rc2-artifact-semantic-oracle-mutation-binding.md)、
  [ADR 0042](0042-rc2-artifact-version-witness-epoch-and-v4.md)
- Evidence: [RC2 artifact v4 Phase反証](../evidence/2026-07-16-rc2-v4-phase-refutation.md)
- Machine artifact: `research/campaigns/rc2/artifacts/v4`

## Context

RC2は3 TODOが同じdelivery-policy registry symbol／pathとshared testを争うfixtureを、behavior-preservingな3-way registry shardで
分離し、同じnormalized graph coreへcontrol／treatment、partial-state、capacity、unknown、RC1 transferを入力する実験である。

ADR 0041はartifactのoracle／mutation semanticsをtrusted current sourceから再計算するよう修正した。続くPhase反証では、v2 common
payloadをv3 envelopeへ全digest再封印すると旧candidate／oracle epochを15 checksで誤受理する世代不整合が再現した。ADR 0042はartifact
versionをexact witness pairへbindし、accepted／rejected transform source baseをmanifest／run baseへcross-bindし、v4／plan v5へ再compileした。

canonical v4発行後、fresh Codegraph coverage、v1〜v4 replay、related、full gateを完了し、RC2成功条件25件を親が反対仮説から再検証した。

## Decision

H1-RC2を、Lattice内の3-TODO delivery-policy registry fixture、manual ownership witness、cooperative isolated-worktree threat modelの
範囲でsupportする。

1. controlは12 write-conflict records／3 pairs、capacity 3でminimum 3 wavesである。
2. accepted registry shardだけを加えたtreatmentは0 records／0 pairs／unknown 0、minimum 1 waveである。
3. partial-state negativeは1 conflict／2 waves、capacity 2 controlは0 conflict／2 wavesを保持する。
4. RC1 transferは同じcoreで3→0 normal conflicts、negative 4→1、2→1／2 wavesを維持する。
5. fixed oracle 6 casesと6×4 mutation matrixはbehaviorとtest ownershipをcross-bindし、incomplete／scope violationはoutputなしでrejectする。
6. v1／v2はlegacy witness、v3／v4はsemantic witnessを要求し、旧epochの正規再包装を拒否しつつ14／15／15／15 checksのread compatibilityを保つ。
7. plan v5はplan v4をpredecessorに39 causal predecessorsをexactly once持ち、email／sms／push全件を再compileして5 contextを失効する。
8. canonical v4は79 payload／80 disk files、manifest payload digest不一致0。relatedは40／40、最終fullは174／174、静的checkも成功した。
9. RC2成功条件25件に生き残るP0／P1 findingは0である。

このDecisionは別実行者による独立監査済みとは主張しない。Control予算上限により親がread-onlyで反対仮説から再検証した。finding採用基準は
実コード欠陥、論理矛盾、非識別実験、一次証拠誤り、実験反証、具体的安全事故に限定した。

## Support boundary

supportするのは次の範囲である。

- manual witnessからprovenance付きboundary graphを作り、generic bounded coreでminimum scheduleを独立検証する。
- production／test ownership partitionの3-way arityとpartial conflict／capacityを区別する。
- 隔離変換、black-box oracle、mutation、fresh reindex、全plan recompileを一つの保存可能な因果鎖にする。
- artifact version固有のactive witnessとbase relationを保存bytesから検査する。

次はsupportしない。

- requirements／自然言語からownershipまたはseamを自動発見したというclaim。
- actual multi-agent wall-clock改善、一般的速度改善率、任意repo／別seam classへの一般化。
- 署名、remote attestation、保存process outputの真正性、malicious trusted-verifier replacement。
- 9 TODO以上のexact最適schedulerやproduction deployment。

## Rejected alternatives

- **v3を最終successorとして再採用する:** 旧epoch再包装の実行可能反例を解消しない。
- **front-end compatibilityを廃止して旧artifactを拒否する:** read compatibilityとversion固有acceptanceを混同し、immutable predecessor replayを壊す。
- **canonical v1〜v3を修正する:** 保存済み履歴とpredecessor relationを破壊する。
- **Phase gateをfull greenだけで閉じる:** semantic substitutionと世代不整合が過去にfull greenを通過した事実を無視する。
- **一般的保守論または価値判断でscopeを縮小する:** 再現欠陥、論理矛盾、実験反証ではない。

## Consequences

- canonical artifact v4、plan v5、本ADRをRC2の不変successorとして扱う。追記変更せず、後続修正は新version／新ADRで行う。
- v1〜v3の既知findingと最初のfull 173／174を削除せず、corrected successorのcausal historyとして保持する。
- 旧plan／agent context／partial patch／interface assumption／boundary evidenceは失効済みであり、dispatchへ再利用しない。
- 次の研究は別fixture／repo、別seam class、実agent dispatch、cost／wall-clockの外的妥当性を新しいplan versionで扱う。
- dotagents／Observerへの導入、remote作成、push、publishは本Decisionの効果に含めない。
