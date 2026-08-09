# atomic store commit 終端監査

## 結論

`todo-store-atomic-commit-20260809` は受入可能。store限定mutationをdirty sourceと
既存stageから隔離してatomic commitする実装、実repo運用配線、publish済み0.51.0での
実campaign smokeまで成立し、残存する再現欠陥はない。

## task証跡と独立監査

- ac1 source `152754c..4c4868a` は共通Git-dir lock、dirty store preflight、detached
  index、HEAD CAS、store path限定commit、失敗時rollback、typed receiptを実装した。
  Akariの独立42/42、syntax 150、diff-checkと負側はgreenで、残存findingなし
  （room `[1798]`、Rin受理 `[1801]`）。
- ac2 source `3f8fdbe` は `.team/scripts/done.sh` をatomic入口へ配線した。実repo receipt
  `d8757ad` はnote store 1 pathだけをcommitし、dirty source bytesと既存stageを保全した。
  Akariの独立integration + unit 13/13、syntax、shell構文、diff-check、atomic指定を外す
  負側の感度はgreen（room `[1870]`）。
- ac3 evidence `da7f253`、atomic done `3c1f874` を実diff確認した。done commitは
  ac3 evidenceをSHA/blob exactに束縛し、todo-store-atomic planのmanifest/journal/snapshot
  3 pathだけを変更した。
- ac1〜ac3 evidenceのSHA-256とblob OIDは、各done eventへ3件すべてexact一致した。

## release・導入・実campaign smoke

- release commit `04b873c` は `origin/main` の祖先。packageとglobal CLIはいずれも0.51.0。
- npm registryは `@quolu/lattice@0.51.0`、dist shasum
  `3c6fb34472506ece6d37e3300b4dfa8f44f65a2c`、integrity
  `sha512-o2tR5SoZuRtNvQev5uVu3CZPEmQELuB1SRpI9rejtwX5QnHFmBYcOxz1BDT8QQOzjj1hKUocE+6kVxG+1PSqdw==`
  を返し、release証跡と一致した。
- installed 0.51.0によるst2 start receipt `8f17093` はrelease commit `04b873c`をparentとし、
  start-retract planのmanifest/journal/snapshot 3 pathだけをcommitした。RinとBellがdirty
  docsのSHAと既存stage entryの前後exact一致を独立確認した（room `[2074][2075]`）。
- `.git/lattice-todo-store-commit.lock`、`.lattice/todo/.write.lock`、
  `.lattice/todo/.start-binding.lock` はすべて非残存。
- `lattice todo verify --json` はrc 0、schema v3、snapshot fresh、43 members verified、
  result digest `917a0a77b874185daa65260e80cfb102663e3bf613f0ecfa2a935ab229343451`。
- ac3 task証跡に固定されたrelease gateは製品1537/1537、sensor 2479 pass・6 skip、
  syntax 150、CLI surface 67、store verify、pack dry-runがgreen。release前のfixtureとbacklog
  source binding欠陥は `fd28706`、`ddf9d8b`、`064b6a5` で補正され、Akariの独立監査を通った。
- 監査時の作業treeはcleanだった。

## 判定

再現欠陥なし。`terminal-audit` をacceptする。
