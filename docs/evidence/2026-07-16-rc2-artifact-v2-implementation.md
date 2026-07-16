# RC2 artifact v2 implementation

- Date: 2026-07-16
- Decision: [ADR 0040](../adr/0040-rc2-post-publication-codegraph-scope-and-artifact-v2.md)
- Characterization: [RC2 artifact v2 characterization](2026-07-16-rc2-artifact-v2-characterization.md)
- Scope: Lattice only
- Classification: F。sensor scope、execution identity、immutable artifact schema、plan version barrierの契約変更を親が直轄した。

## Codegraph preflight

characterization commit後に明示`codegraph sync .`した時点では90 files、2,514 nodes、9,690 edgesで、RC1 v6の2 filesと
RC2 v1の12 files、合計14個のartifact `identity/*.mjs`が収載されていた。live sourceと保存preimageの同名symbolが二重に
exact queryへ現れ、caller／callee／impactも両pathを混合した。空結果や独立とは扱わず、sensor identity ambiguousと記録した。

tracked `codegraph.json`は次の1 patternだけを持つ。

```json
{"exclude":["research/campaigns/**/artifacts/**/identity/"]}
```

config commit `9a846f0`後のfresh-clone integrationは1/1 greenだった。明示sync後のworkspace indexもartifact identity 14 filesを
削除し、live campaign／artifact set／campaign test／integration testを維持した。

最終source postflightはCodegraph 1.4.1、76 files、1,907 nodes、7,265 edges、complete、pending changes 0、pending refs 0、
artifact identity 0だった。public RC2 exportsと主要内部symbolはlive pathへexactに一意解決した。一般名`artifactContext`だけは
RC1 v5／v6の別owned symbolもexact候補に持つため、name-only relationは引き続きambiguousであり、RC2 pathとのexact一致を要求する。
2 changed source pathsのaffectedは`test/rc2-campaign.test.mjs`、traversed dependents 2だった。

## 実装した境界

- campaign入口はexplicit `artifactVersion: "v2"`だけを受理し、result schema v2と`artifact_version`を発行する。
- target repoの`codegraph.json` actual bytesを開始前後に読み、Codegraph identity v2、identity digest、各fresh run、
  `identity/codegraph-config.json`へcross-bindする。config SHA-256は
  `47f04b1f8d9a5e489ffac0295a2630000e34ac5179d8707e7ba878b9d606d388`である。
- verifierはmanifest schemaからcompile-time exact setを選ぶ。v1は67 payload／14 checksのまま、v2は71 payload／15 checksで、
  config exact bytesを専用`codegraph_config_binding`で検査する。
- v2 writerは`artifacts/v2`だけへatomic writeし、既存rootを上書きしない。v1 writerは再公開せず、disk readerだけを維持する。
- v2はADR 0040、v1 manifest、v1 new plan、configの4 payloadを追加する。copied v1 manifestの
  `new-plan-version.json` entryをcopied bytesへ再hashし、v1 plan version `rc2-delivery-policy-v2`を検査する。
- plan `rc2-delivery-policy-v3`はv2 plan object全体をpredecessor digestに持ち、31 causal predecessorをcross-bindする。
  old plan、agent context、partial patch、v2 interface assumption、v2 boundary evidenceを失効する。
- control／treatmentの独立変数、6 fresh run、12→0 conflict、3→1 waves、partial／capacity／unknown、RC1 transfer metricは変更していない。

source candidate SHA-256:

- `src/rc2-campaign.mjs`: `4c8be93c1bbc74a55fbcf50f225850d103f3ff849b36795a93a98174ec8185f8`
- `src/rc2-artifact-set.mjs`: `d65f62bc42a1e91c8cc1c1985d1af862f53469dd161a11f6819ee6b129003c02`

## Gates

- fresh Codegraph scope integration: 1 pass / 0 fail。
- v1 disk compatibility spot gate: valid、14 checks、failed 0。
- 初回campaign focused: 4 pass / 1 fail。唯一のfailureはconfig actual bytesの末尾改行をartifact canonical JSON parserが
  先に拒否した`exact_artifact_set`だった。
- failure scope修正: configをbyte-preserving parseし、専用exact bindingへ責務を分けた後、artifact writer 1 pass / 0 fail。
- TODO related campaign gate: 5 pass / 0 fail。v1 14 checks、v2 15 checks、config／v1 predecessor／patch／plan／cost／raw evidenceの
  manifest-resealed corruption reject、disk corruption rejectを含む。
- syntax: changed 2 source filesともgreen。`git diff --check` green。

full `npm run ci`はPhase gateへ集約しており、このTODOでは実行していない。canonical artifact v2の発行、H0c.3、Phase反証は未実施。
artifact v1、dotagents、Observer関連repo、remote、push、publishは変更していない。
