# terminal-audit 実施記録

`campaign-closeout-20260811` の4件を、各 evidence、実diff、Lattice store、focused testで終端監査した。

## 受理した成果

- `co1-deploy-record`: `docs/operations/lattice-kitepon-deployment.md` の0.57.3配備記録を確認した。
  npm shasum、Mac runtime、FOX/WSL2 CLI、公開URLの実測が記録されている。FOXの記述は
  co1実施時点の配備記録であり、その後の永続PTYによる公開面復旧はco3で現状へ反映した。
- `co2-retire-bpr6`: `bridge-persistence-recovery` を
  `rev-83d2c41d5f7cd5d57810bb0b`へ改訂し、`bpr6-offline-notice`だけをtombstoneへ移した。
  revision digestは`899e0a465193f6a6c7b5a7e4625b7444c0ff028d6198b4c0b6ca5801ba3ce9a3`。
  `todo verify`はreconciled、active 7、tombstone 1、snapshot staleなし。
- `co3-plan-status`: `plan_carry-removal-retirement.md`、`plan_bridge-persistence-recovery.md`、
  `plan_bridge-hub.md`を実態へ同期した。初回成果`b3c9ea78`は、訂正済みの
  「オーナー対話logon待ち」を再掲していたため受理せず、sequence 9でreopenして訂正した。
  現在地は「公開面は永続PTYで復旧済み、未了はbpr5のregistry install切替だけ」である。
  `todo verify`はbridge-hub、bridge-persistence-recoveryともreconciled、snapshot staleなし。
- `co4-knowledge`: private caveat `entry-20260811-50e3df`を確認した。同じ概念を複数経路で
  再計算することで契約が分裂する罠と、唯一の情報源・唯一のcanonical writerへ収束させる対処が記録されている。

## 検証

- `node --test test/todo-revision-writer.test.mjs test/todo-revision.test.mjs test/todo-cli.test.mjs`: 69/69成功。
- 親による再確認 `node --test test/todo-revision.test.mjs test/todo-cli.test.mjs`: 31/31成功。
- 独立監査席による関連test: 75/75成功。
- `git diff --check`: 成功。
- 本campaignは文書、工程store、revision cutoverだけを変更したため、full CIは実行せずfocused gateで閉じた。

remoteへのpushは本campaignでは行っていない。
