# cr5-release 実施記録

- 対象版: `0.57.3`
- 公開コミット: `8bfd0023c61cdb774b548ceac871e92ecc27c806`
- `origin/main`への着地: 確認済み
- `npm publish --access public`: 成功
- npmレジストリ: `@quolu/lattice@0.57.3`、dist shasum `510e7ab8e75d501c8227063eff3085d555041430`
- Mac install: `npm install -g @quolu/lattice@0.57.3` 成功、`lattice --version` は `0.57.3`
- Mac bridge status: runtimeは稼働中だが `0.57.2` の常駐processが残り、`runtime_drift: ["version"]`。CLI導入後の常駐process更新までは未実施。
- 公開面: `https://lattice.kitepon.dev/projects/lattice/` はHTTP 200
- WSL2: このmacOS環境に `wsl.exe` がなく、実機install・常駐・公開面の測定は未実施。
- FOX: 対話logon sessionが必要なため、owner carry over。

## 検証

- `npm run check`: 成功
- focused todo tests: 145件成功
- `npm run verify:release-commit`: 成功
