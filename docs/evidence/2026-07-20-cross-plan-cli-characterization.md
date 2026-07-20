# cross-plan mutation / CLI互換 characterization

- 取得日: 2026-07-20
- 対象: Lattice `main` (`4c208a4`起点の未commit作業tree)
- Codegraph利用: なし

## 固定した破損経路

- cross-plan hard dependencyとall-of joinの未完了predecessorに対し、overrideなしの`start`を拒否する。
- overrideで開始したToDoも、cross-plan predecessor未完了のまま`done`へ進めない。
- cross-plan successor開始後は、overrideなしのpredecessor `reopen`を拒否する。
- 上記はappend前に拒否し、manifest/storeを変更しない。

## CLI回帰修正

既存のflag無しJSON wireを変更せず、次をexact aliasとして受理する。

- `lattice todo status --json`
- `lattice todo verify --json`
- `lattice todo verify --plan <key> --json`

重複、順序違反、余剰flagは引き続きusage errorとする。

## 検証

```text
node --test test/todo-store.test.mjs test/todo-cli.test.mjs
tests 76 / pass 76 / fail 0
duration 17.77s
```
