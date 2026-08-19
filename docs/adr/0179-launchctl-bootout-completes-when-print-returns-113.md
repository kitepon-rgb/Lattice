# ADR 0179 — LaunchAgentのbootoutはprint 113までが完了である

- Status: Accepted
- Date: 2026-08-19
- Extends: [0163 — persisted launchers bake verified stable aliases](0163-persisted-launchers-bake-verified-stable-aliases.md)

## Context

`lattice bridge reconfigure`が`BRIDGE_LAUNCHCTL_BOOTSTRAP_FAILED`を返すのに、独立の
`lattice bridge status`ではprocessが新しい版で起動済み、という状態が繰り返された。
0.58.3、0.58.4、0.60.6で同じ形を踏んだ。失敗を成功へ丸めず、再試行で通過した記録だけが残っていた。

2026-08-19の実測では、`launchctl bootstrap`のstderrは次だった。

```
Bootstrap failed: 5: Input/output error
Try re-running the command as root for richer errors.
```

同じ操作を計ると、`bootout`は2msでexit 0を返すが、`print`は+8ms時点でもcode 0（まだloaded）である。
+32msで`print`が113になり、その直後の`bootstrap`はexit 0で通る。一時directoryのdummy LaunchAgentでは
この間隙が出ず、再現に使えない。

`bootout`のexit 0はunload受付であり、labelがdomainから消えたことではない。受付の直後に
`bootstrap`するとlaunchdはEIOを返す。socketの停止確認だけでは足りない——listenが閉じても
launchdはまだlabelを持っている。

## Decision

1. **`bootout`の完了条件は`launchctl print`が113を返すこととする。** exit 0は受付であり完了ではない。
   `install`／`disable`／`restore`のbootout経路は、print 113を待ってから次へ進む。
2. **待っている対象はlaunchdのlabel解放であり、固定秒数の見積りではない。** launchdのdefault
   ExitTimeOutは5秒なので、待ちの上限はその先に置く。上限を超えてもloadedなら
   `BRIDGE_LAUNCHCTL_BOOTOUT_FAILED`で落とす。
3. **bootstrap失敗はlaunchctlのexit codeとstderrを`detail`へ残す。** 原因を汎用messageへ隠さない。
   plistの絶対pathはdetailへ入れない。

## Consequences

- `reconfigure`はunload完了後に新しいplistを載せる。KeepAliveが旧定義を拾って「失敗なのに
  processは起きている」見え方を作らない。
- 一時directoryのLaunchAgent試験ではこの間隙が出ないので、製品試験はprintが残っている間に
  bootstrapしないことをdoubleで固定する。
- Windows Startup folderにはlaunchctlのこの間隙は無い。同じ完了条件を他platformへ写さない。
