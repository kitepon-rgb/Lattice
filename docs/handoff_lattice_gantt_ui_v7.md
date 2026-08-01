# Handoff — 依存工程図 renderer v7 UI改修（完了済み履歴）

> **ADR 0151により運用上は失効。** 以下の静的HTML生成手順は実行しない。現在の工程表は
> 動的dashboardだけであり、`lattice todo gantt`と個別`gantt.html`生成は廃止済みである。

更新日: 2026-07-19
状態: **完了済み履歴**（以下の状態・未完一覧はhandoff作成時点の記録）
当時の状態: **再開済み・実装と機械検証完了・実ブラウザ受入待ち・未commit**
再開記録: 2026-07-19、Wave 3とdotagents Waveを継続。renderer focused 23/23、実110件生成、
`todo verify`、store bytes不変、外部resource参照0まで確認した。in-app browserの`file://` URL policyにより、
実ブラウザのnavigation／keyboard／狭幅表示とオーナー目視だけ未受入。以下は中断時点の履歴として保持する。

2026-07-19 UI意味訂正: 「元Markdown全文」は移行前Markdown本文の再表示ではない。LatticeのTODO storeを
正本として、全工程を登録順に現在状態・工程番号・全文題名付きで列挙する「元Markdown形式の全工程一覧」
である。rendererはこの定義へ修正済みで、narrative本文とanchor成否は一覧の内容源に使わない。

## 目的

当時は`/Users/kite/Developer/dotagents/.lattice/generated/gantt.html`を対象にしていたが、
この静的成果物は現在の運用対象ではない。

- `fm-0551`を主表示せず、`工程 0551`として人・AIが参照できる
- `O2`等を略号＋正式名＋説明で読める
- nodeで状態・工程番号・題名を読める
- 右ペインを選択工程の状態・前提・後続中心にする
- 右ペインから、store由来の全工程を元Markdown形式で登録順に読める
- narrative anchorのfail-closedは維持し、個別WARNは通常画面から集約する

承認済み詳細計画: `/Users/kite/.claude/plans/enchanted-seeking-abelson.md`
実装正本: `docs/plan_lattice_gantt.md` G4
dotagents受入正本: `/Users/kite/Developer/dotagents/docs/plan_lattice-factory-integration.md`

## Git・並行作業状態

- Lattice branch: `main`
- このhandoff作成前HEAD: `9d57608491178a2cd676c469be6ffd39b14d0200`
- 本作業のcommit: **なし**
- push/publish/host rollout: **未実施**
- オーナー申告により、別セッションがLatticeのロジック側とdotagents側を並行変更中。無関係なHEAD移動・commitは許容されている
- 次セッションは変更pathを毎回確認し、他者変更をrevert・整形・stageしない。重複pathが見つかった場合だけ停止して調整する

### Lattice working tree（本作業）

変更:

- `docs/plan_lattice_gantt.md`
- `package.json`
- `src/todo-cli.mjs`
- `src/todo-gantt-html.mjs`
- `src/todo-gantt-layout.mjs`
- `src/todo-gantt-svg.mjs`
- `test/todo-gantt-layout.test.mjs`
- `test/todo-gantt-render.test.mjs`

新規:

- `src/todo-gantt-presentation.mjs`
- `test/todo-gantt-presentation.test.mjs`

handoff作成前diff stat: 8 tracked filesで251 insertions / 61 deletions＋新規2ファイル。`src/todo-gantt-html.mjs`への最後の右ペイン編集はこの集計後に入っているため、再開時に取り直すこと。

### dotagents working tree

本作業が変更したのは次だけ。

- `/Users/kite/Developer/dotagents/docs/plan_lattice-factory-integration.md`（9行差分）

次は**他セッションの変更**なので触らない・revertしない。

