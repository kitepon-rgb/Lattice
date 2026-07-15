# RC1 implementation boundary and dispatch contract

- 実施日: 2026-07-15
- source preflight HEAD: `abacc70a3d40b61585b762a5a048c76f513ca8d8`
- Codegraph: 1.4.1、7 files、35 nodes、85 edges、index complete、pending changes／refs 0。
- 共通Decision: ADR 0002、ADR 0003、`lattice-research-campaign-1-v2`。

## Source-edit preflight

planned API `canonicalizeArtifact`、`collectCodegraphEvidence`、`runIsolatedTransform`は、queryがJSON `[]`、
caller／callee／impactがexit 0の非JSON `Symbol not found`を返した。planned source path
`src/artifact-contracts.mjs`、`src/codegraph-adapter.mjs`、`src/isolation-runner.mjs`のaffected testは0だった。
これは依存なしでなく、3 laneとも`new_surface_unknown`である。post-indexまでcaller／callee／impact／affected testを再判定する。

## RC1-A — public artifact contract（F・親直轄）

- write: `src/artifact-contracts.mjs`、`test/artifact-contracts.test.mjs`。
- API: `canonicalizeArtifact(value)`、`digestArtifact(value)`、RC1で消費する各schema validator。
- exact key、plain JSON value、bounded string／array／object、safe repo-relative path、duplicate ID拒否をfail closedにする。
- canonical bytesはUTF-8 JSON、object key lexical order、array order保持、末尾改行なし。digestはそのbyte列のSHA-256 lowercase hex。
- non-finite number、negative zero、unknown field、prototype object、sparse array、過大入力、absolute／`..` pathを拒否する。

## RC1-B — Codegraph adapter（A・native implementer）

- isolated worktree: `/private/tmp/lattice-rc1-codegraph-adapter`。
- write: `src/codegraph-adapter.mjs`、`test/codegraph-adapter.test.mjs`だけ。
- API: `collectCodegraphEvidence({ cwd, querySet, execute? })`。default executorはshellを使わず`codegraph`を起動する。
- operations: `status | query | callers | callees | impact | affected`。input順を保持する。
- exit nonzeroはtyped command failure。exit 0でもJSON parseを必須にし、任意の非JSONを成功へ丸めない。
- 未存在symbolのANSI付き`Symbol "..." not found`だけはtyped `symbol_absent`として保持する。
- `query []`はtyped `symbol_absent`、`affectedTests: []`はtyped `empty`であり、independenceを意味しない。
- statusはinitialized、version、pending changes、mismatch、index state、reindex recommendation、pending refsを検査し、
  absent／stale／unsupported／unresolvedを空graphへ丸めない。
- fake executorでready、empty、ANSI absence、invalid JSON、nonzero、stale／unresolvedをfocused testする。実Codegraph live gateは親が行う。
- package、plan、他module、current main worktree、git stateを変更しない。

## RC1-C — isolation runner（A・native implementer）

- isolated worktree: `/private/tmp/lattice-rc1-isolation-runner`。
- write: `src/isolation-runner.mjs`、`test/isolation-runner.test.mjs`だけ。
- API: `runIsolatedTransform({ repoRoot, baseRef, allowedPaths, transform, verifyCommands, observe? })`。
- source repoがcleanであることとbase SHAを固定し、`git worktree add --detach`で一時worktreeを作る。branch／commitは作らない。
- `transform({ worktreePath })`後にNUL-safe statusからchanged pathを列挙し、safe repo-relative allowed path外、symlink、
  submodule／特殊fileをrejectする。untracked fileを含むbinary patchを生成する。
- verifierはshellなしのcommand＋argsとして一件ずつ実行し、全greenだけをacceptする。任意`observe`はverify後・cleanup前に実行する。
- success／failureの両方で一時worktreeをcleanupし、source HEAD／status不変を再確認する。cleanup failureで元failureを隠さない。
- temp git repoのfocused integrationでallowed transform、out-of-scope write、verifier failure、cleanup、source不変を検証する。
- current Lattice repoへworktree add/remove、branch切替、commit、stash、resetを行わない。test用temp repoだけを操作する。

## 共通Worker契約

両Workerは同時作業者がいる前提で、他者変更をrevertしない。target worktree以外とLattice外repoはread-only。
commit、push、branch切替、merge、rebase、reset、stash、秘密の読取／転記、H操作を禁止する。
Worker ReportはControlが生成したskeletonのexact shapeを保ち、実施／skip理由、変更file、検証結果、未検証、blockerを記録する。
