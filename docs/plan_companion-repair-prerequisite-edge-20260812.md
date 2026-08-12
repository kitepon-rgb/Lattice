# companion-repair-prerequisite-edge-20260812 — repair起票と対象工程の前提edgeを原子登録する修理

## 目的

実戦中に見つかった欠陥をcompanion repairとして新plan/taskへ起票する時、repairが阻害する対象工程への前提edgeを同じ登録操作で明示する。起票後のready frontierを即時再計算し、対象工程が何に阻害されているかをCLI/status/UIから追跡できるようにする。

## 対象

- repair task: `companion-repair-prerequisite-edge-20260812/cre-01`
- blocked target: `peertable-dogfood-repairs-20260811/ldr-06`
- upstream prerequisite: `structure-provenance-repair-20260812/spr-01`

## 処理契約

repair plan/task identity、blocked target identity、reasonを明示入力として受け、両taskの存在・方向・terminal状態・cycleを検証する。必要ならrepair planを同一のmigration入力から登録し、`repair → target` のhard dependencyを同じ操作で接続する。migrateだけ成功してedgeが欠けるhalf-stateは残さない。AIによるrepair-for関係の推測は行わない。

## 受入条件

1. 起票前にreadyだった `ldr-06` が、起票直後に `cre-01` をunmet prerequisiteとして表示する。
2. `cre-01` のdone後に `ldr-06` がreadyへ戻る。
3. 既存taskへの後付け接続も新規起票と同じtyped入口で処理する。
4. cycle、方向、terminal、identity検証の失敗ではmigrationだけ成功するhalf-stateを残さない。
5. status/UIがrepairと対象工程、接続前後frontier、next actionを表示する。
6. 明示されたrepair-for関係だけを処理し、AI推測でedgeを追加しない。

## 依存関係

- `structure-provenance-repair-20260812/spr-01 → companion-repair-prerequisite-edge-20260812/cre-01`
- `companion-repair-prerequisite-edge-20260812/cre-01 → peertable-dogfood-repairs-20260811/ldr-06`

これにより、spr-01後の着手可能工程としてcre-01を待機させ、cre-01完了までldr-06を明示的に阻害する。

## 非目標

- active planへの汎用partial CRUDを追加すること。
- AIによる依存edgeの自動推定。
- Peertable側の席状態、room、公開・push・publishの変更。