- `bin/apply-codex-config.sh`
- `bin/verify-install.sh`
- `docs/03_settings-fragments.md`
- `docs/05_codex-fragments.md`
- `lib/lattice-hook.py`
- `tests/hooks/codex-smoke.sh`
- `tests/hooks/smoke.sh`
- `tests/install/clean-home.sh`
- `docs/plan_lattice-todo-reconciliation.md`（新規）

## Control

- active Control: `lattice-gantt-ui-v7`
- Lattice repo内、schema `dotagents.orchestration-control.v27`
- revision 1（init＋phase-gate-record）
- risk: `standard`
- behavior lane: `behavior-change`
- 初期dirty=true。理由はControl initより先に`docs/plan_lattice_gantt.md`へ今回のG4項目を編入したため
- 未finalize・未archive。次セッションで同Controlを回収するか、継続不能なら理由を正本planへ明記する

## 完了済み

### 1. 基線

Homebrew既定`node`がv26.5.0で、`package.json`の`>=22.13 <25`外だった。PTY内PATHを次へ切り替えた。

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
hash -r
node -v  # v24.18.0
```

Node 24で既存focused baseline:

```bash
node --test \
  test/todo-gantt-layout.test.mjs \
  test/todo-gantt-render.test.mjs \
  test/todo-gantt-selfcontained.test.mjs \
  test/todo-narrative-anchor.test.mjs \
  test/todo-markdown-renderer.test.mjs \
  test/todo-cli.test.mjs
```

結果: **45/45 green**。

### 2. Wave 1 — presentation model

`src/todo-gantt-presentation.mjs`を新設した。

- optional input: `.lattice/todo/gantt-presentation.json`
- schema: `lattice.todo_gantt_presentation.v1`
- normalized model: `lattice.todo_gantt_presentation_model.v1`
- strict JSON、duplicate key、UTF-8、64KiB、symlink/alias/repo escape、unknown project/plan/laneをfail closed
- lane表示名・説明を`plan_key + lane`で保持
- `task_id`末尾数字を工程番号候補にし、先頭ゼロ除去後にplan内衝突する候補は発行しない
- canonical `{project_id, plan_key, task_id}`を維持
- presentation digestをHTML metadataへ束縛
- CLI result schemaにはfieldを追加していない

`src/todo-cli.mjs`からloaderを呼び、`renderTodoGanttHtml()`へpresentationを渡す。`package.json`の`check`対象へ新moduleを追加。

検証:

- presentation単体 5/5 green
- presentation＋render＋selfcontained 17/17 green

### 3. Wave 2 — 左ペイン

最後にgreenを確認できた状態:

- geometryを `272 x 68`、wave gap 104、lane gap 296へ拡張
- nodeを「状態＋工程番号」「最大2行title」へ変更
- `data-project-id` / `data-plan-key` / `data-task-id` / `data-task-number` / normalized番号を保持
- canonical IDをARIAとSVG `<title>`へ保持
- lane chipを略号＋正式名＋件数に変更し、説明をARIA/titleへ保持
- user-visible名称を「依存工程図」へ変更
- 状態／依存候補／最長依存鎖／joinの凡例を追加
- 「縦方向は時間でなく依存段階」「候補はdispatch保証ではない」を表示
- renderer versionを `lattice.todo_gantt_renderer.v7`へ更新
- 依存順、全edge、join、最長鎖の算法は変更していない

検証:

```bash
node --test \
  test/todo-gantt-layout.test.mjs \
  test/todo-gantt-render.test.mjs \
  test/todo-gantt-selfcontained.test.mjs
