# plan: 進行中工程へのToDo構造検査の適用

- Status: Complete
- Lane: 統括（Latticeの実装修正とPeertableの実運用再適用を一つの受入へ束縛する複数repo書込み）
- Owner: Codex親が単独writerとして直列実装する
- Started: 2026-08-12
- Predecessor: [plan_todo-logical-structure-graph.md](../plan_todo-logical-structure-graph.md)

## 1. 問題

`todo structure compile`と`todo structure finalize`は、工程storeとsource／Git／sensorの観測対象を
同じ作業木へ固定し、その全体がcleanであることを要求する。このため、未コミット実装と工程記録が存在する
進行中campaignへ構造検査を途中適用できない。

dirtyな実装を検証済み成果へ昇格させてはならない。一方、無関係なdirty entryを理由に、現在のcommit済み
sourceと計画構造の検査自体を拒否する必要もない。

## 2. 成果と契約

authoritative compile／finalizeは、次の二つの面を分離する。

1. **管理面**: 呼出元repoからLattice store、planned source、realizationを読み、artifact／bindingを書き戻す。
2. **観測面**: 呼出元repoのcurrent `HEAD`をLatticeが一時的なclean worktreeへ自動展開し、source、Git来歴、
   sensorをそのsnapshotだけから観測する。

未コミットsourceは観測面へ混ぜない。したがって未コミット実装は「HEADにはまだ存在しない」ものとして扱われ、
planned anchorとの一致・不一致へ正直に現れる。利用者へworktree作成、stash、全差分commitを要求しない。

## 3. 不変条件

- binding／artifactの`current_head_sha`は呼出元repoのcurrent `HEAD`と一致する。
- 観測worktreeはそのHEADでdetached、clean、同一Git repositoryのobjectを使う。
- 一時worktreeは成功・typed failureのどちらでも除去され、残骸を残さない。
- dirtyなindex、tracked変更、untracked fileをsource／Git／sensor evidenceへ混ぜない。
- cleanな呼出元repoでも外部wireとverdictを変えない。
- 構造未適用planの既存挙動を変えない。
- `--allow-dirty`や手動`--source-worktree`を公開契約へ追加しない。

## 4. 作業ToDo

### Phase A — 再現と観測境界

- [x] **lo01 — dirty管理木のcharacterizationを固定する**
  - dirtyなtracked／untracked実装があるfixtureで現行compileが`STRUCTURE_GIT_WORKTREE_DIRTY`になることを再現する。
  - dirty実装がsensor evidenceへ入らず、current HEADのsourceだけが観測される期待値を固定する。
  - worktree作成失敗・sensor失敗でも一時worktreeが回収される受入を置く。
  - 実測: dirty管理木では旧実装が`STRUCTURE_GIT_WORKTREE_DIRTY`で停止。新testは同名の未コミットanchorを
    置いてもHEAD側の`STRUCTURE_CODE_ANCHOR_ABSENT`を維持し、一時worktree数が前後一致する。

### Phase B — 実装

- [x] **lo02 — current HEADのclean観測scopeを実装する**
  - 既存Git processとsensor adapterを再利用し、一時detached worktreeの生成・検証・回収を一つの内部境界へ置く。
  - compile／finalizeのsource evidenceとGit provenanceを同じ観測rootへ向ける。
  - 管理面のsource、artifact、binding、realizationの読書きrootは変更しない。
  - 実装: `todo-structure-authoritative-observation.mjs`がcurrent HEADのdetached worktree作成、Git provenance、
    同梱sensor初期化、source evidence、強制回収を一つの内部境界として所有する。

- [x] **lo03 — lifecycle退行を閉じる**
  - clean／dirty双方でcompileを通し、同じHEADなら同じ構造verdictになることを確認する。
  - dirty実装が未採用であること、finalizeも同じ境界を使うこと、残存worktreeがゼロであることを確認する。
  - focused test、関連integration、`npm run check`を通す。
  - 実測: `node --test test/integration/todo-structure-lifecycle.integration.mjs` 2件green、`npm run check` green。
    sensor初期化の注入失敗でもworktree list前後一致を確認した。
  - Peertable初回適用で、planned `after_task`とin-progress realization未作成がactivationを循環停止させる
    不足を発見。planned postconditionの遅延受理、final postcondition検証、done時realization必須へ段階を分離し、
    source adapter／overlayのfocused testへ固定した。

### Phase C — Peertable実運用

- [x] **lo04 — Peertableの停滞工程へ再適用する**
  - `peertable-dm-delivery-fx4e-20260811`の保存済み構造入力を、dirtyな実運用repoからcompileする。
  - current HEADだけを観測したverdict／findingを読み、未コミット成果を完成扱いしていないことを確認する。
  - 機能不足またはtyped defectが出た場合は本planへ追記してLattice側を直し、同じ入力で再試行する。
  - 実測: Peertable管理木73 dirty entries、HEAD `103fbfb7e4a6273b11c14d80c9e782a7f6053214`で
    `peertable-dm-delivery-fx4e-20260811`を再compile。verdict `consistent`、finding 0、binding作成、
    read projectionは`fresh`／`enabled: true`。未コミット`member-turn-completed.mjs`はnatural sourceとして
    取り込まず、planned deferred anchorとして保持した。一時worktree残数は前後不変。

- [x] **lo05 — 契約・変更履歴・受入証拠を閉じる**
  - ADR 0168のclean worktree契約を「cleanなauthoritative observation scope」へ精密化する。
  - focused regressionとPeertable dogfood結果を証拠化し、対象限定commitを作る。
  - publish／global install／本番dashboard deployはH操作として別途承認を得る。
  - ADR 0168へclean observation scope、planned／final postcondition、realization順序を反映した。
  - 受入証拠: [evidence/todo-structure-live-optin.md](../evidence/todo-structure-live-optin.md)。publish／install／deployは
    本campaignの未完了ではなく、明示H承認後に行う別操作として残した。

## 5. 受入条件

1. dirtyなPeertable本作業木で構造compileが実行できる。
2. artifactが束縛するsource／Git／sensorはcurrent HEAD由来だけである。
3. 未コミット実装を既存sourceまたは実現済み成果として扱わない。
4. dirty entryをstash、commit、削除、複製しない。
5. 一時worktreeが正常系・異常系とも残らない。
6. clean repoの既存structure lifecycleが退行しない。
