<!-- raw source record: 近接先行技術の一次書誌だけを保存し、法的新規性・FTO判断には使わない -->

- 取得日: 2026-07-15
- 取得方法: 公開特許本文、著者／大学公開論文、arXivを照合。
- 確度: 高（書誌と記載機構）、中（仮称Latticeとの差分は本研究の技術的比較）、低（法的新規性・権利範囲）

| source | 近接する機構 | 残る差分 |
|---|---|---|
| [US5797012A, Connectivity based program partitioning](https://patents.google.com/patent/US5797012A/en) | call graph、node／edge weight、interference graphから非干渉なcompilation moduleへpartitionする | 対象はcompiler内部のprocedure。開発TODO、write／effect conflict、behavior-preserving seam-refactor、再index後の計画version化を一体化しない |
| [US20250315253A1, Partitioning code bases for parallel execution of code analysis](https://patents.justia.com/patent/20250315253) | file dependencyから独立partitionを作り、code analyzerを並列実行する | 並列化するのはanalysis job。開発変更の競合を解くcode refactorとTODO DAG生成ではない |
| Homerding et al., [The Parallel Semantics Program Dependence Graph](https://arxiv.org/abs/2402.00986) | semantics-preservingなparallel execution planが守るprogram constraintをgraphへ表す | program execution／compiler最適化が対象。開発成果物、agent ownership、refactor後のTODO再計画を扱わない |
| IBM Research, [Exploring weak dependencies in DAG scheduling](https://research.ibm.com/publications/exploring-weak-dependencies-in-dag-scheduling) | weak dependencyを区別し、conservative precedenceより多いparallelismを取り出す | dependencyをcode architecture変換で除去する開発閉ループではない |

## 技術的裁定

依存graphからpartitionやparallel scheduleを作る個別要素、semantics-preservingなprogram変換、
software task schedulingは既知である。したがって「graphで並列化する」「refactorする」だけを新規性として
主張しない。現時点で残る独自核の候補は、次を一つの開発時閉ループへ結ぶ点である。

1. 複数の開発TODO候補について、symbol／path／state／effect境界とunknownを証拠化する。
2. write／semantic conflictが小さく解消可能な時、将来のschedulabilityを目的とする挙動不変refactorを挿入する。
3. characterization gate後に再indexし、境界分離と影響範囲を前後差分で検証する。
4. 複数証拠で受け入れた境界からimmutableなplan version、precedence、conflict、capacity、joinを生成する。
5. 実行時のfalse dependency／missed conflict／integration failureを次の境界変換へ還流する。

これは技術的差分の仮説であり、法的新規性、進歩性、自由実施を結論しない。
