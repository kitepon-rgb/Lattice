<!-- raw source record: upstreamの一次資料とローカル実測を保存し、製品主張と自前推論を分離する -->

- 出典: [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph)、
  [LICENSE](https://github.com/colbymchenry/codegraph/blob/main/LICENSE)、
  [README](https://github.com/colbymchenry/codegraph/blob/main/README.md)
- 取得日: 2026-07-15
- 取得方法: upstream GitHub、npm registry、ローカル導入物
  `@colbymchenry/codegraph@1.4.1`のREADME／schema／CLI、Observer indexのread-only queryを照合。
- 確度: 高（license、公開CLI、保存schema、ローカル実測）、中（TODO境界コンパイルへの適用は本研究の設計推論）

## 確認できた能力

- upstream licenseはMIT。改変、再配布、sublicenseを許すが、copyright／license noticeの保持が必要。
- tree-sitter由来のsymbolと、`calls`、`imports`、`extends`、`implements`、`references`等のedgeを
  local SQLiteへ保存する。edgeは`metadata`と`provenance`を持ち、heuristic edgeを区別できる。
- `query`、`explore`、`node`、`callers`、`callees`、`impact`、`affected`を公開する。
  `affected`はsource fileからtransitive import依存を辿ってtest候補を返す。
- unresolved referenceをDBへ保持し、runtime dynamic dispatch、reflection／DI、framework convention等を
  static-analysis frontierとしてREADME自身が明示する。dynamic boundaryの検出はあるが、runtimeの
  実effectや正しいcalleeを常に証明するものではない。

## Observerでの実測

- Codegraph 1.4.1、60 files、1,339 nodes、5,603 edges、WAL、pending changes 0。
- generation lifecycle、Codex host runtime、AI output parser、Mailbox、hook configについて、関連source、
  call path、blast radius、affected testsを返した。
- `src/generation-lifecycle.mjs`と`src/observer-ai-contract.mjs`を入力した`affected`は14 testを返した。
  これはtest候補選択には使えるが、意味上の受入範囲を自動証明するものではない。
- O-PB1の`session.request("thread/read")`はread-only APIとしてsource上で確認できるが、外部Codex
  app-serverのterminal semantics、結果不明、crash後回収はstatic graphだけでは証明できない。

## 現行製品だけでは不足する境界

現行Codegraphは一つのsymbol／fileのimpactを返せるが、複数のTODO候補について次を一つの
machine-readable contractとして生成・比較しない。

1. 候補ごとのowned symbol／path、read dependency、write/effect scope。
2. 二候補間のwrite、semantic、state、external-effect conflict。
3. unresolved／dynamic boundaryを含むconfidenceと、追加証拠の要求。
4. 切断可能な重複を解くbehavior-preserving laneのseam-refactor候補。
5. refactor前後の再index差分と、ready frontier／critical chainへの構造的効果。
6. 複数証拠で受け入れた境界からversioned TODO DAGを生成する閉ループ。

したがってCodegraphは有力な構造sensorだが、schedulability compilerそのものではない。必要な
query／schemaが公開APIで取得できなければ、MIT noticeを維持した所有forkで拡張する。