```

結果: **18/18 green**。

この18/18 greenの後に右ペイン途中編集を行ったため、**現在のworking tree全体がgreenとは限らない**。

## 未完成・現在の危険な中間状態

### Wave 3 — 右ペイン

`src/todo-gantt-html.mjs`へ以下を途中まで追加した。

- `renderAnchorDiagnostics()`
- 元Markdown内の個別WARNを`<details>`へ集約する`renderDocuments()`変更
- `presentationLookup()` / `taskReference()` / `renderRelationList()`
- overview/detail/sourceを生成する`renderRightPane()`
- 右ペイン用CSS

ただし、**中断時点では次が未実施**。

1. `renderRightPane()`を`renderTodoGanttHtml()`の最終templateへ接続していない
2. 最終templateは旧右ペインのtoolbar＋`narrative-document`をまだ使っている
3. controllerは旧`all/selected`ロジックのまま。overview/detail/source切替、relation navigation未配線
4. incident edge強調未配線
5. SVG edgeに`data-from-node-key` / `data-to-node-key`をまだ付けていない
6. 右ペイン新契約に合わせたtest更新未完
7. 最後の`renderRightPane()`＋CSS追加後は`node --check`もtestも未実行

したがって、現在の`src/todo-gantt-html.mjs`は**未検証の途中成果**。成功扱い・commit禁止。

## 再開直後の手順

1. 他者commitと重複pathを確認する。

```bash
cd /Users/kite/Developer/Lattice
git status --short
git log -5 --oneline
git diff --name-only
```

2. Node 24へ切り替える。

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
hash -r
node -v
```

3. まず現在の中間状態を観測する。エラーを隠さない。

```bash
node --check src/todo-gantt-html.mjs
node --check src/todo-gantt-svg.mjs
node --test test/todo-gantt-layout.test.mjs test/todo-gantt-render.test.mjs test/todo-gantt-selfcontained.test.mjs
```

4. `renderTodoGanttHtml()`内で以下を行う。

- `const documents = renderDocuments(normalized.sections)`を維持
- `const rightPane = renderRightPane(normalized.sections, layout, presentation, documents)`を追加
- 旧`<aside class="narrative-pane">...`の中身を`${rightPane}`へ置換

5. controllerを3状態へ変更する。

- default: overview
- node / relation button: matching detail
- `data-show-source`: 元Markdown全文
- `data-show-overview`: overview
- Escape: overviewへ戻りlane filter解除
- 選択nodeの`aria-selected`とincident edge classを同期

6. `src/todo-gantt-svg.mjs`のedgeへcanonical endpoint keyを付ける。

- `data-from-node-key`
- `data-to-node-key`

7. `test/todo-gantt-render.test.mjs`を新契約へ更新する。

- overview初期表示
- 工程detail
- 前提／後続button
- source view
- anchor summaryとdeveloper details
- 通常画面へ個別WARNを展開しない
- incident edge controller
- Enter/Space/Escape、lane filter、zoom、splitter回帰

8. focused green後にdotagents Waveへ進む。

## dotagents Wave（未着手）

未作成:

- `/Users/kite/Developer/dotagents/.lattice/todo/gantt-presentation.json`

12カテゴリの正式名は`docs/plan_lattice_gantt.md`と承認済み計画に記載済み。Lattice coreへdotagents固有辞書を入れない。

再生成:

```bash
cd /Users/kite/Developer/dotagents
node /Users/kite/Developer/Lattice/bin/lattice.mjs todo gantt serve --port 0
```

静的生成物は作らない。表示確認は動的viewerで行う。

実受入の固定値（中断前調査）:

- task 110
- edge 69
- done 83 / pending 24 / in-progress 3 / blocked 0
- anchor verified 72
- `digest_mismatch` 36
- `anchor_missing` 2

## 非目標

- task ID / TODO store schema変更
- `todo_plan.v3`
- 工程番号CLI resolver
- duration・日付・工数を持つ実時間Gantt
- completion依存をrendererで推論・特例化
- anchor 38件の再束縛
- npm publish / push / host rollout

## 報告上の注意

- 現在は未完成・未検証の中間状態
- 右ペイン実装済み、全test green、実ブラウザ受入済みとは言わない
- commitは存在しない
- 次セッションが完了まで進める場合も、他者変更を巻き込まないpathspec運用を徹底する
