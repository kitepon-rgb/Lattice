# ADR 0060: 統括Controlを有限budgetで再作成する

## 状態

採用

## 文脈

`phase-control-live-gantt-20260720` は、Phase復活とlive Gantt実装の敵対的検証をdispatchする前に、`max_wall_time_seconds` と `max_cost_microusd` を `null` として初期化された。

Controlは不明な上限のもとでworkerを配置しないため、候補を `budget-unknown` として正しく拒否した。worker run、consultation、repositoryへの実装変更はこのControlから一度もdispatchされていない。

## 決定

旧ControlのTaskを管理上の宣言ミスとしてcancelし、Phase gateを「実作業未開始の中止」として閉じてarchiveする。その後、同じ目的・計画を引き継ぎ、時間と費用の有限上限を明記した後継Controlを作成する。

旧Controlのmanifestは手編集しない。敵対的検証と実装は後継Controlだけからdispatchする。

## 帰結

- `budget-unknown` を迂回せず、配置拒否の理由と再開点が検証可能に残る。
- 旧Controlのworker実績はゼロのままであり、後継Controlとの二重実行は生じない。
- 後継Controlは旧Controlをpredecessorとして明示し、同じLattice planを工程正本として使う。
