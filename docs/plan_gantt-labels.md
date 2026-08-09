# 工程表のtask表記改良（gantt-labels-20260809）

オーナー発案（2026-08-09）。円卓の会話では工程が「t7」「r1」「k2」のようにtask_idで呼ばれるのに、
公開工程表の表示は「工程2」のような連番だけで、**会話とUIの語彙が一致しない**。読者は突き合わせに
頭の中で翻訳が要る。task状態の正本はLattice store（plan_key `gantt-labels-20260809`）。

#### g1 工程表へtask_id表記を出す（Lattice）
gantt（html／svg／presentation）のtaskラベルへstoreのtask_idを一次表記として出す
（例:「工程 t7 — Wave 1受入」）。連番しか無い旧データでも壊れない。roomの発言・evidence・
journalと同じ語彙で工程表が読めることが受入条件。
