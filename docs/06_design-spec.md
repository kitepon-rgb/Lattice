# todo gantt デザイン仕様（renderer v14＋live viewer）

出典: Claude Code dataviz skill（validated reference palette）。以下の値は検証済みパレットからの転記であり、独自発明しない。

## 0. UI実装制約

1. 依存線は、描画対象のToDoどうしを結ぶedgeを常時描画する（間引き・束ね表示をしない）。既定scopeで
   図から除いたToDoに接続するedgeは、片端が存在しないため描かない。事実としての依存関係は右ペインの
   前提・後続が除外前のグラフから示す（§10）。
2. 状態表示はマーク（☐／▶／✅／⛔）だけに限定する。
3. node箱はタイトル1行と状態マークだけの最小形とする。
4. 横スクロール、ズーム、全体フィットをすべて備える。
5. 集計チップは「カテゴリ別ToDo集計表」とし、plan計からレーン別への入れ子で表す。ラベルは
   カテゴリ名、報告対象は1件以上のカテゴリに限定する。
6. タイポグラフィはdataviz検証済み仕様に準拠し、使用する色は検証済みパレットの定義値に限定する。
7. 右ペインは元plan Markdown文書をそのまま表示し、各task行へ状態マークを置く。行内表示は
   アンカー検証が成立した場合に限定し、成立しない場合はfail closedでWARNを表示して状態マークを
   別置きする。
8. レイアウトは縦流しとし、依存進行を上から下、レーンを横並びに配置する。
9. 図は空間を捨てない。配線帯の高さはその帯を通るedge数で決め、図全体の最大値を全段へ適用しない。
   依存edgeを持たないToDoは段の中で折り返して格子に並べ、横一列に伸ばさない（edgeを持つToDoは
   経路計算の基準線を保つため段の先頭行に残す）。

## 1. サーフェスとテキスト（左右で統一。左=明・右=暗の分裂を廃止）

```css
/* light基調で全体統一 */
--surface-1:      #fcfcfb;   /* 図・右ペイン共通の地 */
--surface-2:      #f4f4f2;   /* 右ペイン・チップの面差し */
--text-primary:   #0b0b0b;
--text-secondary: #52514e;
--border:         #d9d8d4;
```

- 現状の「左＝薄地／右＝濃紺」の分裂を廃止し、全域light基調で統一する。
- テキストは常にtext token（primary/secondary）。**状態色を文字色に使わない**（マークが色を持ち、文字は黒系）。

## 2. 状態色（status palette・固定・categoricalと混用禁止）

| 状態 | 色 | 形（色だけに頼らない） |
|---|---|---|
| 未着手 | 面 `--surface-2`＋枠 `--border`（無彩色） | ☐ 空チェックボックス |
| 作業中 | accent `#2a78d6`（枠2px＋左端バー） | ▶ |
| 完了 | good `#0ca30c`（マークのみ。面は無彩のまま沈める） | ✅ |
| blocked | critical `#d03b3b`（枠2px） | ⛔＋reason必須表示 |

- 完了taskは面を着色しない（済んだものは主張しない）。マークだけgood色。
- 作業中が視覚上最も強い要素になること（critical pathの装飾より強い）。
- 状態は必ず「色＋マーク」の二重符号（CVD対応・dataviz非交渉事項）。

## 3. 依存線とcritical path

- 全edge描画（裁定1）。通常edge: 1.5px `--text-secondary` 40%不透明。
- critical path: 2.5px `--text-primary`。**紫グロー廃止**。色でなく太さと濃度で主張する。
- 矢印頭は小さく（6px級）。線がノードを貫通しない（交差低減はレイアウトの仕事）。

## 4. タイポグラフィスケール（modular・抑制）

| 用途 | サイズ/weight |
|---|---|
| 本文（右ペイン散文・node label） | 13.5px / 400 / line-height 1.6 |
| 節見出し（右ペインh2級） | 16px / 600 |
| 文書タイトル（右ペインh1級） | 19px / 650 |
| チップ・注記 | 12px / 500 / text-secondary |

- 現状の巨大見出し（30px級）・全域boldを廃止。見出しはサイズでなくweightと余白で区切る。
- 等幅は識別子（plan_key/task_id/digest）のみ。日本語本文はsystem UIスタック。

## 5. マークと余白（marks-and-anatomy準拠）

- node箱: 角丸4px・padding 6×10px・枠1px（状態による例外は§2）。タイトル1行＋状態マークのみ（裁定2/3）。
- 隣接要素の間隔は8pxグリッド（8/16/24）。図の外周margin 16px。
- チップ: 12px・`--surface-2`面・枠なし・角丸9999px。plan計→レーン別の主従は入れ子コンテナで表現。
- grid/補助線は使うなら `--border` の50%以下（recessive）。

