# ac3 publish・global install・campaign smokeの証跡

## 成果

- release commit: `04b873c05fac70ae65ebfce01c36c8a1b146508d`
  （`package.json`と`package-lock.json`を`0.51.0`へ更新）。
- `git push origin main`は`6f3baf8..04b873c`を通常pushし、publish前に
  `git merge-base --is-ancestor HEAD origin/main`がrc 0であることを確認した。
- `npm publish`は`@quolu/lattice@0.51.0`をpublic/latestへ公開した。
  registryの`dist.shasum`は`3c6fb34472506ece6d37e3300b4dfa8f44f65a2c`、
  integrityは
  `sha512-o2tR5SoZuRtNvQev5uVu3CZPEmQELuB1SRpI9rejtwX5QnHFmBYcOxz1BDT8QQOzjj1hKUocE+6kVxG+1PSqdw==`
  でpack dry-runと一致した。
- `npm install -g @quolu/lattice@0.51.0`後、`/opt/homebrew/bin/lattice --version`は
  `0.51.0`を返した。旧0.50.1で`TODO_STATUS_INVALID_RESULT`だった現storeに対して、
  installed CLIの`lattice todo status --json`がrc 0となり、st2 ready・ac3 active・
  blocked/audit_pending 0を返した。

## 実campaign mutation smoke

- installed 0.51.0で`start-retract-20260809/st2`をatomic startしたreceipt commitは
  `8f17093206d7011eaa473c2c100ec06b88655b03`、parentは
  `04b873c05fac70ae65ebfce01c36c8a1b146508d`。
- receipt pathは次の3件だけだった。
  - `.lattice/todo/manifest.json`
  - `.lattice/todo/plans/start-retract-20260809/v1/journal/active.jsonl`
  - `.lattice/todo/plans/start-retract-20260809/v1/snapshot.json`
- mutation前にtrackedな`docs/plan_todo_store_atomic_commit.md`を意図的にdirtyにし、
  別pathを既存stageへ置いた。docsのSHA-256は前後とも
  `51559cafc9fdc8f82d09681c81be4ecbd717000e3aeffd0dce2f7e4ad8bd7587`、
  stage entryは前後とも
  `100644 cf2a7b3251ba42df93d35efcf09a225e1d5ebd42 0 .ac3-mio-stage-probe.txt`
  でexact一致した。
- shared Git lock `.git/lattice-todo-store-commit.lock`は完了後に残らず、後続mutation中に
  一時生成されたstore lockも完了後に消えた。probeを除去した最終worktreeはclean。
- st2はsmoke後に正規の同一actor retractへ進み、commit `2671ddce9a1fe3a557102b06a3e90074dda87a82`
  でpendingへ戻った。start receiptと非干渉実測はjournal/commit履歴へ残っている。

## release gate

- `npm run ci`の製品testは1537/1537 green、sensorは2479 pass・6 skip、syntaxは150、
  CLI surfaceは67、open question anchorは29、reachabilityは98 modules・33 research artifacts。
- runtime seam fixtureの旧manifest形による3 failureはsource契約へ追従するcommit `fd28706`で
  3/3 greenへ修復し、Akariの独立監査もgreen（room [1938][1943]）。
- 最終`verify:todo-store`を塞いだbacklog source行移動はatomic revision `ddf9d8b`と
  closure継承`064b6a5`で修復した。6 taskのstate/evidenceはexact保持、source bindingは
  L95..L100、migrationは6件とも`carry_reconciled_metadata`、旧`closed_unaudited`理由も
  exact継承。`npm run verify:todo-store`はrc 0。
- `npm pack --dry-run --json`は0.51.0、800 files、約7.4MBでrc 0。
- publish時の`verify:release-commit`は`04b873c05fac`が`origin/main`へ着地済みと確認してgreen。

## 独立監査

- Akariがbacklog repair 2 commitsをread-only監査し、store path限定、6 taskの意味・state・
  evidence不変、source digest、closure、verifyをgreenと判定した（room [2044]）。
- NagiとRinがinstalled 0.51.0のversion/statusを独立確認し、旧status failureの解消を確認した
  （room [2055][2057]）。
- Rinがst2 atomic startのstore 3 path限定とdirty source/stage exact保持を確認し、Bellもgit実物を
  独立立会いしてac3受入①を認定した（room [2074][2075]）。
