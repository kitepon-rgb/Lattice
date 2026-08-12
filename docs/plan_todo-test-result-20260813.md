# ToDo試験結果の正式項目化（todo-test-result-20260813）— 計画正本

日付: 2026-08-13
状態: 工程状態の正本はLattice store
公開契約ID: `lattice.todo_test_result.v1`

## 目的

作業者の最終試験結果をToDoの正式項目`test_result`として保存し、後工程が
`lattice todo show --plan <key> --task <id> --json`の一回で試験結果と既存evidenceを読めるようにする。

## 契約

- `test_result`は非空Markdownの任意項目とし、未記録の既存ToDoは`null`として読む。
- 正規CLIはfile入力で受け、done eventと同じtransactionへ保存する。
- evidenceの代替、自動生成、自動採点、Peertable固有処理、project横断dependencyは作らない。

## 工程

- Lattice管理: ltr1（実装・出荷・導入後smokeを一工程で行う）

`ltr1`は、schema・event/snapshot・旧store互換・done CLI・`todo show`・help・公開契約・focused testを
一つの変更として完成させる。関連gateと監査後、承認済みのrelease・global installまで行い、
一時projectで`start → test_result付きdone → todo show`を一往復して、保存文章とevidenceを確認する。

## 完了条件

公開releaseとglobal installが一致し、一時projectで`test_result`とevidenceを同時に読めること。
Peertable側へ契約IDと対応versionを渡せるところまでを同じ`ltr1`で閉じる。
