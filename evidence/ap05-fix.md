# ap05 修正: 監査待ちの札がツールバーの操作系を押し出していた

担当: ひなの / plan: audit-pending-surface / ap05 の done 後に自分で見つけた欠陥の修正

`evidence/ap05.md` は done 時の blob digest で固定されているので書き換えない。本書が続きを持つ。

## 何が壊れていたか

監査待ちが複数ある時、札の本文が全件を `·` 区切りで並べていたため文字列が長くなり、
ツールバーを押し広げて**ズーム操作（− / 等倍 / ＋ / 全体表示 / 100%）を画面外へ追い出していた**。
1400px 幅・監査待ち3件で再現。

CSS に書いた `text-overflow:ellipsis` は効いていなかった。`.diagram-toolbar` は
`.gantt-pane` の pane 幅で制約されておらず、flex の縮小が発動しないためである。

## なぜ ap05 の検証をすり抜けたか

ap05 で測ったのは DOM 上の位置と CSS 規則が同梱されていることだけで、
**レイアウトの結果を測っていなかった**。「CSS を書いた」を「CSS が効いた」と読んでいる。
`evidence/ap05.md` の「幅の扱い」節は、この点で誤りを含む。

目視を諦めた判断も早すぎた。ブラウザ拡張の選択にはオーナーの応答が要るが、
`Google Chrome --headless=new --screenshot` は選択を挟まずに動く。この経路で取れた。

## 直し方

出す文字列の側を有界にする。CSS の小手先では、制約されていないツールバーの中で確実に効かない。

1. 本文は `監査待ち N件: <先頭1件>` まで。全件は `title` に残す。
   「ほかM件」は書かない——先頭の `N件` が既に全体を数えており、引き算を二度言う分だけ
   plan 名の表示が削れる。
2. `.audit-pending-chip` に `max-width:30em` を追加（病的に長い plan 名への保険。
   `min-width:9em` は据え置きで、件数は常に読める）。
3. `.diagram-toolbar button` を `flex:0 0 auto; white-space:nowrap` にした。
   札が入って以降ツールバーは幅の奪い合いになり、放置すると「等倍」「全体表示」が2行に折れる。
   削るのは札の側（ellipsis と件数の下限を持つ）とし、操作系は縮ませない。
   **これは既存の共有CSSへの変更**で、効くのは幅が足りない時だけ。余裕がある時の見た目は変わらない。

## どう確認したか

`Google Chrome --headless=new --disable-gpu --window-size=1400,120 --screenshot` で実測。
比較は3枚。

| 条件 | 結果 |
| --- | --- |
| 修正前・監査待ち3件・1400px | ズーム操作が画面外（欠陥の再現） |
| 修正後・監査待ち3件・1400px | 札は `監査待ち 3件: audit-pending-surface/termi…`、操作系は全部1行で可視 |
| 基準・本repo実store（監査待ち0件）・1400px | 札なし、操作系1行 |

3枚目が基準として要る。ボタンの折れが**私の変更で生じたもの**であって元からではないことは、
これで切り分けた（基準では折れていない）。

test は `test/todo-gantt-audit-pending.test.mjs` を更新して7件。

- 本文が件数＋先頭1件までで、全件が `title` に入ること
- 監査待ち20件でも本文長が1件の時と（件数の桁を除いて）変わらないこと
  ＝ plan 数に比例して伸びないことを機械的に固定した
- 既存の実store 2件（gate_ready で出る／`phase_close_unaudited` で消える）はそのまま

`LATTICE_DASHBOARD_AUTOSTART=0 node --test` で gantt 関連（render / selfcontained / live /
scope / note-gantt / audit-pending）まとめて **64 pass / 0 fail**、`npm run check` green。

## やらなかったこと

- Lattice store の状態は動かしていない。新しい task を起こす規模ではない。
- `evidence/ap05.md` は書き換えない（done 時の blob digest で固定済み）。
- `.diagram-toolbar` 自体に `min-width:0` を入れる根本修正はしていない。それは
  ツールバー全体の折り返し挙動を変えるので、ap05 の範囲を超える。必要になったら別 ToDo で。
