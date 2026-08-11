# cr5-release 実施記録

- 対象版: `0.57.3`
- 公開コミット: `8bfd0023c61cdb774b548ceac871e92ecc27c806`
- `origin/main`への着地: 確認済み
- `npm publish --access public`: 成功
- npmレジストリ: `@quolu/lattice@0.57.3`、dist shasum `510e7ab8e75d501c8227063eff3085d555041430`
- Mac install: `npm install -g @quolu/lattice@0.57.3` 成功、`lattice --version` は `0.57.3`
- Mac bridge status: 再実測時点でruntime `0.57.3`、`runtime_drift: []`、heartbeat `accepted`、`remedy: null`。旧版からの入替えはsupervisorの設計どおり自動完了。
- 公開面: `https://lattice.kitepon.dev/projects/lattice/` はHTTP 200
- WSL2/FOX: `ssh fox-wsl` 経由で `npm install -g @quolu/lattice@0.57.3` 成功、`/home/kite/.npm-global/bin/lattice --version` は `0.57.3`。bridge statusは `configured:false`（この端末ではbridge未設定）のため、常駐bridge・公開面は未測定。
- FOX: 対話logon sessionが必要なため、owner carry over。

## 検証

- `npm run check`: 成功
- focused todo tests: 145件成功
- `npm run verify:release-commit`: 成功
