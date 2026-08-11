# bpr3-adr 受入証跡

## 成果物

`docs/adr/0166-recovery-paths-must-not-refuse-the-state-they-repair.md`（不変Decision）

## 固定した判断

1. 異常の検出は読み手（status・diagnostic）が行い、書き手（setup／reconfigure／install）は上書きで畳む。
2. 復旧commandは、復旧対象の異常を理由に自分自身を拒否しない。ただしこの規則が縛るのは
   「その状態を直すために存在する経路」だけで、symlink・所有者・modeの安全検査は従来どおりthrowする。
3. 異常は`bridge status`の`persistence.error`＝`BRIDGE_PERSISTENCE_STATE_SPLIT`で名指しし、
   既存の`remedy`がそのまま復旧導線になる。
4. rollbackは操作前へ忠実に戻すだけで、健全さを発明しない。

## 根拠にした実測（2026-08-11）

- FOXでStartup launcherだけが残りdescriptorが消え、`lattice bridge reconfigure`が
  `BRIDGE_STARTUP_FOLDER_STATE_INVALID`で停止。人が手でfileを消すまで復旧できなかった。
- 同型のthrowがmacOS側（`snapshotBridgeLaunchAgent`のloaded but no plist）にも存在した。
- 原因追跡ではなく自己修復で閉じる判断の根拠: runtime directoryの作成時刻がlauncherより新しく、
  正規installを通っていない痕跡だった＝起点は製品外の手作業であり、製品が完全に列挙できない。

## 非目標

分裂が「なぜ起きたか」を製品が追跡する機能は作らない。
