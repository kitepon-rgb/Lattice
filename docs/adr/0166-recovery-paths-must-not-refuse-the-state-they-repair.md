# ADR 0166 — 復旧経路は、復旧対象の状態に拒否されてはならない

- Status: Accepted
- Date: 2026-08-11
- Extends: [0157 — dashboard daemons are discoverable by record](0157-dashboard-daemons-are-discoverable-by-record.md)、
  [0163 — persisted launchers bake verified stable aliases](0163-persisted-launchers-bake-verified-stable-aliases.md)
- 計画正本: [plan_bridge-persistence-recovery.md](../plan_bridge-persistence-recovery.md)

## Context

2026-08-11、FOXのbridgeを遠隔で復旧できなかった。Windowsの常駐設定は
Startup folderの`LatticeBridge.vbs`と`%LOCALAPPDATA%\Lattice\bridge-startup\descriptor.json`の
2つで表され、launcherだけが残ってdescriptorが消えていた。

この状態に対して`lattice bridge reconfigure`——**その状態を直すために存在するcommand**——は
`BRIDGE_STARTUP_FOLDER_STATE_INVALID`で停止した。原因は`snapshotBridgeStartupFolder`が
「片方だけ在る」をthrowで拒否していたことで、snapshotは`setup`／`reconfigure`／`disable`が
**必ず最初に通る一点**である。結果として、復旧に使える正規commandが1つも無くなった。

復旧できたのは、人がStartup folderのfileを手で削除してからreconfigureを打ち直した時である。
**手作業でしか抜けられない状態を製品が作った**というのが欠陥の中身であり、
「なぜdescriptorが消えたか」は別の問題である（今回の実測では、runtime directoryの作成時刻が
launcherより新しく、正規のinstallを通っていない痕跡だった＝製品外の手作業が起点）。

同型のthrowはmacOS側にもあった。`snapshotBridgeLaunchAgent`は「launchdにloadされているのに
plistが無い」で`BRIDGE_LAUNCH_AGENT_STATE_INVALID`を投げており、同じ袋小路を作れた。
片方のplatformだけ直せば、もう片方が同じ日を待つことになる。

## Decision

1. **異常の検出は読み手が行い、書き手は上書きで畳む。** 常駐設定のsnapshotは、
   片割れだけが在る状態をthrowせず`split`として事実のまま返す。両fileの唯一の書き手である
   installが、その状態を上書きで正常化する。
2. **復旧commandは、復旧対象の異常を理由に自分自身を拒否しない。** この規則が縛るのは
   「その状態を直すために存在する経路」であって、安全検査一般ではない。symlink・所有者・
   modeの検査は従来どおりthrowする——それらは**直す対象ではなく、触ってはいけない印**である。
3. **異常は診断面から名指しする。** `lattice bridge status`の`persistence`が
   `state: 'unreadable'`＋`error: 'BRIDGE_PERSISTENCE_STATE_SPLIT'`で報告し、
   既存の`remedy`（unreadableに対して`reconfigure`を出す）がそのまま復旧導線になる。
4. **rollbackは操作前へ戻すだけで、健全さを発明しない。** 分裂状態からのrestoreは分裂を
   忠実に戻し、起動を試みない。畳むのは次のinstallの仕事である。

## Consequences

- 常駐設定が半端に壊れても、`lattice bridge reconfigure --json`一発で正規経路だけで戻る。
  遠隔の端末でも、人がfileを手で消す段が要らなくなる。
- 「なぜ壊れたか」の追跡機能は作らない。原因が製品外にある壊れ方を、製品が完全に列挙する
  ことはできない。**自己修復できることが、原因を特定できることより価値が高い。**
- この規則は常駐設定に限らない。今後「壊れた状態を直すcommand」を足す時は、その状態を
  自分の入口で拒否していないかを設計時に確認する。
