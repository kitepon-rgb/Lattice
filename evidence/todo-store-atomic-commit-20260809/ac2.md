# ac2 実repo受入と運用配線の証跡

## 成果

- source commit: `3f8fdbe`（`.team/scripts/done.sh`を`--commit-store`へ配線し、
  実Git repoを使うintegration testを追加）
- 実main受入のatomic receipt commit: `d8757ade2cb627b6eb97cb2e1d04618b41200cff`
  （parent `3f8fdbe5955967aa1ebb03839894ccda31fb1c63`）
- receiptのcommit pathは
  `.lattice/todo/notes/todo-store-atomic-commit-20260809/active.jsonl` 1件だけ。
- 実行中はtrackedな`.team/scripts/done.sh`を意図的にdirtyにし、別pathを既存stageへ置いた。
  done.shのSHA-256は前後とも
  `b8723c2f4943e37f540ca3242e198bc423924e6e9bc5b49eda46567668fe1f99`、
  stage entryは前後とも
  `100644 32cc09037cb192cac816e6063b2d96fdc455b1f0 .ac2-mio-stage-probe.txt`で一致した。
- 受入後は一時probeと一時dirtyを除去し、storeを含むmain working treeがcleanであることを確認した。

## 検証

- integration単体: `test/integration/todo-store-atomic-commit.integration.mjs` 1/1 green
- integration + unit: 13/13 green
- 静的検査: `npm run check`、syntax 150 files green
- shell構文: `bash -n .team/scripts/done.sh` green
- integrationはdirty source bytes、既存stageのOID/mode、store-only commit receipt、
  descriptor除去、store cleanを実Git repoで検査する。

## 独立監査

Akariが固定snapshot `3f8fdbe` + `d8757ad`をread-only監査した。独立integration + unit
13/13、syntax 150、bash構文、diff-checkはすべてgreen。隔離worktreeで`--commit-store`だけを
外す負側では、期待するatomic schemaに対して非atomic schemaが返り1/1 redとなり、測定器感度も
成立した。監査資源はremove/prune済み、main clean、残存findingなし（room [1870]）。
