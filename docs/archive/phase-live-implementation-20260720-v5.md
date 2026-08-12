# Phase control / live Gantt 実装証拠

- 対象: 公開不整合修正、Phase core/revision、stable read、live viewer、bounded seam、AIShell移行
- 実施日: 2026-07-20
- 外部Codegraph依存: なし。production consumerは`src/sensor-adapter.mjs`へ切替済み。同adapterが再公開する
  internal compatibility moduleには旧artifact名が残るが、外部runtime、PATH executable、旧cache/dataは読まない。

## 成立した契約

- cross-plan hard dependency / all-of joinをmerged storeで検査し、`start`、`done`、`reopen`の表示とwriterを一致させた。
- 複数plan successorを一つのmanifest CASで公開する`todo revise-set`を追加した。revision set v3は
  Phase revision同士、およびPhase revisionと通常revisionの混在を同じ公開barrierで扱う。
- `todo status --json` / `todo verify --json`をflag無しJSON wireの互換aliasとして復旧した。
- `todo_plan.v4`、`todo_event.v3`、`todo_snapshot.v2`でfirst-class Phaseを追加した。
- Phaseは`locked / active / gate_ready / reviewing / accepted / rejected`を持ち、gate policy、必須evidence slot、Decisionをplan/journal digestへ束縛する。
- reject後の再審査とaccept後のreopenを同じDecision digestへ束縛し、開始済み後続があるacceptのreopenは明示overrideなしに拒否する。
- `plan create` v2、`todo phase status/review/accept/reject/reopen`を追加した。
- `phase_todo_revision.v1`と`todo revise-phase`を追加し、ToDo stateとPhase stateをsuccessorへ明示移行できる。
- 2026-07-21裁定でcross-plan v5強参照を撤去した。標準policyはstart時のactive Phase acceptを検査し、
  Phase定義＋所属ToDo集合が同じrevisionだけDecision stateをcarryする。
- live Ganttはloopback-only HTTP + SSEとし、manifest head変化を閲覧中に反映する。stable readは開始/終了manifestを照合し、mixed viewをfreshとして返さない。
- static Ganttは維持し、Phase policy、状態、ToDo進捗を表示する。
- bounded seam candidateはbase SHA、finding/manifest digest、exact span、allowed/required path、verification policyを束縛し、detached worktree外への変更を拒否する。
- AIShellの49 ToDoは見出し等から推測せずPhase 0〜7へ明示mappingし、successor revision `rev-6220a83997f716b34c7effa8`へ移行した。

## 検証

- `npm run check`: green
- `npm run ci`: green（Lattice 528/528、bundled sensor 2414 pass / 37 skip）
- revision set focused: 8/8 green。Phase横断、Phase＋通常revision混在、CLI入口、marker後crash retry、source cutoverを確認。
- Phase revision recovery matrix: marker、revision input、plan、genesis、snapshot、manifest activationの
  6 durability境界すべてで停止し、異なるretry時刻でもmarker内のcanonical genesisへ収束する。
- Phase focused: ToDo完了だけでは後続を解放せず、review + required slot付きaccept後だけ解放
- reject → reopen → review → accept: green
- live viewer: `127.0.0.1` bind、network no-store、SSE head更新通知: green
- 実browser: AIShellの49 task node、8 Phase card、Phase 0 active、Phase 1〜7 locked、live最新表示を確認。確認後serverを停止した。
- AIShell: `todo verify --plan aishell-capability-expansion --json` green、snapshot fresh、次の作業は`ace-001`、開始済みToDoなし。
- 外部Codegraph: production consumerはLattice sensor adapter経由。PATH上のCodegraphを起動せず、同梱Lattice sensorをisolated worktreeでfresh生成するintegrationもgreen。

## 敵対監査で未完了として残すもの

- **解消:** retired plan versionを生きた依存先にしていたv5 causal bindingは標準policyから撤去した。
- **解消:** `lattice.todo_revision_set.v3`でPhase revisionをmulti-plan transactionへ組み込み、
  cross-plan Phase topologyと通常revisionを一つのmanifest activationで同時cutoverできる。
- **解消:** Phase revisionとrevision setはdurable markerのgenesisを再利用し、manifest公開前crash後も
  CLI再試行の新timestampに左右されず収束する。
- **解消:** stable readはjournal更新後・manifest更新前の一時head mismatchをbounded retryし、収束しなければ
  `STORE_BUSY`として表示する。
- **解消:** Phase revision transactionの全6 durability境界を列挙したrecovery matrixを追加した。
- static Gantt artifactのcurrent/stale/missingを独立に判定する公開status surface。
- 上記を閉じた後の最終maintenance / Criticと公開文書同期。

Phaseの通常運用、意味不変revision、multi-plan mixed revision、live表示、AIShell移行、bounded seamのfocused経路は成立した。
残るstatic Gantt status surfaceは後続hardeningとして追跡する。
