# Renderer v7 — dotagents実workload機械受入

- Date: 2026-07-19
- Control: `lattice-gantt-ui-v7`
- 正本: `docs/plan_lattice_gantt.md` G4
- 対象: Lattice local source → dotagents `.lattice/generated/gantt.html`
- 状態: 実装・機械受入済み。実ブラウザ操作とオーナー目視は未受入

## 実装境界

- optional presentation sidecarと工程番号→canonical ref binding
- lane略号＋正式名＋説明、凡例、非時間軸／dispatch非保証説明
- nodeの状態＋工程番号＋2行title
- 右ペインのoverview／工程detail／TODO store由来の元Markdown形式全工程一覧
- 全工程一覧は登録順・現在状態・工程番号・全文題名を表示し、各行からdetailへ遷移
- 前提／後続navigation、選択nodeとincident edgeの同期
- narrative anchorのfail-closed検証は維持し、全工程一覧の内容源からは分離
- zoom、lane filter、splitter、Enter／Space／Escapeの既存契約維持

## Lattice gate

Node `v24.18.0`で実行した。

```text
node --test test/todo-gantt-presentation.test.mjs test/todo-gantt-layout.test.mjs \
  test/todo-gantt-render.test.mjs test/todo-gantt-selfcontained.test.mjs
23/23 pass, 0 fail, 0 skip

npm run check
exit 0

git diff --check
exit 0
```

## dotagents実生成

正規入口:

```text
cd /Users/kite/Developer/dotagents
node /Users/kite/Developer/Lattice/bin/lattice.mjs todo gantt
node /Users/kite/Developer/Lattice/bin/lattice.mjs todo verify
```

結果:

- renderer: `lattice.todo_gantt_renderer.v7`
- task node: 110
- dependency edge: 69
- detail panel: 110
- store由来の全工程一覧: 110
- lane chip: 12
- 工程番号binding: 110
- relation navigation button: 141
- 状態: done 83／pending 24／in-progress 3／blocked 0
- anchor: verified 72／digest mismatch 36／anchor missing 2
- 工程0328全文題名: `DB projection、projection_pending、pagination、JSON-only read/wait、cancel、timeoutを完成する。`
- 元Markdown本文の埋込み: 0
- 非fragment `src`／`href`: 0
- HTML digest: `97b91f9adf62f81dbe7908ca23c40283afaa49ae9eaf78737df427be18054415`
- `todo verify`: green、`snapshot_stale=false`

## tracked store不変

生成前後で次のSHA-256が完全一致した。

| artifact | SHA-256 |
|---|---|
| manifest | `7fb616a21ec51ebefd44c3fe6a1c1cb1473c795ad5a205f533ec6f2e7f5c983d` |
| plan | `26d7469a71ab49eacb5b09d7822a4e4075f5840c853aad92891d72d975d34597` |
| snapshot | `072d4d1742816f31344eaea3fcb91d8ac26942fa08ed714e9290fed9c3108d4f` |
| journal | `bc19600c0daa624da4871e8332a240843cccb24c1e9dd8149394d7017bcc9935` |

## 未受入

Codex in-app browserは対象`file://` URLをbrowser security policyで拒否した。別browser、localhost化、
raw browser command等への迂回もpolicy上禁止されているため、次は未実行である。

- node／relation buttonの実clickとdetail遷移
- overview／source／選択工程復帰の実操作
- Enter／Space／Escape、lane、zoom、splitterの実操作
- 狭幅表示
- console error／実resource request観測
- オーナー目視受入

これらを成功扱いせず、G4最終受入checkboxとControl finalizationは開いたまま維持する。
