# todo gantt デザイン仕様（renderer v7＋live viewer）

出典: Claude Code dataviz skill（validated reference palette）。以下の値は検証済みパレットからの転記であり、独自発明しない。

## 0. UI実装制約

1. 依存線は全edgeを常時描画する。
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

## 6. 右ペイン（散文＝元Markdown文書・オーナー裁定）

- 元plan mdの全文をそのまま読める文書として描画（見出し・リスト・checkbox行）。
- 各task行の状態マーク（☐/▶/✅/⛔）だけが「生きた」要素。**Status/Lane/時刻/wave表/Evidence等のメタデータブロックは全廃**（左の図と重複するため）。
- 幅上限 72ch（読みやすさ）。左の図の選択と右のスクロール位置は連動してよいが、文書構造は崩さない。

## 7. 検証

- 上記hexは dataviz reference palette の検証済み値。独自色を足す場合のみ
  `node scripts/validate_palette.js` を実行して通す（勝手に色を発明しない）。
- 実装後、実生成HTMLのスクリーンショットで「label衝突・overflow・視覚階層」を目視確認（validatorはlayoutを見ない）。

## 8. 静的artifactとlive viewer

- 静的HTMLはoffline証拠として維持し、`<output_ref>.status.json`のdigest付きdescriptorと一組で発行する。
- `todo gantt status`は現在の決定的renderと照合して`current / stale / missing`を返す。
  HTML・descriptorの片側欠落、non-canonical bytes、digest不一致はtyped failureとする。
- live viewerはloopback-only、read-only、foregroundとし、SSEでmanifest head更新を通知する。
  browserからstore mutationを行わない。
