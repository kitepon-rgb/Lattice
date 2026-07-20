# Lattice — 製品思想

Latticeは、ソフトウェア計画を線形TODOリストとして記述する道具ではない。要求、成果物、codebase、
実行資源から、実際に並列開発できる計画をコンパイルし、必要ならコード構造そのものを変換する製品である。

## 1. 核心

既存schedulerの多くは、task graphとcode architectureを固定入力として受け取る。Latticeは固定しない。
二つのTODOが同じ境界を争う時、ただ直列化するのでなく、切断可能なseamを見つけ、挙動不変レーンの
refactorを実行し、再解析後に新しいTODO graphを作る。

```text
goal / outcomes
      ↓
TODO candidates
      ↓
code + state + effect boundary analysis
      ↓
precedence / conflict / capacity / join
      ↓
parallel-ready ───────────────→ plan version
seam-candidate → code transform → re-analyze → new plan version
unknown ───────→ evidence acquisition
serial ────────→ intentional critical chain
```

新規性の中心はDAG、構造sensor、refactorの個別要素ではなく、**予定されたmulti-agent開発TODOの純並列便益を
目的にcode architectureへ介入し、旧planと旧contextを失効させ、全TODO graphを再コンパイルする閉ループ**にある。

## 2. 八原則

1. **コード構造は制御変数** — 現在のmodule境界を運命として受け入れない。
2. **外層TODO graphが第一の並列面** — 一つの巨大TODOへworkerを詰め込まず、成果物単位のready frontierを作る。
3. **依存と競合を分ける** — precedence、write／semantic conflict、capacity、joinを一つのedgeへ潰さない。
4. **構造sensorを使い切る** — Lattice内蔵sensor、build/test graph、schema、runtime trace、git historyを複合する。
5. **未知を安全へ丸めない** — dynamic dispatch、state、effect、外部semanticsは明示的unknownとして次の実験へ送る。
6. **計画はversioned program** — active topologyはimmutable、発見と変換は新versionとして適応する。
7. **実変換まで行う** — 推薦で止まらず、隔離実行、検証、再index、再compileを製品が担う。
8. **ブロッカーには立証責任** — 前例や常識で研究を止めず、コード・論理・実験だけで止める。

## 3. 製品が所有する五層

1. **Outcome compiler**: product outcomeをdispatchable TODO候補へ分解する。
2. **Boundary compiler**: symbol、path、state、effect、test、unknownをmanifest化する。
3. **Conflict optimizer**: hard dependency、conflict、capacity、critical structureを構成する。
4. **Seam transformer**: 並列性を解放するcode変換を生成・隔離実行・検証する。
5. **Plan compiler**: accepted artifactとversion barrierから次の実行graphを生成する。

## 4. 内蔵sensorとの境界

Latticeは旧上流由来実装をMIT attribution付きの内蔵sensorとして吸収し、sensorのruntime、配布、
schema、failure contractを自ら所有する。sensorはsymbol、call、import、reference、impact、affected test、
heuristic provenance、dynamic frontierを扱う。一方、複数TODOの意味上の競合、外部effect、refactorの
純便益、plan invalidationはLattice本体が所有する。

低層graph情報が不足する場合はLattice repo内のsensorを正式に強化する。独立した外部CLI／SDKや
installed package patchへ逃げず、index不在・破損・version不整合はtyped failureまたは明示guidanceにする。

## 5. 成功の定義

成功はTODO数やworker数の増加ではない。

- 同じ品質条件で完了までのcritical chainが短くなる。
- false dependencyとwrite／semantic conflictが減る。
- refactor、review、replan、merge、rollbackを含む純費用に対して並列便益が残る。
- 旧plan／contextの混入を防ぎ、再現可能なversioned evidenceを残せる。
- 人が思いつかなかった有効なcode seamと実行graphを発見できる。

## 6. 研究の扱い

論文、特許、既存製品は仕様書でなく踏み台である。先行技術の存在から製品価値を否定しない。
失敗した変換も、境界modelとverifierを改善する教師データとして保存する。

現在の工程状態は本repoのLattice storeを正本とする。文書の役割と現行導線は
[docs/README.md](docs/README.md)、公開contractは[docs/00_product-contract.md](docs/00_product-contract.md)、
研究証拠は[rag/INDEX.md](rag/INDEX.md)を正とする。
