# ADR 0170 — v0.58.1 ToDo構造HEAD観測修理の公開を受理する

- Status: Accepted
- Date: 2026-08-12
- Owners: Lattice
- Implements: ADR 0168
- 計画: [plan_todo-structure-live-optin-release.md](../plan_todo-structure-live-optin-release.md)
- 証跡: [2026-08-12-v0.58.1-live-optin-release.md](../evidence/2026-08-12-v0.58.1-live-optin-release.md)

## Context

0.58.0の構造compileは、管理worktreeに未コミット変更があると権威観測を開始できなかった。さらにplanned
`after_task`と進行中taskのrealization要求が循環し、実装前の正しい工程をconsistentにできなかった。
修理では、現在HEADのcleanな一時観測scopeだけをSensor／Git来歴へ使い、planned anchorをpostconditionとして
扱う。オーナーは今回の公開と、今後のLattice通常release連鎖を限定付きで恒久承認した。

## Decision

release commit `50f559e472687b4ee726150f3e7ad88941fef81a`から作った
`@quolu/lattice@0.58.1`を、ToDo構造HEAD観測修理の受理済み公開版とする。

- `origin/main`、npm `latest`、Mac global CLI、dashboard、bridgeは0.58.1へ揃った。
- npm事前packとregistry tarballのSHA-1は
  `8f7f1965e1747cf3b2aeff5d7c41e8796749f527`で一致した。
- 公開版CLIはPeertableのdirty管理状態でも、未コミットcodeを権威sourceへ混ぜず、HEAD `103fbfb7…`から
  consistent／enabled／finding 0のcompileを発行した。
- 今後のLattice通常releaseはAGENTS.mdの限定範囲で恒久承認済みとする。対象version、影響、rollback、
  既定ブランチ祖先gate、公開後smokeはreleaseごとに明示・実測する。

## Rollback

npm版はunpublishしない。Macを0.58.0へ戻してdashboardとbridgeを再起動する。remote mainは巻き戻さず、
必要な修理は新versionで公開する。

## Consequences

- ToDo構造HEAD観測修理の実装・公開campaignを完了とする。
- Peertable既存WIPはこの受理に含めず、構造graphが指す各工程の担当者と工程受理を維持する。
- clean release worktreeへの依存copyは、外側symlinkだけを解き内部symlinkを保持する手順を正とする。
