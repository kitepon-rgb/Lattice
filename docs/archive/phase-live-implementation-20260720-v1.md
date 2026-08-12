# Phase control / live Gantt 実装証拠

- 対象: `lpg-003`〜`lpg-007`のうち公開不整合修正、Phase core、stable read、live viewer
- 実施日: 2026-07-20
- Codegraph依存: なし。production importは`src/sensor-adapter.mjs`へ切替済み。

## 成立した契約

- cross-plan hard dependency / all-of joinをmerged storeで検査し、`start`、`done`、`reopen`の表示とwriterを一致させた。
- 複数plan successorを一つのmanifest CASで公開する`todo revise-set`を追加した。
- `todo status --json` / `todo verify --json`をflag無しJSON wireの互換aliasとして復旧した。
- `todo_plan.v4`、`todo_event.v3`、`todo_snapshot.v2`でfirst-class Phaseを追加した。
- Phaseは`locked / active / gate_ready / reviewing / accepted / rejected`を持ち、gate policy、必須evidence slot、Decisionをplan/journal digestへ束縛する。
- reject後の再審査とaccept後のreopenを同じDecision digestへ束縛し、開始済み後続があるacceptのreopenは明示overrideなしに拒否する。
- `plan create` v2、`todo phase status/review/accept/reject/reopen`を追加した。
- live Ganttはloopback-only HTTP + SSEとし、manifest head変化を閲覧中に反映する。stable readは開始/終了manifestを照合し、mixed viewをfreshとして返さない。
- static Ganttは維持し、Phase policy、状態、ToDo進捗を表示する。

## 検証

- `npm run check`: green
- 関連8 test file: 113 tests green
- Phase focused: ToDo完了だけでは後続を解放せず、review + required slot付きaccept後だけ解放
- reject → reopen → review → accept: green
- live viewer: `127.0.0.1` bind、network no-store、SSE head更新通知: green

## 未完了として残すもの

- Phase stateを保持するsuccessor revision/migration
- cross-plan Phase Decision/head causal binding
- AIShell 49 ToDoの明示Phase移行
- bounded seam transform一般化
- 実browser受入、full CI、最終maintenance / Critic

未完了項目は成功扱いにせず、後続ToDoで継続する。
