# Runtime hold公開導線 authoring ledger

この台帳はLattice todo storeへのsource cutover用であり、工程状態の正本ではない。

## Tasks
- [ ] lpg-025 競合freeze・実停止ack・multi-epoch recompile・seam splitの公開契約とcharacterizationを固定する
- [ ] lpg-026 multi-epoch run storeとrun conflict公開CLIを実装しfreeze中の新規dispatchを拒否する
- [ ] lpg-027 executor hold request／checkpoint／停止ack検証を実装し論理停止の捏造を禁止する
- [ ] lpg-028 run recompileでseam splitまたはintentional serialを選びepoch rebind／redispatch後に再開する
- [ ] lpg-029 held／carry-over／redispatchをrun statusとproject別動的工程表へ投影する
- [ ] lpg-030 AIShellの実競合fixtureで片側stay・seam分割・process再起動回収をdogfoodする
- [ ] lpg-031 独立反証、関連/full test、公開docs、npm release、global installを閉じる
