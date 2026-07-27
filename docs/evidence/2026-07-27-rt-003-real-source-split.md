# rt-003: 実ソースを三面へ分割し、変換後のtreeで影響testが通った

- 日付: 2026-07-27
- plan: `real-transform` / task `rt-003`
- 契約: [ADR 0137](../adr/0137-real-transform-acceptance-contract.md)

## これが請求項1(b)の一手である

これまでLatticeは「こう切れば競合が消える」と提案するだけで、ソースを書き換えなかった。
提案surfaceはディスク上に存在せず、artifact自身が`hypothetical_new_surfaces`とラベルしていた。

本工程で**実際に分割した**。隔離worktree内で`src/todo-gantt-html.mjs`（626行）が三面へ分かれ、
影響test 6ファイル・73件が全部通った。

| file | 行数 |
|---|---|
| `src/todo-gantt-html.mjs`（残余） | 171 |
| `src/todo-gantt-html.seam-shared.mjs`（共有） | 197 |
| `src/todo-gantt-html.seam-13d0e295b0efa4c1.mjs`（`tio-009`所有） | 158 |
| `src/todo-gantt-html.seam-952ce9f0993da67e.mjs`（`tio-008`所有） | 108 |

```
todo-gantt-render.test.mjs         24 pass 0 fail
todo-gantt-independence.test.mjs   10 pass 0 fail
todo-gantt-selfcontained.test.mjs   2 pass 0 fail
todo-dashboard-registry.test.mjs   13 pass 0 fail
todo-independence-cli.test.mjs     16 pass 0 fail
todo-revision-set.test.mjs          8 pass 0 fail
```

宣言はstoreにcommit済みのものをそのまま使い、1文字も変えていない。

## 作ったもの

`src/seam-rewrite.mjs`。三面の候補と行範囲から、変換後のtextを作る純関数。

- 宣言の範囲を**直前の連続コメント行まで広げる**。JSDocを置き去りにすると、残余に持ち主のいない
  説明が残り、移した先が無説明になる。空行で切るのは離れたコメントを巻き込まないため。
- 移した先で`export`が無い宣言にだけ`export`を足す。
- importは**語単位の照合で必要な分だけ**持ち込む。使わないimportを撒かない。
- 面をまたぐ参照は相対importとして張る。残余は移った分を取り戻し、既存importと重複させない。
- 範囲が重なる宣言、行範囲が取れないsymbol、import blockに食い込む範囲は**整形で解かずに止める**。

整形の裁量は持ち込まない。挙動以外の差が増えると、外部挙動同等性の検証が何を見ているのか
分からなくなる。

## 実データで踏んだ欠陥（構文検査では絶対に捕まらない種類）

最初の書き換えは`node --check`を4 fileとも通ったが、実行すると
`ReferenceError: renderTaskIndexEntry is not defined`で落ちた。

原因はrt-002の導出にあった。共有面の推移閉包を歩くとき、**calleeを照会していないsymbolを
「calleeが無い」と同一視していた**。宣言6 symbolしか照会していないので、閉包が1段で止まり、
`renderTaskIndex`は共有面へ移ったのに、それが呼ぶ`renderTaskIndexEntry`は原pathに残った。

未照会と不在を区別するよう直した。閉包が閉じていなければ`callee_data_missing:<symbol>`で
**候補を作らない**。呼び出し側は不足分を照会して導出をやり直す。実データでは3ラウンド
（14→4→1件の追加照会）で閉じ、共有面は151行から197行へ育った。

これは「構文が通ることは動くことの証拠にならない」の実例である。ADR 0137が受入を
focused test通過まで要求しているのは、まさにこの層を見るためだった。

## 検証

- `node --test test/seam-rewrite.test.mjs` — 6 pass。JSDocごとの移動、必要なimportだけの持ち込み、
  面をまたぐ相対import、範囲重複の停止、行範囲欠落の停止、複数行importと別名束縛の読み取り。
- `node --test test/seam-derivation.test.mjs` — 9 pass。未照会symbolで候補を作らないことを追加。
- `npm test` — 978 pass / 0 fail。

## 分かった運用条件（rt-004へ渡す）

隔離worktreeには`node_modules`が無いため、focused testは`ERR_MODULE_NOT_FOUND`で落ちる。
検証器はworktreeへ依存を用意する必要がある（本repoのものを繋ぐか、別途install）。
これを用意しないと、変換の欠陥と環境の欠陥が同じ`fail`に見える。

## この記録が主張しないこと

- 五条件のうち通したのは`focused_tests_passed`だけである。外部挙動同等性、再index、
  残余conflict 0、競合対の非増加、実行段階数の改善はまだ測っていない（rt-004）。
- 本ツリーへは着地させていない。分割は隔離worktree内だけで起き、`git worktree remove`で消した。
- 共有面が197行になった粒度の妥当性は裁定していない（ADR 0137 Open question 1）。
