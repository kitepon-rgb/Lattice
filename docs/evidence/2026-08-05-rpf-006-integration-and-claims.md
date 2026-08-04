# rpf-006 実daemon統合と請求項9・10

## 結果

- 3 workerの実daemon runで、競合したA/Bだけを停止し、無関係なCのprocess・dispatch・lease・origin epochを維持した。
- A/Bの後継attemptはCのterminalより前にdispatchされた。Cは再dispatch・rebind・context invalidationを受けていない。
- Cが旧epochで発行したreceiptを、carry-over witnessとorigin bindingにより後継epochで受理した。`lattice event verify`も同じ受理結果を返した。
- I/O sentinelを`off`にした実daemon runでも、supervisor terminal実diffからactual×actual競合を検出し、既存のfinding→conflict→hold経路へ接続した。
- 無関係なCへ全体barrierを掛けず、startup・shutdown・回復不能時の全体barrierは維持した。

## 統合時に解消した内部矛盾

- control journalは10万eventを許すのにcanonicalizerが配列256件で拒否していた。schema固有の件数制限、node総数、canonical byte上限は維持し、共通canonicalizerの重複した配列件数gateだけを外した。
- heartbeatにlease集合の瞬間的一致を要求すると、prepare/release応答とsupervisor投影の非同期窓で正常controllerを切断した。heartbeatは外部processのliveness・session・単調sequenceを検査し、lease集合はdispatch時のcentral gate full-chainで検証する契約へ戻した。
- gate commit時からのlease TTLは、正しく直列待ちした後続frontierをdispatch前に失効させた。write認可はactive gate chainと明示revokeで決め、heartbeat TTLとsocket断検知は維持した。
- executor receiptのcheckpointとsupervisor独立diffは異なるdigest schemaであるため、同一checkpointとして照合せず別eventに分けた。実diffはreceipt裁定前に耐久化する。

## 請求項との対応

- 請求項9: managed supervisorが実際に変更されたworktree資源を終端時に独立観測し、同時稼働attemptの予測read/write又は実変更との重なりを実行時競合として検出する。sentinelは早期警報であり、無効でも終端観測が成立する。
- 請求項10: 競合の影響作業群だけを停止・context invalidation・再計画・後継dispatchの対象とし、閉包外作業の実行とorigin成果を維持する。

請求項本文は変更していない。

## 検証

- `npm run check`: 139 files syntax check passed
- `node --test test/artifact-contracts.test.mjs test/runtime-managed-supervisor.test.mjs test/runtime-scripted-adapter-controller.test.mjs test/integration/scripted-adapter-controller.integration.mjs`: 22/22 passed
- `node --test test/runtime-managed-supervisor.test.mjs test/rc3-hold-recompile.test.mjs test/rc3-runtime-engine.test.mjs`: 36/36 passed
- `node --test test/runtime-conflict-cli.test.mjs`: 10/10 passed（実supervisor/controller daemon）
- `node --test test/integration/hold-resume.integration.mjs`: 1/1 passed（A/B対象限定停止、C継続、後継先行、origin receipt受理）
- `node --test test/integration/hold-transform-resume.integration.mjs`: 1/1 passed（seam変換後は明示resumeで双方を同じ波へ戻す）
- `node --test test/integration/prediction-excess-is-not-a-conflict.integration.mjs`: 1/1 passed（`LATTICE_IO_SENTINEL=off`のterminal実diff検出）
- `node --test test/integration/rc3-scripted-campaign.integration.mjs`: 7/7 passed（未予測変更を競合へ昇格しない現契約）
- `npm run ci`: green（製品141 suite、同梱sensor、syntax、CLI surface、open questions、reachability、ToDo store）

全CIの初回走行で、旧RC3 campaignに残っていた「単独の予測超過をfreezeする」期待を検出して現契約へ更新した。
次の走行で、対象限定の後継自動駆動が`seam_split`まで巻き込む結合を検出し、`intentional_serial`だけへ限定した。
両修正のfocused test後に全CIを再実行し、終端までgreenを確認した。

実装commit: `61507a7`, `61c2004`, `b24b4d1`
