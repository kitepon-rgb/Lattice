# ldr-01 配備基線と既存20 commitの公開・監査状態

## 結論

- `origin/main` から計画起点の親 `41a5fc1^`（`1133d7f8`）までは20 commitで、計画の「既存20 commit」と一致した。
- 現在の `main` は `origin/main` より25 commit先行している。20件に、計画本体 `41a5fc1` と、その後の4件（依存修正、migrate工程追加、store登録、独立性宣言）が加わっている。
- `origin/main..HEAD` の `package.json`、`bin`、`src`、`sensor` には差分が無い。今回の25 commitは製品実行payloadを変更していない。
- `package.json` は `@quolu/lattice@0.57.3`。local `npm pack --dry-run --json` のintegrityは、registryの公開 `@quolu/lattice@0.57.3` と一致した。
- `/opt/homebrew/bin/lattice` は global `@quolu/lattice@0.57.3` を指し、`lattice --version` も `0.57.3`。
- `campaign-closeout-20260811` と `bridge-persistence-recovery` の terminal-audit phase はいずれも `accepted`。ただし前者の `todo verify` は `snapshot_stale=false` でも `reconciliation_state=registered_unreconciled` なので、campaign store の完全reconciledとは扱わない。
- push、publish、install変更、remote変更は実施していない。通常pushは明示指示が必要で、今回の工程は基線照合である。

## 実測

| 確認対象 | 結果 |
| --- | --- |
| CLI / project status | CLI `0.57.3`、project state `ready`、store `.lattice/todo` |
| todo status（着手前） | activeなし、`ldr-01`〜`ldr-06`/`ldr-10`がready |
| independence | `verified`、`ldr-01` は `ldr-02`・`ldr-05` と同じparallel group、activeとの競合なし |
| `ldr-01` start advisory | `coverage=verified`、`conflicts_with_active=[]`、`independence_verified` |
| branch基線 | `main...origin/main [ahead 25]`、left/right `0/25` |
| 計画起点 | `41a5fc1^=1133d7f8`、`origin/main..41a5fc1^` は20件 |
| product payload差分 | `git diff --name-status origin/main..HEAD -- package.json bin src sensor` は空 |
| 公開registry | `npm view @quolu/lattice@0.57.3` のtarballは `https://registry.npmjs.org/@quolu/lattice/-/lattice-0.57.3.tgz`、integrityは `sha512-5Mu98kkTvHbu+zAVOsIF2ibwvsqPVEzM3KXFMe1jO3WVcurb9LsQKbK/gFxQRHGLu3qDlCeBDvkAWSoYCnTF3Q==` |
| local package dry-run | version `0.57.3`、size `7445284`、unpackedSize `77842924`、entryCount `811`、integrityは公開値と一致 |
| global install | `npm list --global @quolu/lattice --depth=0` は `0.57.3` |
| pull run | `lattice run list --json` に対象campaignのactive pull runなし。read-only基線照合のためrun intakeは行っていない |

## 既存20 commitの内容と監査扱い

下表の「監査扱い」はcommit messageだけでなく、`git log --stat`、
`evidence/campaign-closeout-20260811/terminal-audit.md`、
`evidence/bridge-persistence-recovery/terminal-audit.md`、および対象planの
`lattice todo verify` / `lattice todo phase status`を突合した結果である。

| # | commit | 内容 | 監査・公開上の扱い |
| ---: | --- | --- | --- |
| 1 | `1133d7f8` | bridge復旧工程の終端監査受理 | bridge terminal-audit acceptedのdecision記録 |
| 2 | `ae283875` | bridge復旧工程の終端監査証跡 | bridge terminal-auditのevidence入力 |
| 3 | `41883731` | bridge復旧工程の終端監査開始 | bridge terminal-audit lifecycle記録 |
| 4 | `b988014f` | bpr5を製品工程から退役 | bridge auditで退役を確認。dotagents所有の端末固有展開を製品公開へ混ぜない |
| 5 | `d149af66` | closeoutの終端監査受理 | closeout terminal-audit acceptedのdecision記録 |
| 6 | `9bbfb5cd` | closeoutの終端監査証跡 | closeout terminal-auditのevidence入力 |
| 7 | `4e481583` | closeout計画を完了状態へ揃える | closeoutのterminal-audit phaseはaccepted。ただしplan verifyのreconciliation状態とは分離 |
| 8 | `52f5c347` | closeout終端監査開始 | closeout terminal-audit lifecycle記録 |
| 9 | `a85a89a4` | co3の訂正完了を工程へ記録 | closeout auditで訂正後の成果として扱う |
| 10 | `4235e5d3` | co3の散文を実測済みの現在地へ訂正 | closeout auditが確認した訂正内容 |
| 11 | `9661bba6` | co3の差し戻しを工程へ記録 | 初回成果の不成立を正しく差し戻した記録 |
| 12 | `49e67af8` | co3のToDo doneを記録 | closeout auditの受入対象。初回成果ではなく訂正後の状態に束縛 |
| 13 | `9012180d` | co3の工程着手を記録 | closeout lifecycle記録 |
| 14 | `b3c9ea78` | co3の散文正本を実態へ合わせる初回成果 | closeout auditで不受理。古い「オーナー対話logon待ち」を再掲したため後続の訂正へ差し戻し |
| 15 | `08275172` | co2-retire-bpr6のToDo doneを記録 | closeout auditの受入対象 |
| 16 | `4c6b333f` | bpr6を退役revisionで工程から外す | closeout auditで退役revisionとtombstoneを確認 |
| 17 | `b8843ad9` | bpr5-fox-installのnoteを記録 | standaloneのdoneではなく、bridge terminal auditでbpr5退役の背景として確認 |
| 18 | `5b140752` | co4-knowledgeのToDo doneを記録 | closeout auditでprivate caveatの証跡を確認 |
| 19 | `82a3dd6d` | closeout工程の開始状態を記録 | closeout lifecycle記録 |
| 20 | `11471156` | co4の還流証跡と調整方式を記録 | closeout auditでknowledge evidenceを確認 |

## 公開判定の境界

公開済み0.57.3とのpayload一致は、registry integrityとlocal dry-run integrity、および
`origin/main..HEAD`の実行payload差分なしで確認できた。一方、現在のbranchが25 commit先行している
こと、working treeにLattice store変更・`.team/scripts/done.sh`変更・未追跡archiveがあることは別の
履歴／作業tree状態である。これらを「公開済み」とは呼ばず、次のpush・publish対象へ混ぜる判断は
別工程で行う。

## スキップ

- push / publish / global install変更: 明示指示なし、かつ基線照合の範囲外。
- full CI: 今回はproduct source変更なし。既存terminal auditのfocused gate結果を再利用し、変わっていないgreen testを再実行していない。
- code sensor探索: source構造変更の工程ではなく、CLI・git・npm・既存evidence・Lattice verifyの実測で受入条件を確認できたため。
