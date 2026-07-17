# 0047 — Codegraphを吸収してsensorを自前所有する（L2 fork裁定）

- Status: Accepted / Immutable
- Date: 2026-07-17
- 裁定者: オーナー（2026-07-17 chat。「２を選ぶんだ。Codegraphは、Latticeに完全に吸収される。
  LatticeがCodegraphの立ち位置も奪い取るんだ」）
- 根拠: [RC4 Stage 0実測](../evidence/2026-07-17-rc4-stage0-witness-cost.md)
- 親plan: dotagents `docs/plan_lattice-factory-integration.md` Phase L2
- 前提: [ADR 0040](0040-rc2-post-publication-codegraph-scope-and-artifact-v2.md)（Codegraph scope）、
  [ADR 0046](0046-rc4-writer-target-stage-override.md)

## Context

RC4 Stage 0で、Codegraph `affected`の精度を実測した（dotagents実repo・6 TODO batch）。

`lib/orchestrate/control-record.mjs`の真値（import経路の実在をgrepで検証）は4件。対して:

| depth | 結果 | 誤り |
|---|---|---|
| 1 | 3件 | 偽陰性1（`worker-report-skeleton.test.mjs`＝`import(CONTROL_LIB)`経由） |
| 5（既定・adapterが使う値） | 12件 | 偽陽性8（うち6件は`lib/factory`→`lib/orchestrate`のimport経路が実在しない） |

**真値を返すdepthが存在しない。** グラフが両方向に壊れているためである:

- **余計な辺**: import経路のない到達可能性（factory-scan系がcontrol-recordから到達）
- **欠けた辺**: `join()`で計算されるパスの動的importを解決できない
- **写らない結合**: `spawn`駆動のCLI（`bin/orchestrate-run.mjs`のaffected 0件）

`affected`はupstream READMEで「Traces import dependencies transitively」と定義されるため、
これは意味論の相違ではなく**correctnessの欠損**である。

## Decision

1. **Codegraphを第三者依存として使い続けることを止め、Latticeが構造sensorを自前所有する。**
   Codegraph（MIT、`@colbymchenry/codegraph`）をforkし、Lattice内部のsensorへ吸収する。
   MIT license noticeとattributionは維持する。
2. **却下した代案と理由**（いずれも成立しない）:
   - *depth表現をLatticeへ追加*: **機能しない**。真値を返すdepthが存在しないため、
     depth=1では正しいwitnessに対して逆方向のdriftが出る。辺ごとの誤りを大域閾値で
     補正することは原理的に不可能。
   - *exact一致契約の緩和*: Latticeの中核主張（保存bytesからの独立再計算・drift検出）を
     殺す。sensorの欠陥を契約の緩和で吸収するのは、憲法が禁じる「正規の方法でできないから
     回避で済ませる」に該当する。
   - *upstreamへのissue/PR*: upstreamは3ヶ月停止（最終commit 2026-04-30を`git fetch`で確認）。
     修正の到着を工場の critical path に載せられない。fork後もupstreamへの還元は妨げない。
3. **改良の対象はパラメータでなくグラフ構築のcorrectness**とする。優先順:
   (a) 存在しないimport経路の辺を出さない（偽陽性の除去）、
   (b) 計算パスの動的importを解決する（偽陰性の除去）、
   (c) call graph非可視の結合（spawn・shell・markdown・設定）を索引化する。
   RC4 planが当初「(c)が本命」と想定したのは実測前の推定であり、実測は(a)(b)が先に効くことを示した。
4. **受入基準**: 改良後のsensorは、Stage 0で確立した真値（import経路の実在検証）に対して
   `affected`をexact一致で返すこと。witnessコストがStage 0実測比で有意に下がることを数値で示す。
   下がらない／真値と一致しないなら改良を成功扱いしない。
5. **社会的位置づけ（オーナー裁定）**: LatticeはCodegraphの機能的後継としてその立ち位置を継ぐ。
   dotagents工場内では、単独Codegraph配線（host配線・MCP・session設定）はLattice編入と
   同一planで原子的に退役する（実行と所有はdotagents側＝親plan L3/L7）。

## Consequences

- Latticeはupstream追従の保守コストを自前で引き受ける。これは吸収の必然であり、
  コア製品として品質責任を持つ以上避けられない。
- fork時点のupstream commit（`841beea` 2026-04-30）をattributionへ記録する。
- 親plan L3（Lattice MCP面）はこの自前sensorの上に立つ。したがって「同等以上」の主張は、
  精度が実測で上回ることを根拠にできる（現行Codegraphは真値を返せないため）。
- 本ADRはfork「裁定」であり、実装・退役・配線は親planのL2/L3/L7が所有する。
