# ADR 0178 — 操作権限はhostへ委ね、Latticeから禁止操作を配らない

- Status: Accepted
- Date: 2026-08-13
- Supersedes: [ADR 0139](0139-worktree-local-commit-is-permitted.md)の`forbidden_operations`判断

## Context

Lattice runtimeはexecutor packetの`forbidden_operations`へ`push`、`branch`、`merge`、`rebase`、
`reset`、`stash`を入れ、操作AIへ禁止事項として配っていた。これは工程の構造や実測結果ではなく、
Lattice独自の権限制御である。操作AIにはhostとオーナー依頼が既に権限を与えており、Latticeが別の
許可制度を重ねる理由はない。

一方、隔離worktreeのHEADがbaseの子孫であることはdiff観測の技術的前提である。この前提は操作名の
禁止ではなく、既存のdiff observerが実際のHEADを観測して判定できる。

## Decision

Latticeが生成するexecutor packetの`forbidden_operations`は空配列にする。v1 packetとの互換性のため
fieldは残すが、Latticeから操作禁止を配らない。validatorと公開schemaは空配列を受理する。

操作権限はhostとオーナー依頼へ委ねる。worktreeの観測可能性は、操作名を事前禁止せず、実際のHEADが
baseの子孫であることと実diffの観測で判定する。

## Consequences

- Latticeは`push`を含む外部操作の許可者にならない。
- 操作AIはhostから与えられた権限だけに従う。
- baseの子孫でないHEADは従来どおり観測不能としてfail loudする。これは権限制約ではなく、入力状態の
  実測結果である。
- 旧packetの非空`forbidden_operations`も互換入力として引き続き検証できる。
