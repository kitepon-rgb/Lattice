# sdp-001: 宣言手順の単一正本へconcern_anchorsを載せた

- 日付: 2026-07-27
- plan: `self-description-parity` / task `sdp-001`
- 対象commit: 本文の変更を含むcommit（`src/todo-independence-guidance.mjs`）

## 何が欠けていたか

0.16.0で`concern_anchors`（witness set v2）を足したが、`TODO_INDEPENDENCE_WORKFLOW`——
宣言できる欄を挙げる唯一の面——へ足さなかった。step 1は`owns／reads／writes／affected_tests`
までしか挙げておらず、`lattice todo --help`を読んだagentは`concern_anchors`の存在を知れない。
ADR 0130が決めた「Latticeが自分の並列化面を自分で説明する」の履行漏れである。

## 直した内容

step 1の下へ、宣言の段に属する続き行を1本足した。

```
1. 宣言する: .lattice/todo/witness/<plan_key>.json へ、ToDoごとのowns／reads／writes／affected_testsを書く
   係争資源しか所有していないToDoは、その資源の中で自分が触るsymbolをconcern_anchorsへ宣言できる（witness set v2）。並列可否の判定には写らず、切断候補の束縛だけに効く
```

述べているのは3つ。①誰が書く欄か（係争資源しか所有していないToDo）②何を書くか（その資源の
中で自分が触るsymbol）③判定へ写らないこと。③を落とすと、並列可否の入力だと誤読され、
宣言が判定を動かせると思われる——実際には写らないので、そう読んだagentは嘘の宣言をしうる。

## 検証

- `node --test test/todo-independence-guidance.test.mjs` — 8 pass。
  numbered stepの本数を位置非依存で数える形へ変え、続き行が段1に属すること、
  条件（係争資源）と非影響（判定には写らず）を述べることをpinした。
- `node --test test/todo-independence-cli.test.mjs test/session-context.test.mjs` — 24 pass。
- `node bin/lattice.mjs todo --help` の実出力で、続き行がstep 1とstep 2の間に出ることを確認した。

## 残る限界

`TODO_INDEPENDENCE_WORKFLOW`のコメントは「helpとMCP instructionsが同じ手順を語るための正本」と
書いているが、実際にこの定数を読む面は`src/cli-help.mjs`だけである。LatticeのMCP面は
sensorのMCP server（`bin/lattice-mcp.mjs`）で、todo系tool・instructionsを持たない。
つまりこの手順がagentへ届く経路はCLI helpだけであり、コメントの主張はまだ実体を持たない。
