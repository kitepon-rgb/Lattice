# ADR 0017: RC1 v4の識別性safety netを実装より先に固定する

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v4` / RC1-H
- predecessor: [ADR 0016](0016-rc1-v3-phase-gate-rejection.md)

## Context

RC1 v3はproduction seamを実行できたが、control／treatmentで別compilerを使い、future TODOが共同で変更する
`test/research-dispatch-record.test.mjs`をwrite boundaryへ含めず、portable Codegraph preimageと完全success predicateも
保存しなかった。Phase gateはこの因果結論をrejectし、v4では修正実装より先に識別性を固定するよう要求した。

source編集前の実Codegraph preflightでは既存compiler、transform、runner、fixtureのownerと影響を解決できた。一方、
予定new surfaceはquery `[]`、caller／callee／impactはexit 0の非JSON `Symbol not found`、affected test `[]`であり、
依存なしでなくtyped unknownだった。また`affected <未存在test path>`もpath自身をaffected testとして返すため、affectedの
非空はtest fileの存在証明にならないことを実測した。

## Decision

### 1. conditionを入力に持たないsingle compilerを唯一の測定入口にする

pre／postは同じ`compileBoundaryCondition`へ、同じplan input、candidate spec、query set、manual evidence、capacityを渡す。
compilerは`condition=control|treatment`のようなselectorを受理しない。code snapshotごとのexact graph outcomeだけからactive
surface、unknown、write intersection、typed conflict、verdict、planを導出する。

### 2. productionとfuture test writeを同じcandidate specへ固定する

`lattice.rc1.boundary_candidate_spec.v2`は各TODOのcurrent／proposed production symbol＋pathとtest symbol＋pathを持つ。
controlでは両TODOがshared composition test pathを書き、treatmentでは`channelPolicyContract`と
`labelPolicyContract`をexpected pathへexact解決できた時だけconcern別test writeへ移る。

test存在はCodegraphの`node.name`または`node.qualifiedName`完全一致とexpected `filePath`で確認する。fuzzy match、affectedの
self-only結果、空結果、exit 0非JSONをexact resolutionへ丸めない。TODO outcomeとどのassertionを変更するかはcandidate specの
manual provenanceへ残し、Codegraphだけでsemantic ownershipを証明したことにしない。

### 3. query setとblack-box oracleを条件間で固定する

`lattice.codegraph_query_set.v2`はanchor、proposed production、shared test file、proposed test contract、全affected pathを
同じ17 queryで観測する。`lattice.rc1.black_box_behavior_oracle.v2`は正常2件、validation failure 6件を持ち、oracle inputと
executorをtransform scope外に置く。変換されたtest自身だけをbehavior preservationの証拠にしない。

### 4. 6つの赤を実装gateにする

focused characterizationは7 tests中、fixed input 1件だけpassし、次の6件を意図どおりfailした。

1. single compiler未存在
2. shared future test writeをmanifestへ含めるcompiler未存在
3. transform外black-box oracle未存在
4. digest-only v3 evidenceをrejectするbundle validator未存在
5. 不完全なv3 success predicateをrejectするevaluator未存在
6. 現行isolation runnerが既存ignored protected fileのcontent-only mutationを検出しない

このredを旧v3期待値へ弱めず、RC1-I／J／Kがそれぞれ担当面をgreenへする。full regressionはsource収束後のPhase gateまで
実行しない。

## Bound artifacts

| artifact | SHA-256 |
|---|---|
| `docs/evidence/2026-07-15-rc1-v4-correction-preflight.md` | `d5820ae4e00c76daf32e6bdc4ff0f2f0f5067d02d29f5c9383bcc2dd1992ce37` |
| `research/campaigns/rc1/inputs/candidate-spec-v2.json` | `83fc247e4206c880afa0a22534e2191a4959a68f52b7b76e4d1f0aef6684f5e7` |
| `research/campaigns/rc1/inputs/query-set-v2.json` | `cfdceeda781b06dfd274cc6c3dc159cb90726f58c5dc8b4b73296a30d1cf220e` |
| `research/campaigns/rc1/inputs/behavior-oracle-v2.json` | `b6338fef3c3fd15e9a17418fd76c52b73ba61966c232d839d2c2c845e5f8d0d7` |
| `test/rc1-v4-characterization.test.mjs` | `6f73b319e36108974ae8931c270eaf36edee41897e256c0d3fab55a8e5054951` |

## Rejected alternatives

- **旧query setへtest pathだけ足す:** affectedのself-only結果で未存在testを存在扱いでき、false resolutionを残す。
- **test ownershipをmanualだけで決める:** graph上のsurface存在を検証せず、condition別期待値と同じ交絡を再導入する。
- **変換後testをoracleにする:** transformが期待値も同時に書き換えられ、behavior preservationが自己証明になる。
- **safety gapはfixture被害がないので無視する:** temp repoでcontent-only driftの見逃しを再現できている。
- **赤testを同じcommitで直す:** safety netが先に存在した証拠を失う。

## Consequences

- RC1-Iはsingle compilerとcomplete predicate、RC1-Jはproduction＋test seamとblack-box oracle、RC1-Kはfull preimageと
  protected source fingerprintを所有する。
- lane scopeは本Decisionのinput schemaとred failure surfaceを変更しない範囲でだけ並列化できる。
- v3 artifactはhistorical mechanism evidenceとして不変に保ち、v4 artifactを別versionへ発行する。
- Observer／dotagentsはread-only、remote作成・push・publishは禁止を維持する。
