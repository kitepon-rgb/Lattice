# CI契約

Latticeが対応する実行環境は、macOS native、Linux native、Windows native、Windows WSL2である。
CIは環境数だけ同じ試験を複製せず、失敗をその環境固有の欠陥へ結び付けられる単位で実行する。

| job | 証明すること | 実行内容 |
| --- | --- | --- |
| `core-wsl2` | portableな製品挙動 | `factory-wsl2-fox`で現行製品suite全件を1回 |
| `linux-native` | Linux固有のdaemon・git・store・CLI・POSIX hooks境界 | `factory-linux-main`でLinux profile |
| `macos-native` | macOS固有のlaunchd・process・path/filesystem境界 | `factory-macos-m5`でmacOS profile |
| `windows-native` | Windows固有境界、sensor、静的契約 | `factory-windows-fox`でWindows profileと全check |

`npm test`は開発者が手元で使う現行製品suite全件の入口として維持する。CIは
`npm run test:profile -- --profile=<name>`を使う。通常の新規suiteは自動的に`core`へ入る。
OS固有の意味を持つsuiteだけを`scripts/run-product-tests.mjs`の対応profileへ加える。

4 jobはOrganization self-hosted runnerで同時に開始する。外部forkのコードを自宅LAN内のrunnerへ
自動投入しないため、triggerは全branchのpushと手動実行だけにする。同一branchの古いrunは
新しいpushでcancelする。tag pushは同じcommitのbranch CIを再実行しない。timeoutは通常所要時間の
約2倍に留め、hangを長時間の`in_progress`として保持しない。
