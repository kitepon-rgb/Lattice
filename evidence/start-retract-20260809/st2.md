# st2 実plan・実intake撤回の受入証拠

## 結論

公開済みの `@quolu/lattice@0.51.0` を `/opt/homebrew/bin/lattice` から使い、実plan
`start-retract-20260809` と実pull runで `start -> retract -> 別seat start`、active intake拒否、
release後の撤回、状態別の負のコントロールを通した。誤って着手した状態は履歴を消さず
`start_retracted` で `pending` へ戻り、frontierへ正直に復帰する。

## 配布物

- 実行CLI: `/opt/homebrew/bin/lattice`
- `lattice --version`: `0.51.0`
- registry `npm view @quolu/lattice version`: `0.51.0`

## 実planでの着手・撤回・別seat着手

1. suzuneがst2を原子的に着手した。commitは
   `8f17093206d7011eaa473c2c100ec06b88655b03`、親は
   `04b873c05fac70ae65ebfce01c36c8a1b146508d`、store 3 pathを同じcommitへ収めた。
   既存のdirty/staged probeはSHAが変わらず、原子的store commitが利用者変更を巻き込まないことも確認した。
2. bellによる他actor撤回はrc=1、`START_RETRACTION_INVALID / start_actor_mismatch` で拒否され、
   HEADとstoreは不変だった（room [2078]）。
3. suzuneの同一actor撤回は
   `2671ddce9a1fe3a557102b06a3e90074dda87a82`（sequence 4）となり、
   event `start_retracted`、projection `pending`、`next_ready`復帰を確認した。
4. bellが別seatとして通常着手し、
   `669230cdeb4a96687f54dabe9df2e43ea0b4eb94`（sequence 5）で
   `in-progress`へ遷移した（room [2090]）。

この最初の一巡が、t19型の「着手したが進めるべきでなかった」状態の再現と、履歴を偽らない撤回である。

## pull intakeとの排他

実run `.lattice/runs/st2-retract-live-1` で次を確認した。

- bellのintake中の撤回はrc=1、typed error `ACTIVE_PULL_INTAKE` となり、run refと
  next actionを返し、HEAD/storeは不変だった（room [2098]）。
- 同一actorの `run intake release` 後は撤回が成功し、commit
  `e6db4d80b369bdccd71d5c555ea39ca9d3c0d527`（sequence 6）でpendingへ戻った
  （room [2100]）。
- runは明示close済み。最終statusは `closed=true`、`intakes=[]`、`hold_count=0`、
  `accepted_count=0`、`driver_state=stopped`。

## 負のコントロール

- pendingのst2: `START_RETRACTION_INVALID / start_retraction_requires_in_progress`
- doneのst1: 同じtyped code/reasonで拒否
- blockedのst2: 同じtyped code/reasonで拒否
- 他actor: `START_RETRACTION_INVALID / start_actor_mismatch`

blocked経路では、着手 `8e621a5f46859ca1ae389a057c7e7b6d82d8d16a`、block
`19cdf2deece6fd3236ac7c6c727b50a27ebad312`、unblock
`2d45efded277608ead2a882539360ec10ac632f2`、撤回
`c7466cab7e52fba58cfd9a03e8107a7bdd4677d5` の順に実遷移した。最初のblock試行は
並行HEAD更新を検知して `STORE_COMMIT_HEAD_CONFLICT` で全変更をrollbackし、st2をactiveのまま保った。
再試行時だけblockが成立したため、競合時に偽の進行を記録しないことも実測できた。

## 回帰

- todo CLI／ready frontier／store: 97/97 green
- gantt layout／scope／nested／audit pending／independence／render／presentation: 86/86 green
- todo status: 6/6 green（`LATTICE_DASHBOARD_AUTOSTART=0`）

status testは最初の既定実行で、既存dashboard daemonとの外部状態競合
`PROJECT_ROOT_CONFLICT / dashboard_daemon_ensure_failed` により失敗した。製品assertionの失敗として
扱わず、dashboardを起動しないtest境界を明示して再実行し6/6を確認した。

## 最終境界と衛生

clean HEAD `c7466cab7e52fba58cfd9a03e8107a7bdd4677d5` で独立性を再compileした。
coverageは `verified`、conflictは0、artifact digestは
`acf44d3ea6057b464b1c04ce15c1dc11f3ff6319683860734930d573720da17d`。
計画時witnessのruntime experiment unknownは、この文書に固定した実plan、実intake、負の
コントロールによって実行段階で解消した。最終確認時にst2は`pending`かつ`next_ready`、
audit pendingは0、todo store配下と`.git`に残留lockは0、worktreeはcleanだった。