## 6. 右ペイン（3面・同時に1面だけ表示）

- **概要**: 状態集計、着手候補、Phase進捗、作業中一覧。工程未選択時の初期面。
- **選択工程**: 題名、カテゴリ、正規ID、前提工程、後続工程、元planの行対応、開発者向け診断。
  図のnodeまたは一覧の行を選ぶと開く。同時に開くのは1件だけ。
- **全工程**: 全ToDo一覧。planごとに区切り、図から除いたToDoは既定closedの`details`へまとめる。
  planの並びは、動いているplanを最終活動の新しい順で上、全ToDoが図から外れた完走planを古い順で下。
  plan内のToDo順は登録順を保つ。
- 幅上限 72ch（読みやすさ）。どの面からもToDoの詳細へ到達でき、到達先の無い選択ボタンを出さない。
- 各task行の状態マーク（☐/▶/✅/⛔）だけが「生きた」要素。**Status/Lane/時刻/wave表/Evidence等の
  メタデータブロックは置かない**（左の図と重複するため）。

- **全工程はstore由来**。元plan Markdown本文の再表示ではない（2026-07-19 UI意味訂正）。Latticeの
  TODO storeを正本として、全工程を登録順に現在状態・工程番号・全文題名付きで列挙する。元文書へは
  各工程の詳細が持つsource参照（`元plan: <ref>:<line>`）から辿る。
- narrative Markdownはanchor検証のために読むが、ページへは描画しない。読み込んだ量は
  `prose_bytes`として計上し、上限超過は`TODO_SCALE_EXCEEDED`でfail closedにする。

## 7. 検証

- 上記hexは dataviz reference palette の検証済み値。独自色を足す場合のみ
  `node scripts/validate_palette.js` を実行して通す（勝手に色を発明しない）。
- 実装後、実生成HTMLのスクリーンショットで「label衝突・overflow・視覚階層」を目視確認（validatorはlayoutを見ない）。

## 8. 静的artifactとlive viewer

- 静的HTMLはoffline証拠として維持し、`<output_ref>.status.json`のdigest付きdescriptorと一組で発行する。
- `todo gantt status`は現在の決定的renderと照合して`current / stale / missing`を返す。
  HTML・descriptorの片側欠落、non-canonical bytes、digest不一致はtyped failureとする。
- live viewerはloopback-only、read-only、foregroundとし、SSEでmanifest head更新を通知する。
  URLとSSE endpointは`/projects/<project_id>/`配下へ固定し、live result v2で`project_id`、
  `project_path`、`url`、`events_url`を返す。projectごとのserver sessionは独立portを所有し、
  複数projectを同時表示してもread modelやevent streamを共有しない。browserからstore mutationを行わない。

## 9. ready frontierと並列dispatch

- 破線枠は単なる候補ではなく、現在の`next_ready`に属する同時dispatch推奨ToDoを表す。
- readyが複数なら概要へ推奨同時数を表示し、全件dispatchを既定として明記する。
- subsetだけを直列着手する場合は理由が必要であることを、概要・個別詳細・凡例で一貫表示する。
- Phaseの前後関係をready表示へ暗黙適用しない。`phase_accept_dependencies`だけを明示gateとして反映する。
- 表示はdispatch成功の推測をしない。宣言後もstoreの`active_set`と`next_ready`をそのまま更新表示する。

## 10. 既定scopeの表示規約

- 既定`live`は、後続に作業中・未着手が残っていない完了ToDoを図から除く。まとめnodeやplaceholderを
  代わりに置かない。生きたToDoとその直接の前提ToDoは必ず描く。規約の正本は
  [ADR 0066](adr/0066-gantt-live-scope-drops-finished-work.md)。
- 凡例の件数バッジは展開の入口を兼ねる。押すと全工程を描いた図へ切り替わり、もう一度押すと戻る。
  展開図は同じページへ同梱する（生成物は`file://`でも開くため、配信元へ問い合わせない）。
- 除いたToDoは右ペインの「全工程」にplanごとの畳んだ一覧として全件残り、詳細も開ける。
- 詳細の前提・後続は除外前のグラフから引き、図に描かれていない相手には「（図では非表示）」を添える。
- 総数・進捗・最長依存鎖・ready frontierは除外前の全工程で数える。

## 11. 履歴の畳み込み

- 決着済み（accepted／rejected）Phaseは概要で既定closedの`details`へまとめ、進行中のPhaseだけを展開する。
- 除いたToDoの一覧もplanごとに既定closedの`details`へまとめる。
- 一画面の先頭は常に「いま動いているもの」から始める。履歴は開けば読める場所に置く。
