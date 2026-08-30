# companion repairの起票と前提edgeを原子登録する修理

## 目的

実戦中に見つかった欠陥をcompanion plan/taskとして起票する時、repairが先に必要な対象工程への
hard dependencyを同じ操作で登録する。起票だけ成功してedgeが欠ける中間状態を利用者へ見せない。

## 利用者が得る機能

companion plan入力、repair task、対象task、理由を一度指定すると、plan登録と`repair → target`の接続が
一つのtyped操作として完了し、接続後のready frontierを確認できる。既存task同士へ後から同じ関係を
接続する場合も同じ入口を利用する。

## 最小実装

- 既存のplan migration、dependency登録、store transactionを組み合わせ、一回のcommitとして書く。
- 通常のdependency登録が既に持つ整合条件を再利用し、この機能専用の検証層や台帳を追加しない。
- 操作はrepairとtargetを明示入力で受ける。Lattice内にrepair関係を推測する機能を作らない。
- statusとUIは新しい監視面を作らず、登録された通常のdependencyとready frontierをそのまま投影する。

## 受入条件

1. 起票前に着手可能だったtargetが、起票直後にrepairを未完了の前提として表示する。
2. repair完了後にtargetが着手可能へ戻る。
3. 既存taskへの後付け接続も同じtyped入口で完了する。
4. 操作が失敗した場合はplan登録とedge登録のどちらも残らない。
5. 結果からrepair、target、接続後frontier、次の操作を確認できる。

変更に直結するfocused test、作業者自身の監査、最終試験結果の記録、利用面までの配布は本工程の完遂へ含め、
別の試験、監査、release工程は追加しない。

## 対象外

- active planへの汎用partial CRUD。
- AIによるrepair関係や依存関係の自動設計。
- Peertable側の席、room、公開処理の変更。
