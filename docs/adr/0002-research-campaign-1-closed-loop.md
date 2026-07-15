# ADR 0002: Research Campaign 1を閉ループ介入比較にする

- 状態: Accepted
- 日付: 2026-07-15
- supersedes: ADR 0001の「manifestまでを最初のvertical sliceとする」という実行順。製品境界とbootstrap裁定は維持する。

## Context

Wave 1〜4を機能別に順番に実装すると、Latticeの核心である「TODO境界を観測し、code seamへ介入し、
再index後に旧planを失効させて新versionへ再compileする」仮説を長期間検証できない。また、並行開発中の
Observerを最初のfixtureにすると、外部codebaseの変動とLatticeの介入効果を分離できず、writer境界も曖昧になる。

## Decision

### 1. 最初の実装単位

Research Campaign 1（RC1）は旧Wave 1〜4を横断する一本の閉ループとする。manifest、conflict、transform、
reindex、plan diffの各機能を一般完成させてから結合せず、同じ研究fixtureを最後まで通す最小の厳密実装を先に作る。

### 2. 研究fixture

Lattice内に`buildDispatchRecord`という単一symbolがchannel選択とlabel整形を同時に所有するfixtureを置く。
将来変更TODO `channel-policy`と`label-policy`は同じsymbol／pathをwriteするため、変換前は同時dispatchできない。
seam変換は現挙動を変えず、channel選択とlabel整形を別symbol／別moduleへ抽出し、元symbolをcompositionだけへ狭める。

manual evidenceの通常条件では両TODOをpure、shared stateなし、external effectなしとする。negative controlでは
両TODOに同じ`dispatch-registry` state writeを与え、pathが分かれても`parallel_ready`にならないことを要求する。

### 3. 識別戦略

- **核心仮説 H1:** accepted seam変換だけを加えると、挙動とTODO outcomeを維持したままwrite conflictが1件から0件へ減り、
  capacity 2で必要なconflict-feasible wave数が2から1へ減る。compilerはtransform artifactをpredecessorに持つ
  新plan versionを生成し、旧plan／agent context／途中patch／interface仮定を失効させる。
- **対立仮説 H0-a:** conflictは本質的なsemantic／state／effect結合であり、抽出後も安全な並列幅は増えない。
- **対立仮説 H0-b:** 観測された改善はquery set、TODO定義、manual evidence、capacityの変更による交絡で、
  seam変換の因果効果ではない。
- **対立仮説 H0-c:** 構造上の幅は増えても、behavior divergence、unknown増加、またはversion barrier不成立により
  accepted planとして使えない。
- **control condition:** original fixtureを変換せず、boundary compileとplan compileだけを行う。
- **treatment condition:** 同じaccepted fixture artifactから作ったdisposable worktreeでseam変換を行い、
  characterization gateを通過したartifactだけを再index／recompileへ渡す。
- **independent variable:** accepted seam transformation artifactの有無。TODO outcome、manual evidence、query-set digest、
  verifier、capacity、tool versionは固定し、変わるのはcode snapshotとそこから導出されるgraph evidenceだけとする。

### 4. 観測と受入

変換前後で同じquery setを使い、Codegraph status、対象symbol、caller／callee、impact、affected testを記録する。
symbol不在、空結果、stale／unresolved、CLI failureはtyped evidenceにし、依存なしへ丸めない。Codegraphは構造証拠であり、
manual state／effect、characterization、negative control、親reviewと合わせてのみparallel boundaryをacceptする。

transformはcanonical worktreeを変更せず、disposable worktree内だけで実行する。behavior gateが失敗したartifactはrejectし、
再index結果が良くても新planへ採用しない。accept時は旧topologyへ追記せず、plan diffとinvalidation一覧を持つ新versionを作る。

### 5. 成功と反証

RC1の成功は一般的な経済効果や自動refactor全般の証明ではなく、次を同時に再現できることとする。

1. controlが`seam_candidate`、write conflict 1、capacity 2でminimum feasible waves 2を返す。
2. treatmentがbehavior gate green、write conflict 0、hard dependency増加0、minimum feasible waves 1を返す。
3. negative controlが変換後もshared-state conflictを保持し、`parallel_ready`を拒む。
4. 同じ入力からcanonical artifactとdigestを再生成できる。
5. new planがaccepted transform artifactをpredecessorとして参照し、旧contextを明示失効する。

query／input drift、behavior divergence、negative controlのfalse parallel、隔離外write、失効漏れのいずれかがあれば
実験は成功扱いしない。Codegraph公開面が必要な証拠を取得できない場合は、空結果で継続せず、adapter契約または
upstream／正式forkの設計変更条件として記録する。

## Consequences

- schema、sensor、compiler、transformer、version barrierはRC1に必要な幅だけ実装し、閉ループから外れる一般化は後続へ送る。
- Observer dogfoodとdotagents工場統合は、RC1の機構実証とPhase監査が完了するまでhard dependencyを持つ。
- Lattice外repoはread-onlyであり、RC1のfixture、state、evidence、worktreeはLatticeが所有する。
- 既知refactor classだけへの恒久限定、read-only推薦器への縮小、製品価値や法的新規性の主張は本ADRのDecisionに含めない。
