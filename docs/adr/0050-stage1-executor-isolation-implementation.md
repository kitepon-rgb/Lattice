# 0050 — Stage 1 executor隔離契約の実装形（親セッションsubagent＋観測可能な境界検証）

- Status: Accepted / Immutable
- Date: 2026-07-17
- 前提Decision: [ADR 0046](0046-rc4-writer-target-stage-override.md) Decision 2（executor隔離契約）
- 親裁定: オーナー承認 2026-07-17チャット「2でいい」（選択肢1=隔離HOMEへの認証手動用意、
  選択肢2=subagent executor＋境界検証、を提示の上での裁定）

## Context

ADR 0046 Decision 2は「executorは隔離HOMEで実行する」と定めた。Stage 1着手時の実測で:

1. 隔離HOME（空のHOME）の`claude -p`は**未ログイン扱いで実行不能**（認証が`~/.claude.json`＋
   macOS Keychainへ紐づく）。
2. 認証情報の複製・持込は統括AIのcredential取扱い境界の外にあり、実際に実行環境の
   permission classifierが遮断した（正しい遮断であり迂回しない）。
3. 認証を隔離HOMEへ用意できるのはオーナーのみ＝隔離HOME executorはオーナーの手作業を
   毎回要求する。

「隔離HOME」の字義をそのまま満たす経路が統括AIの権限内に存在しないため、黙って破る・
黙って諦めるのではなく、保護目的を等価に満たす実装形をオーナー裁定で確定する。

## Decision

1. **Stage 1のactual executorは、親セッション経由で認証されるsubagent（implementer role）で
   実行してよい**（HOMEは親と共有）。ADR 0046 Decision 2の「隔離HOME」は、本Decisionの
   2〜4を全て満たす実装形で代替する。この代替はRC4 Stage 1（および同一契約のStage 2の
   executor実行部分）に限る。
2. **packet契約は不変**: `install.sh`・`spotter install`・`apply-codex-config`・
   `claude mcp add`／`codex mcp add`系host変更コマンドの禁止、書込はassigned worktree限定、
   git mutation禁止、clone搬送正典よりpacket契約優先——を各packetへ明記する
   （`isolation_contract`フィールド）。
3. **観測可能な境界検証を毎runで行う**: dispatch前後にhost敏感状態のfingerprint
   （`~/.claude`・`~/.codex`・`~/.agents`のsymlink構造・対象実体、dotagents／Lattice正規repoの
   `git status`）を取得し、**不変をartifact/evidenceへ実測記録する**。差分が出た場合は
   境界事故としてrunを受入拒否し、Stage 2 gateの「境界事故0」を機械的に判定する。
4. **worktree外書込はdiff observerで検出する**（RC3実証済みのscope_violation経路）。
   executorの自己申告に依存しない。
5. **隔離HOME executorへの回帰条件**: オーナーが隔離HOMEへ認証を用意した場合
   （`claude setup-token`等）、以後のStage／campaignは字義どおりの隔離HOMEへ戻してよい。
   本ADRはその場合の障害にならない。

## Consequences

- ADR 0046の保護目的（host汚染防止）は、禁止の宣言（packet）＋改変の検出（fingerprint・
  diff observer）＋受入拒否（境界事故0 gate）の3層で、参照遮断を除き等価に維持される。
- **残余リスクの明示**: subagentはhost状態を「読む」ことは技術的に可能なまま（書込は検出可能、
  読取は検出不能）。Stage 1のexecutor taskは公開repo内容のみを扱い、秘匿情報への読取誘因が
  ない設計とする。この残余はL5 Phase gateの`fable`×high refuterの確認対象に含める。
- 本ADRはStage 1実行前にcommitし、Control `lattice-rc4-dotagents-v1`のdocument_refsへ
  追補として扱う（run evidenceから参照する）。
