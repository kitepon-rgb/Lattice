# Research Campaign 1 baseline v2

- 記録日: 2026-07-15
- baseline HEAD: `05cb29024333d08ca582969c416b8b54d785ce25`
- 対象repo: `/Users/kite/Developer/Lattice`
- test分類: `full`（Campaign開始時の一回）
- writer境界: Latticeのみ。`/Users/kite/Developer/dotagents`とObserver関連repoはread-only。

## 旧Control整理

- `.git/dotagents/orchestrate/controls/lattice-research-campaign-1/manifest.json`はrevision 6。
- `worker_runs=0`、`consultations=0`、`campaigns=0`、dispatch receipt 0を実読確認した。
- 指定された旧証拠3ファイルはmanifest内digestとSHA-256が一致し、repo内に別参照がなかった。
- 条件を満たしたため、指定Control directoryと指定3ファイルだけを削除した。

## Gate

- `git status --short --branch`: `## main`、tracked／untracked差分なし。
- `npm run ci`: tests 4、pass 4、fail 0、skipped 0。`npm run check`も成功。
- `codegraph status . --json`: initialized、Codegraph 1.4.1、5 files、23 nodes、57 edges、pending changes 0、
  index state complete、pending refs 0、worktree mismatchなし。
- `codegraph query buildBootstrapDiagnostics --path .`: implementation、CLI import、test importの3結果を返した。
- `spotter doctor`: result OK、warnings 0。

このbaselineはHEAD／workspace digestに関係するsource、fixture、dependency、Codegraph indexが変わるまで再利用する。
RC1 safety-net追加後は、その変更契約に対応するfocused／related gateを使い、full regressionはPhase gateへ集約する。
