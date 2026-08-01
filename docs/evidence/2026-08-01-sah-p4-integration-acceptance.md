# sah-p4-integration-validation — 受入記録（sensor-awareness-hooks campaign）

- 記録: 2026-08-01 / Control `sensor-awareness-hooks-20260801`
- 受入者: claude-fable-parent

## 検証構造（クロスチェックの実績）

| 段 | 実施 | 結果 |
|---|---|---|
| 親の実CLI smoke | 使い捨てHOME（実HOME不干渉）でinstall/status/uninstall/emit実測 | wired・typed status v1・冪等already_wired・他製品hook保持・emit初回INFO/2回目沈黙 |
| 独立レビュー | Claude最上位refuter（実装author=Codexとprovider分離）が実装vs契約r5を全文照合 | 6 finding（F1 データ損失経路・F2 quote往復性破綻＋テスト循環・F3 POSIX逸脱・F4 未カバー5経路・F5/F6軽微） |
| 修理wave | 同一実装Run（sol×high）が6件全修理・テスト37→46件 | 全green |
| 再検証 | 同一refuterが修理を実コード照合＋独立fuzz（quote/escape往復） | **殺せず・blocking 0・P4通過可** |
| 親gate再実行 | focused 46・check・cli-surface・full `npm test` | 全green・fail 0 |

## 非blocking注記（受容・理由付き）

- F6の残余interleaving（複数プロセスの回復とcrashの交差窓）は帰結がforeign_candidate可視化への
  倒れであり、削除権孤児・沈黙のどちらでもないため受容（refuter判定に同意）。
- maintenance wave対象は上流修理により空（rc3系greenをP3受入で実測済み）。

## 通算の反証実績

設計4巡37 finding（35採用/1棄却/1部分採用）＋実装レビュー6 finding全修理＝**publish前に43件の
破壊経路を閉鎖**。behavior-change laneの承認根拠は2026-08-01オーナーGO（campaign起票の入口）。

## P5への引き継ぎ

- docs/01正典化ドラフト準備済み（親scratchpad）。実装・help・testとの一致確認を経て投入。
- version bump→npm publishはH承認必須。release祖先gate（verify-release-commit）実装済み確認。
- 公開後: 対象端末global install→実環境smoke→証跡記録→P6 dotagents追従。
