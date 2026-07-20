# ADR 0060 — Project-local run store、lifecycle CLI、strict timestamp

- Status: Accepted / Immutable
- Date: 2026-07-20
- 裁定者: オーナー
- Supersedes: ADR 0044 Decision 8のrun操作面、Decision 10.1の現役run store配置

## Context

ADR 0044の`research/runs/rc3/<run-id>`はLattice自身のRC3実験配置を前提にし、CLI実行時のcwdへ
相対解決されていた。別repoで使うとstore所有者が曖昧になり、HEADが進んだrunには再開・正常終了・明示退役の
正規入口がないため、`STALE_BASE`から脱出できない。runtime timestampもregexと`Date.parse()`だけでは
実在しない暦日を正規化して受理する。

## Decision

1. 現役run storeは対象Git rootの`.lattice/runs/<run-id>/`だけとする。cwdではなく
   `git rev-parse --show-toplevel`へbindし、`.lattice/runs/`がgit ignore対象でなければ
   `RUN_STORE_NOT_IGNORED`で書込前に停止する。旧`research/runs/rc3`は履歴資料であり実行fallbackにしない。
2. `--run`は`.lattice/runs/<run-id>`というrepo相対refだけを受理する。絶対path、遡上、旧root、任意directoryを拒否する。
3. `run start`は一時directoryからrenameしてstore全体を発行する。lifecycle更新は排他lockと
   `events.json`のtemp-file renameで直列化・atomic化する。
4. `run list --json`はcanonical rootを検証し、event chainからopen runだけを列挙する。不正entryを無視せず失敗する。
5. `run resume`はartifact binding、event chain、open状態、request `base_sha`と現在HEADの一致を検査し、
   provider dispatchを行わずresumable frontierだけを返す。
6. `run close`は同じbase bindingを検査し、全TODOがacceptedかつpending receiptがない場合だけ
   `run_closed`を追記する。未完了は`RUN_NOT_COMPLETE`。既に正常close済みなら冪等成功とする。
7. `run abandon --reason <identifier>`はstale baseを含むopen runの明示的な脱出経路である。
   event chainを検証して`outcome: abandoned`の`run_closed`を追記する。暗黙abandonやprovider fallbackは行わない。
8. `run_event.v1.recorded_at`とcontrol compilation evidenceの`observed_at`は、実在する暦日かつ
   `YYYY-MM-DDTHH:mm:ss.sssZ`のcanonical UTCだけを受理する。既存の不正暦日や短い小数秒を持つartifactは
   保存digestが再計算可能でもrejectする。

## Consequences

- 任意cwdやtracked sourceへrun stateが漏れず、repoごとの所有・清掃・backup境界が明確になる。
- stale runは誤再開せず、明示abandonで運用上のデッドロックだけを解消できる。
- timestamp受理集合は縮小する。rejectされた履歴artifactを自動補正せず、作成元で再発行する。
