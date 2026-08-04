# ADR 0158: 計画境界は予測であり、実行時回復は対象作業群へ限定する

- Status: Accepted
- Date: 2026-08-05
- Owners: Lattice
- Supersedes in part: ADR 0064 Decision 4、ADR 0136のexact creation gate
- Reaffirms: ADR 0144

## Context

計画時の`owns`／`reads`／`writes`／`creates`は、並列配置を作るための推定である。しかし現行のauthoringと
front-endは、未作成pathを`creates: true`とfresh absent evidenceへ束縛し、不完全な所有・書込み予測を
dispatch不能へしている。これは実装AIが通常行う新規file作成と予定外の既存file変更を、計画時に完全列挙できる
という誤った前提を置く。

実行時競合の処理も、論理上のhold/continue集合は対象限定なのに、物理barrierとepoch/receipt bindingがrun全体を
一つの世代として扱うため、無関係な実行中workerまで停止・rebindされる。これは請求項10の対象作業群限定停止と
一致しない。

## Decision

### 1. 計画資源は不完全な予測である

最新版contractでは`owns`／`reads`／`writes`をpartial predictionとして扱う。空、不完全、未知の新規file名・件数を
許容し、`creates: true`、exact absent path、nonempty/exact `owns`、affected exact一致をcompile・dispatchの許可条件に
しない。既知の予測は捨てず、write×write、write×read、state/effectの計画時競合へ使う。

旧contractとartifactは再生互換のためreaderを残す。`exact_minimum`の意味を黙って変えず、latest writerのcontractを
version upする。新しいallowlistやopen-resource機構は作らない。

### 2. 予測外と変更影響範囲外を同一視しない

rawな`writes`予測外は`prediction_excess`であり、boundary violation、rollback、成果破棄、単独freezeの理由にしない。
請求項9の「変更影響範囲」は、宣言write一覧そのものではなく、planと構造観測からcompileした影響範囲である。
実変更がその影響範囲外へ及ぶ場合は実行時競合として観測し、対象作業群の処理へ渡す。実変更が同時稼働作業の
予測read/writeまたは、実行時間が重なったattemptの実変更と重なる場合も実行時競合とする。

競合観測は編集を事前禁止しない。worktree上の成果を自動削除せず、origin attemptへ束縛されたartifactとして保持し、
対象作業群の再計画入力にする。

### 3. 競合時は対象bindingだけを停止する

競合処理は、既存のaffected closureとtreatmentが選んだattempt bindingだけをquiesceする。無関係な実行中attemptは
process、context、origin plan revision、leaseを変えず継続する。対象作業群のsuccessorは、無関係attemptのterminalを
待たずに新しいplan revisionで開始できる。

plan revisionの全体連番は維持するが、実行許可とreceipt裁定は
`todo_id + origin plan + dispatch + packet + lease + executor handle`からなるattempt bindingへscopeする。
最新plan pointerだけを理由に旧revisionの無関係receiptを棄却しない。対象としてinvalidatedされた旧attemptだけを拒否する。

全体barrierはstartup、shutdown、明示的全体停止、外部process状態を再構成できないrecoveryに限定して残す。

### 4. 既存契約への適合修正

seam変換前後のwave計測は、active planから導いた同一のcanonical precedenceを使う。waveから依存を発明せず、
同期barrierへもしない。terminalではreceipt受理前にsupervisorがworktreeの最終diffを独立観測し、receipt自己申告を
実観測へ代用しない。これらは新しい安全機構ではなく、既存のschedulabilityと実競合契約への配線修正である。

## Consequences

- 実装AIはproject worktree内で、新規・既存を問わず必要なfileを自由に変更できる。
- 計画予測が粗くても実行でき、既知の重複だけは並列配置へ反映できる。
- 実競合が起きても無関係workerの進行とreceiptを失わない。
- 実行中に複数plan revisionのattemptが共存するため、中央のgateとreceipt resolverはattempt bindingを正本にする。
- 外部worker/process境界以外へ新しい重複検証、fallback、digest層を追加しない。

## Protected behavior

- `NO_PLAN`強制
- 意図的直列化の二度止め
- terminal audit
- startup／shutdown／回復不能時の全体barrier
- legacy artifact readerと過去のADR・evidence
