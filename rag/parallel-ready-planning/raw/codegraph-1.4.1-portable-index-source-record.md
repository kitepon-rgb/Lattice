# Codegraph 1.4.1 portable index source record

- 出典: local installed `@colbymchenry/codegraph@1.4.1`の`README.md`と`dist/directory.d.ts`
- 取得日: 2026-07-15
- 取得方法: installed packageをread-only実読。package、global install、index実装は変更していない。
- 確度: 一次実装資料として高。RC1 live probeで挙動を照合した。

## Source facts

- `CODEGRAPH_DIR` overrideはproject root直下の単一directory nameだけを受理し、absolute path、separator、`.`、`..`は無効になる。
- default `.codegraph`、active override、`.codegraph-*` siblingはindexer／watcherの対象外になる。
- `CODEGRAPH_NO_DAEMON=1`はshared daemonを使わないdirect modeを選ぶ。
- project statusはindex path、project path、index timestamp、database sizeを返し、symbol nodeは`updatedAt`を持つ。

## RC1 live corroboration

同じbase／patch／query setを2 fresh worktreeでindexすると、構造countsとtyped outcomesは一致したがraw digestは不一致だった。
status telemetry 4 fieldとnested node `updatedAt`だけを除くprojectionは一致した。証拠は
`research/campaigns/rc1/evidence/codegraph-portability-probe.json`に保存した。
