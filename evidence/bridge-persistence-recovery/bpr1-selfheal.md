# bpr1-selfheal

## 実施

- Windows Startup launcher／descriptor の片割れ状態を `split: true` として snapshot が返すようにした。
- macOS LaunchAgent の loaded／plist 不在状態を `split: true` として snapshot が返すようにした。
- `bridgePersistence` は分裂状態を `BRIDGE_PERSISTENCE_STATE_SPLIT` として報告し、`reconfigure` の復旧導線を閉ざさないようにした。

## 確認

`node --test test/bridge-startup-folder.test.mjs test/bridge-launch-agent.test.mjs test/bridge-daemon.test.mjs test/bridge-listen-rebind.test.mjs`

- 52 tests passed, 0 failed
- 分裂したStartup launcherだけを残す回帰テストを追加し、snapshotが `split: true` と片割れの内容を返すことを確認した。

## 監査後修正

- `restoreBridgeLaunchAgent` が `split` snapshotをbootstrap／attestationせず、plistなしの状態をそのまま戻す分岐を追加した。
- 監査再現の `null.match` と存在しないplistへのbootstrapを防ぐ回帰テストを追加した。
- `node --test test/bridge-launch-agent.test.mjs`: 11 tests passed, 0 failed。
