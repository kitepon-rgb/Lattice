# RC1 v6 causal-binding core evidence

- 日付: 2026-07-16
- plan version: `lattice-research-campaign-1-v6`
- TODO: RC1-V0
- Decision: [ADR 0029](../adr/0029-rc1-v6-causal-identity-preimages.md)

## Preflight

commit `9032b67`後に`codegraph sync .`を実行し、1 added file／20 nodesを索引した。post statusはCodegraph 1.4.1、
47 files、1070 nodes、4063 edges、pending 0、index completeである。

- planned `verifyRc1V6BehaviorReceipt` queryは空、planned pathのaffected testも空だった。未実装／未索引unknownであり、
  依存なしとは扱っていない。
- `verifyRc1V5CampaignArtifactSet`: callers 4、callees 14、impact 5 nodes／7 edges。
- `validateRc1EvidenceBundle`: callers 9、callee 1、impact 18 nodes／19 edges。
- `runRc1V5BlackBoxOracle`: callers 3、callees 10、impact 7 nodes／7 edges。
- related affected testsはoracle、evidence bundle、v4/v5 transform／campaign、v6 characterizationの8件。
- manual unknownはWorker dynamic import／runtime、Git／worktree副作用、raw evidenceがどのsnapshotから生成されたかという
  静的graph外のprovenanceである。

## 実装したpure contract

- behavior receipt: saved oracle exact case列、pass意味論、overall outcome、runtime identity、surface、receipt digest。
- run evidence: v1 raw／diagnostic／portable semantic validationを保持したv2 bundle、typed snapshot、base／patch、
  Codegraph version／executable identity、query、raw evidenceのmeasurement。
- plan predecessor: rejected archive、Decision、accepted transform、behavior envelope、4 bundle descriptorのexact 8件。

実装中、raw base64を含むbundle全体の`digestArtifact`はcanonical string上限で正例を構成できないことを再現した。
raw／diagnostic／portable／measurementの検証済みcomponent digestを列挙するtyped descriptorへ修正し、ADR 0029へ固定した。

## Focused gate

```text
$ node --check src/rc1-v6-causal-binding.mjs
$ node --check test/rc1-v6-causal-binding.test.mjs
$ node --test test/rc1-v6-causal-binding.test.mjs
tests 2 / pass 2 / fail 0 / skip 0
```

corruption scopeはoracle substitution、case欠落／追加／並替え、false pass、runtime drift、snapshot substitution、
Codegraph version drift、raw evidence substitution、predecessor substitutionである。full CIはRC1-Yまで実行していない。

