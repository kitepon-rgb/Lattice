# bpr4-release 受入証跡

## 出荷内容（0.57.2）

| commit | 内容 |
| --- | --- |
| `867aef5d` | 端末は配信している集合をそのまま名乗る（ADR 0165） |
| `6d16842d` | heartbeatの重複抑止が毎周期リセットされていたのを直す |
| `eee73ae0` | 常駐設定の分裂状態を自己修復可能にする（ADR 0166） |
| `e37f5790` | 分裂したLaunchAgentのrollbackを修理する（suzuneの監査finding） |

## gate

- `npm test`: 1677 pass / 0 fail
- `npm run check`: syntax check passed（161 files）
- `verify-release-commit`: release commit `4f929b4b0f85` is landed on `origin/main`

## 配布

- npm `@quolu/lattice@0.57.2` publish 済み
- Mac（KaitonoMacBook-Air）: `npm install -g` → `launchctl kickstart -k`
- WSL2（FOX）: `npm install -g` → CLI 0.57.2
- hub（192.168.1.2）は更新していない。0.57.2は端末側だけの修正で、登録protocolはv2のまま変わらない。

## 実測（配信内容で判定・status codeだけで判定しない）

Mac端末:

```
runtime    : running 0.57.2 / heartbeat accepted 2026-08-11T02:31:57Z
persistence: installed / error null / reachable true
runtime_drift: [] / remedy: null
```

公開面:

| URL | 結果 |
| --- | --- |
| `/projects/iine/` | 200 |
| `/projects/lattice/` | 200 |
| `/projects/kikoeru/` | 200 |
| 一覧 | Mac配信の4件がオンライン |

## 未達（carry over）

FOX（Windows）は `オフライン` のまま。常駐の起動はオーナーの対話logon sessionでしか行えず
（SSH起動のprocessはsession終了で落ちる・3回再現）、遠隔からは常駐設定の修復までしかできない。
bpr5-fox-install の範囲として持ち越す。
