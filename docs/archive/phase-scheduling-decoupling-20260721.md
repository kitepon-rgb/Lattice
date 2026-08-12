# Phase scheduling decoupling evidence

- Date: 2026-07-21
- Scope: Lattice v5 contractとAIShell dogfood
- Confidence: high

## Contract result

- v4の「Phase acceptまで後続ToDoを閉じる」characterizationは維持した。
- v5では後段Phaseが監査上`locked`でも、ToDo DAG上readyなToDoを開始できる。
- `phase_accept_dependencies`を持つToDoだけはPhase acceptedまでstart/doneを拒否する。
- task・所属Phase gate・Phase監査順・明示accept dependencyを合わせたcycleをactivation前に拒否する。
- `lattice.plan_create_input.v3`と`lattice.phase_todo_revision.v2`からv5を作成・昇格できる。
- Phase数、監査回数、required evidence slotを増やす変更はない。

## Verification

関連107 testを実行し107/107 green。対象はproject discovery/create、todo CLI、store、v4 Phase回帰、v5、
revision set、crash recovery、evidence、cross-plan transitionである。

AIShell planをv4からv5へ原子的に昇格した。49 ToDo、8既存Phase、Phase定義とrequired evidence slotは変更なし。
明示accept dependencyは既存の製品評価境界`phase-6 → ace-070`の1件だけである。

AIShellの保存済み測定
`.lattice/evidence/aishell-phase-decoupling-measurement-20260721.json`では、ToDo DAGは24 round、
最大並列幅11を維持する。v5のPhase audit合成modelは26 roundで、同じPhase DAGを暗黙schedule gateとして扱う
v4 modelの28 roundより2 round少ない。これは監査削減ではなく、監査待ちを通常ToDoへ波及させない効果である。

Codegraph runtime/cache/dataは入力にもfallbackにも使用していない。AIShellの既存compile evidenceは
bundled Lattice sensor identityを検査済みである。
