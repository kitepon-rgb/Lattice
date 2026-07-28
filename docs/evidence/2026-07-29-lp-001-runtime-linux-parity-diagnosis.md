# lp-001 管理runtime daemon Linux失敗原因の診断

## 結論

Linuxで管理runtimeの統合試験が止まる最初の原因は、controller起動後の実行イメージ
確認がmacOSの`ps`出力形式を前提としていることだった。

`activateManagedSupervisorController()`はcontroller起動後に次を実行する。

```text
/bin/ps -o comm= -p <pid>
```

macOSでは`comm`から実行ファイルの絶対パスを得られるが、Linuxでは通常`node`のような
コマンド名だけが返る。この値をそのまま`realpath()`へ渡すため、
`ADAPTER_BINARY_IDENTITY_MISMATCH: exec後image path観測失敗`でactivationが失敗する。

## 再現条件

- host: macOS arm64
- container: `node:22-bookworm`（Linux arm64）
- source: `5293f36`
- test: `test/integration/scripted-adapter-controller.integration.mjs`
- test内のDarwin限定skipだけをcontainer内で除去
- bundled sensorのbuild artifactはread-only host mountからcontainer内へ複製

## 観測結果

sensor初期化、plan compile、run start、adapter registerまでは成功した。
`lattice run activate`が次の公開エラーで終了した。

```json
{"schema":"lattice.cli_error.v2","code":"ADAPTER_BINARY_IDENTITY_MISMATCH","message":"managed activateがrejectedで終了した: ADAPTER_BINARY_IDENTITY_MISMATCH: exec後image path観測失敗"}
```

失敗位置は`src/runtime-managed-supervisor.mjs`の
`activateManagedSupervisorController()`内、起動したchild PIDに対する
`ps -o comm=`の結果を`realpath()`する箇所である。

## codesign依存との切り分け

Linuxで`observeMacosBinaryIdentity()`は実行できないが、adapter登録側はidentity観測失敗を
記録し、launch descriptorの`binary_identity`を`null`にして継続する。今回の再現でも
adapter registerは成功している。したがってcodesignは最初の直接原因ではない。

ただし、現状はplatform固有identityを取得できない時だけ署名identity検証を省略する契約に
なっている。`lp-002`では、既に全platformで行っているcanonical pathとSHA-256 bytesの照合を
基礎契約とし、実行中processのimage path取得だけをplatform別の信頼できる観測へ分離する。
Linuxでは`/proc/<pid>/exe`をcanonical pathとして観測し、macOSでは現在の`ps`観測を維持する。

## 後続で確認する項目

- Linuxで`/proc/<pid>/exe`が登録済みbinaryのcanonical pathと一致すること
- 起動前・起動後のSHA-256 bytes照合が両platformで維持されること
- 管理daemonのstart identityとprocess observerがLinuxでも通ること
- Darwin限定skipを除去した統合試験がmacOSとLinuxの双方で完走すること
