# ob01 差し替え: plan note を別 chain file へ分離する

担当: ひなの / plan: machine-held-obligations / ob01 の done 後に見つけた設計欠陥の差し替え

`evidence/ob01.md` は done 時の blob digest で固定されているので書き換えない。本書が続きを持つ。

## 何が問題だったか

初版は plan note（`todo_note_event.v2`）を task note と**同じ chain file** へ積んでいた。
証跡には「1本の chain に v1 と v2 が混ざる」を**利点として**書いた。その裏面を書いていなかった。

- `parseCanonicalSegment` は **1 event ずつ byte 完全一致で検証**し、1件でも通らなければ
  chain 全体を `NOTE_LOG_CORRUPT` で落とす
- note の読みは `todo start` の**前提条件**（`src/todo-cli.mjs`「noteはjournal appendより前に読む。
  読めなければstart自体を止め、部分進行を作らない」）
- したがって **plan note を1件書いた store は、0.47.0 以前の CLI から `todo start` できなくなる**
- **rollback が効かない。** wire の版は pin を戻せば済むが、**store に書いたものは戻らない**

みつきが実 store へ書きかけて直前に止めた（room [182]）。この store は SessionStart hook が
全セッションで読むので、書いていたら卓ごと止まっていた。すずめが `todo status` /
`lattice status` / `todo verify` の3コマンドで破壊範囲を実測した（room [205]）。

**踏み方が「この機能を使う」そのもの**である。使うと戻せなくなる機能は、使わせたくない機能になる。

## 何に差し替えたか

plan note を `plan-active.jsonl` ＋ `plan-sealed/` の**独立 chain** へ積む。

**旧 reader は plan 直下を列挙しない**——読むのは `active.jsonl` と `sealed/*` の2つだけ
（`readTodoNoteEvents`）。別名の file は存在に気づかれない。task note の読み書きは1バイトも変わらない。

| | 混在（初版） | 分離（本差し替え） |
| --- | --- | --- |
| 旧 CLI が task note を読む | **不可**（chain 全体が corrupt） | 可（byte 同一） |
| 旧 CLI で `todo start` | **落ちる** | 通る |
| plan note を書いた後の rollback | **不能** | 可 |
| 破壊的変更の告知 | 要る | 要らない（純粋な追加） |

**旧 CLI から plan note は見えない。これは意図である**——旧 CLI では plan note を**書けない**以上、
読めなくても行動が変わらない。この根拠はみつきの訂正（room [202]）を採った。私は当初
「publish 後は全員が新 CLI を持つ」と書いたが誤りで、**0.47 に留まるユーザーには欠落が永続する**。
窓が閉じるのは私たちについてだけで、それを一般の根拠にすると永続する欠落を一時的と記録することになる。

### 決めた形（room [197] で宣言、[210] で着手）

- **chain は path が決める。** `chainRefs(repoRoot, planKey, scope)` が path と受理 schema を返す。
  読み出し時に他 scope が混ざっていれば `note_chain_scope_mixed` で **typed に落とす**——
  分離は「その file へ何が積まれるか」で守る
- **sequence と `previous_digest` は chain ごとに独立。note 系の起点は 1**
  （journal 系の 0 ではない。すずめが `verifyLinearHashChain` の 0 起点を踏んだのに対し、
  note 側は `validateEventChain` が `sequence === index + 1` を要求する）
- **head は chain ごとに言う。** `note_head_digest`（task）と `plan_note_head_digest`（plan）。
  合成すると「どちらの head か」と連結順を定義する必要が生まれ、
  **順序が決まっていなければ同じ状態から違う digest が出る**（みつき room [188]）
- **同値検証も scope で切る。** `notes` に task が居る ⟺ `note_head_digest !== null`、plan も同様。
  ただし overflow で本文が落ちた時は head だけが残るので、`overflow_count > 0` の時は
  「両方 null でない」だけを見る
