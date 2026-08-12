# ToDo試験結果の正式項目化（todo-test-result-20260813）— 計画正本

日付: 2026-08-13
状態: Lattice storeへbacklog登録し、着手は後日まとめて行う
公開契約ID: `lattice.todo_test_result.v1`

## 目的

作業者が行った最終試験の文章サマリーを、証跡記述子とは別のToDo正式項目として保存する。後工程は
`lattice todo show --plan <key> --task <id> --json` の一回で試験結果と証跡記述子を同時に読み、詳細の
正本は引き続きdigestで束縛されたevidenceから確認できるようにする。

## 契約

- 完了記録に、非空のMarkdown文章を持つ任意項目`test_result`を追加する。既存callerと既存storeは
  読み続けられ、未記録は文章を捏造せず`null`として投影する。
- 正規CLIは最終試験結果をfile入力で受け、完了eventと同じtransactionへ保存する。shell引数へ長文を
  埋め込ませない。`todo show --json`は追加操作なしに`test_result`と既存evidenceを返す。
- `test_result`は人が後工程へ渡す要約であり、evidenceの代替・複製・自動採点にはしない。evidenceの
  Git object、content digest、到達性検証、done/auditの意味は変えない。
- schema、event/snapshot/store migration、CLI、read projection、表示、公開契約、関連focused testを
  同じ契約IDへ束縛する。

## 非目標

- AIによる試験結果生成・採点、room連携、Peertable固有schema、project横断dependency機構は作らない。
- 詳細evidenceを`test_result`へ移さない。既存ToDoの過去結果を推測して埋めない。

## 工程

### ltr1 試験結果を保存しToDo表示一回で読める公開契約を実装する

`lattice.todo_test_result.v1`として、完了入力、永続eventとsnapshot、旧store読取、`todo show --json`の
投影、CLI helpと公開契約を一貫させる。新規記録、未記録の旧store、reopen後の扱い、証跡記述子の不変を
focused testで固定する。受入は、作業者の文章サマリーが正確に保存され、後工程がshow一回で結果と
evidenceの両方を取得できること。

### ltr2 対応releaseを出荷・導入しconsumer境界を実測する

ltr1の関連gateとpeer auditを通し、既定ブランチ祖先を確認した対応versionをreleaseする。publishは
オーナーの明示承認後だけ行う。端末のglobal installを同versionへ更新し、一時projectで
`start → test_result付きdone → todo show`を実行して、version、契約ID、保存文章、evidence descriptorが
一致することを確認する。この実測済みrelease versionがPeertable工程の外部成果物前提であり、ltr2の
ToDoがdoneであること自体は利用可能条件にしない。

## 依存と完了条件

Lattice内は`ltr1 → ltr2`。project横断dependencyは現行CLI/storeが別projectを
`dependency_project_mismatch`で拒否するため使用しない。完了時は、公開release versionとglobal install、
consumer smokeを別々に記録し、Peertable側へ契約ID`lattice.todo_test_result.v1`と対応versionを渡す。
