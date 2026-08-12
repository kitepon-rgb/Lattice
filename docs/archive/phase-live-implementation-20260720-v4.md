# Phase control / live Gantt 実装証拠

- 対象: 公開不整合修正、Phase core/revision、stable read、live viewer、bounded seam、AIShell移行
- 実施日: 2026-07-20
- 外部Codegraph依存: なし。production consumerは`src/sensor-adapter.mjs`へ切替済み。同adapterが再公開する
  internal compatibility moduleには旧artifact名が残るが、外部runtime、PATH executable、旧cache/dataは読まない。

## 成立した契約

- cross-plan hard dependency / all-of joinをmerged storeで検査し、`start`、`done`、`reopen`の表示とwriterを一致させた。
- 複数plan successorを一つのmanifest CASで公開する`todo revise-set`を追加した。
- `todo status --json` / `todo verify --json`をflag無しJSON wireの互換aliasとして復旧した。
- `todo_plan.v4`、`todo_event.v3`、`todo_snapshot.v2`でfirst-class Phaseを追加した。
- Phaseは`locked / active / gate_ready / reviewing / accepted / rejected`を持ち、gate policy、必須evidence slot、Decisionをplan/journal digestへ束縛する。
- reject後の再審査とaccept後のreopenを同じDecision digestへ束縛し、開始済み後続があるacceptのreopenは明示overrideなしに拒否する。
- `plan create` v2、`todo phase status/review/accept/reject/reopen`を追加した。
- `phase_todo_revision.v1`と`todo revise-phase`を追加し、ToDo stateとPhase stateをsuccessorへ明示移行できる。
- `todo_event.v5`を追加し、cross-plan後続startへaccepted Phase Decision digestと、その時点のpredecessor
  journal headを束縛する。旧event bytesは再解釈せず従来schemaのまま読む。
- live Ganttはloopback-only HTTP + SSEとし、manifest head変化を閲覧中に反映する。stable readは開始/終了manifestを照合し、mixed viewをfreshとして返さない。
- static Ganttは維持し、Phase policy、状態、ToDo進捗を表示する。
- bounded seam candidateはbase SHA、finding/manifest digest、exact span、allowed/required path、verification policyを束縛し、detached worktree外への変更を拒否する。
- AIShellの49 ToDoは見出し等から推測せずPhase 0〜7へ明示mappingし、successor revision `rev-6220a83997f716b34c7effa8`へ移行した。

## 検証

- `npm run check`: green
- `npm run ci`: green（Lattice 525/525、bundled sensor 2414 pass / 37 skip）
- Phase focused: ToDo完了だけでは後続を解放せず、review + required slot付きaccept後だけ解放
- reject → reopen → review → accept: green
- live viewer: `127.0.0.1` bind、network no-store、SSE head更新通知: green
- 実browser: AIShellの49 task node、8 Phase card、Phase 0 active、Phase 1〜7 locked、live最新表示を確認。確認後serverを停止した。
- AIShell: `todo verify --plan aishell-capability-expansion --json` green、snapshot fresh、次の作業は`ace-001`、開始済みToDoなし。
- 外部Codegraph: production importなし。PATH上のCodegraphを起動せず、同梱Lattice sensorをisolated worktreeでfresh生成するintegrationもgreen。

## 敵対監査で未完了として残すもの

- **Critical:** predecessor Phase planをsuccessor revisionへ進めると、既存v5が束縛したretired
  `plan_version`をactive memberだけのreaderが解決できず、store全体が`causal_predecessor_missing`になる。
- **High:** v5 readerはtopologyから導出した全bindingとのexact一致と、bound head時点の完了状態をまだ再検証しない。
- **High:** Phase revisionはmulti-plan revision setへ混在できず、cross-plan Phase topologyを同時cutoverできない。
- **High:** Phase revision / revision setはmanifest公開前crash後、CLI再試行の新timestampによりexact retryできない。
- **High:** stable readはjournal更新後・manifest更新前の一時head mismatchをbounded retryせずlive errorへ出す。
- override付きPhase reopen後に、過去のcross-plan start causal bindingが現在はstaleであることをread modelへ投影する契約。
- Phase revision transactionの各crash pointを列挙したrecovery matrix test。
- static Gantt artifactのcurrent/stale/missingを独立に判定する公開status surface。
- 上記を閉じた後の最終maintenance / Criticと公開文書同期。

Phaseの通常運用、単一revision、live表示、AIShell移行、bounded seamのfocused経路は成立したが、
Criticalを含むためproduction完了とは扱わない。最終Critic後に`lpg-006`をoverride付きで再openした。