- **`overflow_count` は合成のまま。** 予算は context 全体の話で chain の性質ではない。
  「合成しない」は**意味を持つ field への規律**であって、集計値まで機械的に適用しない
- **merge 順は決定的規則。** plan note が先、task note が後。各 chain 内は sequence 降順。
  `recorded_at` は使えない（`future_clock_skew` を今日実際に踏んでいる）
- **訂正は scope を跨げない**（初版から）。分離するとこれが**構造で保証される**——
  supersede が chain を跨ぐことが原理的に無くなる（みつき room [188] の発見）
- **`note list --plan <k>` は両 chain を返す。** `full_history_command` がこの形を指す以上、
  片方でも落とせば「full」と名乗りながら全部を取りに行けない。`--task` 付きは task scope だけ

### 版

`todo_note_list_result` を v1 → v2（`plan_note_head_digest` 追加）。
`todo_note_context.v2` / `todo_note_event.v2` / `todo_note_append_result.v2` は初版のまま。
**dotagents は `todo_note_*` を1つも pin していない**（みつき room [134] 実測）ので追従は発生しない。

## どう確認したか

`test/todo-plan-note.test.mjs` を4件→6件へ。追加した2件が差し替えの核心。

| test | 固定した事実 |
| --- | --- |
| **plan note を書いても task chain の byte は1つも変わらない** | 書き込み前後で `active.jsonl` を byte 比較。plan chain には v2 だけ、task chain には v1 だけ |
| **head は chain ごとに言い、片方だけ在っても壊れと読まない** | task note ゼロ・plan note 1件で `note_head_digest: null` かつ `plan_note_head_digest !== null`。`note list` も同じ |

分離の値打ちは「別 file に在る」ことではなく **task chain の byte が動かない**ことなので、
そこを直接 assert した。

- `LATTICE_DASHBOARD_AUTOSTART=0 node --test` で note 関連＋消費面
  （`todo-note-gantt` / `todo-status-plan-notes` / `todo-task-notes` / `todo-gantt-render`）
  まで **37 pass / 0 fail**
- `npm run check` → `syntax check passed: 140 files`

## 手続きで起きたこと

**`todo reopen` は機械に拒否された。**

```
$ lattice todo reopen --plan machine-held-obligations --task ob01 --reason …
{"code":"STORE_INCONSISTENT","message":"reopen_has_started_successor"}
```

ob02 が既に ob01 の成果の上で start しているため。**gate は正しい**——ob02 は
`readTodoPlanNotesForStatus` を消費しており、reopen は「その前提が無かったことになる」を意味する。
`--override-reason` で通すこともできたが、**guard が正しいことを言っている場面で override を使うのは
回避**なので使わなかった。

そこで **reopen ではなく follow-up commit** として入れた。ob01 の受入条件
（plan 単位 note の書込→読出が E2E で通る・配達）は初版から満たしており、**変わったのは格納の layout だけ**で、
`readTodoPlanNotesForStatus` の外形（引数・戻り値の shape・sort 順・`next_commands`）は
1バイトも変えていない。前 campaign の `ap05-fix` と同じ扱い。

**commit は hunk 単位で選んだ。** `src/todo-cli.mjs` と `src/todo-contracts.mjs` は
すずめの ob03（`coordination_mode` 系）と同居しており、**file 単位の `git add` では
pathspec を明示しても防げない**（こはるが room [208] で先に踏んで示した形）。
`git diff -U0` で最小 hunk へ割り、note 系と coordination 系が混ざる hunk が無いことを確認してから
`git apply --cached` した。commit 後もすずめの未 commit 変更が working tree に残っていることを確認済み。

## 未了

- **publish → global install → 実機確認**は未了（初版から継続）。ob01 の完了はそこまで。
- `.lattice/todo/notes/` の commit 方針（みつき room [151] がまとめた）は plan note の
  新 file にも同じく効く。publish まで**実 store に plan note を書かない**を自分の規律としている。
