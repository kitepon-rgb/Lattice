# RC2 plan reconsideration evidence

- 日付: 2026-07-16
- 対象HEAD: `54fb7958045f19c4a288a09693ff122d25ca595f`
- 対象plan: `lattice-research-campaign-2-v1`
- Decision: [ADR 0032](../adr/0032-rc2-bounded-graph-compiler-and-three-way-seam.md)
- 操作範囲: Lattice read-only inspection。本文書作成前にsource／test変更なし

## Reused baseline

RC1 v6 Phase gateのfull `npm run ci`は97 pass、0 fail、0 skip、静的check成功だった。以後のcommitはimmutable artifactと
docs裁定であり、現在のtracked tree identityは次のとおりである。

| input | git object |
|---|---|
| `src/` | `5129b4625890138f14f28af97cddf655e7233e08` |
| `test/` | `1377f5d57186869750bc386a360796bb6fc1cd8b` |
| `package.json` | `330dc427df17edb12810982c90e3ba996a192cbc` |
| `package-lock.json` | `efa1ab48ee0a4472951fdc7d72ffe63595a6df80` |

同じsource／test treeのfull gateをplan検討だけのために再実行していない。次のfull regressionはRC2 Phase gateへ集約する。

## 実コードで再現した未証明境界

1. `src/boundary-compiler.mjs`の入口はTODO数2／capacity 2を固定し、verdict IDもRC1 fixtureに固定する。
2. `src/artifact-contracts.mjs`の`boundary_verdict.v1`は一verdictのTODO数をexactly 2へ固定する。
3. 現schedulerはedgeが一件でも全TODOをsingleton waveへ置くため、3 TODO＋1 edgeを2でなく3 wavesにする。
4. `plan_graph.v1` validatorは全edgeへ`wave(from) < wave(to)`を要求し、unordered conflictとprecedenceを区別しない。
5. validatorは`minimum_feasible_waves === waves.length`を確認するだけで、より短いfeasible scheduleの不存在を証明しない。
6. surface existenceはCodegraphで確認するが、TODO ownership自体はcandidate specから与えられる。これは明示witnessであって自動発見ではない。
7. unknown propagationは2 TODO前提の実装を単純にcardinality緩和すると第三TODOをfail closedにできない経路がある。
8. v6 artifact verifierはtrusted current RC1 compilerでreplayするため、既存compilerの置換はimmutable artifactの検証を壊し得る。

## 独立反証の採用結果

既にrouting確認済みのread-only refuterとCriticが、Lattice実コードだけで候補planを一回ずつ反証した。編集、test、Codegraph mutation、
dotagents／Observer参照は行わせていない。重複を統合し、次をplanへ採用した。

- K3、empty、single edgeだけでなく、A-B-C path、disconnected edge＋isolated、capacity-only、hard need＋conflictを入れる。
- TODO順列、ID／resource renameでisomorphic resultを要求する。
- third-only unknownをtyped non-dispatchableにし、minimum scheduleへ丸めない。
- candidate/pathを見ないnormalized graph coreとfixture front-endを分離する。
- schedule producerと独立したbounded exact verifierを持つ。
- candidate specをmanual ownership witnessと明記し、自動ownership discoveryをclaimから外す。
- registry shardを別seam classと呼ばず、3-way arity／topologyの実証に限定する。
- adapterはpatch／scope／oracleだけを所有し、conflict／expected waves／ownershipを注入しない。
- transform failure、unknown、v6 compatibility、stage別cost／reworkをPhase条件へ加える。

「二fixtureでは何も分からない」「read-onlyへ縮小すべき」「野心的すぎる」「価値未実証」といった実コード／論理／実験に
結び付かない懸念はfindingとして採用していない。

## Baseline conclusion

RC1 v6の閉ループsupportは保持する。次の最小の反証力あるCampaignは、旧moduleを可変化せず、new v2 contractでN=3の部分競合と
capacityを識別し、manual witnessからnormalized graphを作るfront-end、candidate-neutral scheduler、fixture-specific transform adapterを
分離した上で、同じfresh reindex／behavior／version barrierを再び閉じることである。
