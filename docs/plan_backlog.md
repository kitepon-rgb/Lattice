# 保守・裁定待ちbacklog

会話やhandoffに置くと次のsessionで消える「次の一手」を、Lattice storeの工程として保持する台帳。
ここにあるのは**まだ着手していない**課題であり、着手時にscopeを裁定してから進める。
大物（campaign級）は着手時に専用planを起こし、ここのToDoはその起票をもって完了とする。

工程状態の正本はLattice storeの`backlog` plan。本書は各課題の背景と入口を持つ。

## 課題の背景

### 1. plan_lattice_ganttの残checkbox 8件の裁定

[docs/plan_lattice_gantt.md](plan_lattice_gantt.md)に未消化checkboxが8件残っているが、
対応するstore plan（`phase-control-live-gantt`）は35 task全done。8件はcutover前の古い記述で、
storeに存在しない。中身は「authoring CLI実装」「SessionStart hook接続」「cutover gate」など、
**現在は実在する機能**が多く、別campaignで実現済みなのに文書だけ残った疑いが濃い。
「dotagents側アクセス配線」はdotagents所有の可能性がある。1件ずつ実態と照合し、
完了済みは完了へ、dotagents所有はdotagentsへ、未実現だけを残す裁定が要る。裁定後は
文書をarchiveへ退避する。

### 2. 実変換campaignの起票（PLAN.md第4層の後半）

`seam_candidate → code transform → re-analyze → new plan version`の**実変換**
（隔離worktreeでの実行）。seam-binding campaignで実データの`seam_candidate`が出せる状態に
なったので着手条件は揃った（[実行記録](evidence/2026-07-27-concern-declaration-first-candidate.md)）。
campaign級なので、着手時に専用planを起こす。`bounded-seam.mjs`のcaller assertion問題の解消も
このcampaignが所有する（plan_seam-proposal非目標より持越し）。

### 3. evidence receiptの複数path解決（ADR 0133 Open question 1）

同名symbolが複数fileにあると、`lattice.seam_proposal.v1`の`evidence.queries[]`が
`resolved_path`を単数しか持てないため`unknown`へ潰れ、`within`で絞る余地が無い。
実データで`tio-009:summarizeIndependence`が該当。解くには公開contract（evidence契約）の
版上げが要る。頻度を見てから、と裁定済みだが、2件目が出たら着手する。

### 4. bridge daemonのdescriptor読み取りretry

bridge daemonのdescriptor読み取りにretryが無く、起動と同時に読むとraceで落ちる。
maintenance級の欠陥修理。

### 5. ADR 0132 Open questions 2〜4の再裁定

複数の非劣位候補を持つ`candidate_set` v2（OQ2）、`verification` digestを契約側で締めるか（OQ3）、
新規fileだけを作るToDoの独立性判定（OQ4）。いずれも「実データの蓄積後に裁定」と決めてある。
OQ4は新module・新doc・新test追加という実開発ToDoのかなりの割合が判定対象外になる実害があり、
再裁定の優先候補。

## 工程

工程の状態・依存・完了証拠はLattice storeの`backlog` planが正本。以下は対応表である。

- [x] plan_lattice_ganttの残checkbox 8件を実態と照合して裁定する
- [ ] 実変換campaignを起票する
- [ ] seam evidence receiptの複数path解決を裁定する
- [x] bridge daemonのdescriptor読み取りへretryを入れる
- [ ] ADR 0132 Open questions 2〜4を再裁定する

## 導線

- 製品思想: [PLAN.md](../PLAN.md)
- 直近の裁定: [ADR 0133](adr/0133-concern-anchor-binding.md)

---

# 自己記述面のparity（ADR 0130の履行漏れ）

工程状態の正本はLattice storeの`self-description-parity` plan。

0.16.0で`concern_anchors`という能力を足したのに、**Latticeの自己記述面へ足さなかった**。
[ADR 0130](adr/0130-lattice-describes-its-own-parallelism-surface.md)は「Latticeが自分の
並列化面を自分で説明する／案内文言の単一正本」を決めており、これはその履行漏れである。

具体的に欠けているのは2箇所:

1. `TODO_INDEPENDENCE_WORKFLOW`（`lattice todo --help`とMCP instructionsへ出る宣言手順）が
   `owns／reads／writes／affected_tests`しか挙げておらず、`concern_anchors`が載っていない。
2. guidanceカタログに束縛失敗の項目が無い。`SEAM_PROPOSAL_GUIDANCE_CODES`は記録の鮮度
   （unrecorded／superseded／stale／verified）だけで、`semantic_owner_binding_missing`や
   `concern_anchor_unresolved`が出た時に次の一歩を返す口が無い。

**一番必要な瞬間——機械が「束縛できませんでした」と言った瞬間——に解決法を知らせない。**
ToDoのtitleが読めるのに入口が無かったのと同じ構図で、能力はあるのに案内が無い。
AGENTS.mdには書いたので人（AI）側のcontextには入るが、機械が黙っている状態は
ADR 0130が禁じたものそのものである。

## 工程

- [x] 宣言手順の単一正本へconcern_anchorsを載せる
- [x] 束縛失敗のunknownへguidance codeとnext_actionを与える
