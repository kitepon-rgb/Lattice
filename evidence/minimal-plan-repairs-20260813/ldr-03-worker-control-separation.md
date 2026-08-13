# ldr-03-worker-control-separation 証跡

## 実施

現HEADの実装を受入条件へ照合した。hold対象workerはAIの制御processと別processとして起動され、hold時はworkerだけを停止する。recoveryはintakeの状態から読み出せ、再intakeによる再評価・再開と、解けないholdをdetachしてworkerを解放する経路を公開CLIから利用できる。Latticeはtask選択・会話・席管理を行っていない。

今回の作業では製品コードの変更は行っていない。既存実装が受入条件を満たしていることをfocused testで確認した。

## 最終試験

実行コマンド:

```text
node --test --test-name-pattern='(hold|detach|再intake|解けないhold|recovery)' test/runtime-pull-intake-cli.test.mjs test/runtime-work-order-controller.test.mjs
```

結果: 9件成功、0件失敗。

確認できた内容:

- planning conflict時のholdとlease withheld
- version drift／boundary unknown時のhold
- 先行hold原因の保持
- 再intake時のequipment identity不変と境界変更hold
- precedence hold
- 解けないholdのdetach、worker再開、release後のclose
- attach binding不一致processへsignalしないこと
- worker process分離のcontrollerテスト

## 追加確認の制約

次の実controller統合2件は、テスト開始時に bundled sensor が存在しないため実行不能だった。

```text
node --test --test-name-pattern='(実controller daemonはhold|activate後もdaemonが生存)' test/runtime-conflict-cli.test.mjs
```

結果: 0件成功、2件失敗。いずれも `LATTICE_SENSOR_UNAVAILABLE`、原因は
`sensor/dist/bin/lattice-sensor.js` の `ENOENT`。製品コードのassertion失敗ではない。
