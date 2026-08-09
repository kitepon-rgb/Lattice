# st1 撤回実装の証拠

## 結論

`start_retracted` を追記する `lattice todo retract` を実装した。最新の authored start と
同一 actor へ束縛し、projection は `in-progress` から `pending` へ戻る。active pull intake
がある間は撤回を拒否し、同一 actor の `run intake release` 後だけ撤回できる。

実装commitは次の3本。

- `f70148e`: runtime CLIを含む境界宣言の補正
- `27eeec1`: event、projection、CLI、pull intake release、focused test
- `79f3a40`: attach済みworkerを観測不能にしないrelease拒否の補正

## 固定した契約

- 履歴は削除せず、reasonと対象start digestを持つeventを追記する
- pending、blocked、done、他actor、active intake中の撤回をtyped errorで拒否する
- releaseは同一actorだけに許し、missing、accepted、attached-workerをtyped errorで拒否する
- 初回intakeとretractは同じrepo-wide lockを使い、start再確認からevent appendまでを直列化する
- 撤回後はnext-readyへ復帰し、別actorの`--parallel-frontier` startが通常どおり通る

## 検証

- 新規契約＋help＋pull intake: 23/23 green
- 既存todo CLI／ready frontier／store回帰: 97/97 green
- pull intake補正後: 13/13 green
- `npm run check`: syntax 149 files green
- `git diff --check`: green
- Mioによる独立再監査（room [1648]）: defect-free

独立性はclean HEAD `3ba27c706300ad748a08f8b72e6347cb1c917e7c` で再compileした。
coverageは`verified`、conflictは0。artifact digestは
`27f89f82b72fce75c913e6e914d8218887ffe8f5c0dcf9b1b605db851bdee8f3`。
残るunknown 1件は後続st2が所有する「実plan・実intakeでの撤回実測」であり、st1の未実装ではない。
