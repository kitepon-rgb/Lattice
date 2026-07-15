# ADR 0001: Latticeを独立製品としてbootstrapする

- 状態: Accepted
- 日付: 2026-07-15

## Context

Codegraphは構造sensorとして有用だが、goal decomposition、複数TODOの競合、seam transformation、
version barrier、plan compileを所有しない。これらをCodegraphやdotagentsへ埋め込むと製品責務が混ざる。

## Decision

1. Latticeを`/Users/kite/Developer/Lattice`の独立git repoとして開発する。
2. Latticeの思想、研究、Decision、TODOは本repoが所有する。dotagentsへ先端研究の規則を直接置かない。
3. Node.js ESM、Node 22.13以上、標準test runnerでbootstrapする。
4. 最初のvertical sliceは、明示されたTODO候補からCodegraph evidenceを集め、
   `lattice.boundary_manifest.v1`を生成するところまでとする。
5. bootstrap commit直後にCodegraph indexとSpotter project設定を導入する。
6. 次waveから、全source TODOをboundary manifestでコンパイルしてからdispatchする。
7. Codegraph公開面の不足が再現した時は諦めず、upstream寄与またはMIT notice付き所有forkを選ぶ。

## First vertical slice

```text
plan_input.v1
  ├─ schema/canonicalizer
  ├─ Codegraph adapter
  └─ manual state/effect evidence
          ↓
boundary_manifest.v1
          ↓
typed verdict + digest
```

実変換engine、plan recompile、Observer dogfoodは後続waveだが、製品scopeから除外しない。
