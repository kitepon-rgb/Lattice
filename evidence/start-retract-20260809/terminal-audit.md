# start-retract-20260809 終端監査

## 結論

`st2` の実装者ではないMioが、契約 `docs/plan_start-retract.md` の受入5項を独立監査した。
再現欠陥・証拠の不整合・未解消の残留状態はなく、terminal-auditをacceptできる。

## 受入条件の照合

1. 実planのjournal sequence 3–6で、Suzuneのstart→same-actor retract→pending復帰と、
   Bellによる別seat start→release後retractを確認した。`start_retracted` は対象start digestへ束縛されている。
2. t19型の誤start状態は、履歴を消さずpendingへ戻る実遷移として記録され、別seatが再着手できた。
3. 実pull run `st2-retract-live-1` はintake event `3c8fe170…`、release event
   `c5284f77…`、close event `d111f0c3…` の正規chainだった。独立投影は
   `closed=true`、`intakes=[]`、`hold_count=0`、`accepted_count=0`。
   intake中拒否 `ACTIVE_PULL_INTAKE` とrelease後成功は証拠およびfocused testが一致した。
4. pending・done・blocked・他actorの4負例は、journal実遷移、room立会い記録、
   `START_RETRACTION_INVALID` のfocused testで一致した。並行HEAD更新時の
   `STORE_COMMIT_HEAD_CONFLICT` も全変更rollbackとして観測されている。
5. exact done HEAD `d8be2ffd0ef6905a859a2d2ee5843f6e8524aa8e` を一時fixtureへ展開し、
   start/retract、pull intake、ready frontier、status、Gantt layout/scope/nested/
   independence/render/presentationのfocused testを再実行して106/106 greenだった。

## 証拠と衛生

- st2証拠commit: `2dfd22b60dab22084f8175a6bc0d1955e990e152`
- st2 done commit: `d8be2ffd0ef6905a859a2d2ee5843f6e8524aa8e`
- evidence SHA-256: `6a6d0280acdf5e0274c3481ec998051943dd8e9c332f6e51b623914044975109`
- 配布確認: global `lattice --version` とnpm registryはいずれも `0.51.0`
- registry shasum: `3c6fb34472506ece6d37e3300b4dfa8f44f65a2c`
- start/retract/block/unblock/doneの各atomic commitはstart-retract planの
  manifest/journal/snapshot 3 pathだけを変更した。証拠commitは当該Markdown 1 pathだけ。
- `.git` と `.lattice/todo` に残留lockなし。
- 監査時の作業treeにはRinの進行中s2差分2 pathがあるため、監査はexact done commitの隔離fixtureで行い、
  その差分を読まず、変更せず、stageしなかった。

監査用fixtureは `/tmp/lattice-st2-audit.urnvjB` に残存する。repo外の一時展開であり、
成果物・Git状態・Lattice storeには含まれない。
