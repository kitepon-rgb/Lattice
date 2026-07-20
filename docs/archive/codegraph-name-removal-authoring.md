# CodeGraph name removal authoring ledger

Lattice storeへ移管した完全cutover工程の固定source ledger。工程状態は本文では管理しない。

## Tasks
- [ ] lpg-020 旧名・旧保存先・旧runtime依存のcharacterizationとcutover契約を固定する
- [ ] lpg-021 sensor本体のbinary・storage・env・CLIをLattice所有名へ切り替える
- [ ] lpg-022 root adapter・MCP tool・artifact schema・package surfaceをsensor名へ切り替える
- [ ] lpg-023 tests・現行docs・package manifestを更新し旧runtime名の再混入gateを置く
- [ ] lpg-024 旧dataが無いfresh AIShellでdogfoodしPhase重監査とfull gateを閉じる
