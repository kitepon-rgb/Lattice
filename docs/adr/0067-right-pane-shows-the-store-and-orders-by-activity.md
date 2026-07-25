# ADR 0067 — 右ペインはstoreを見せ、動いているものから並べる

- Status: Accepted
- Date: 2026-07-25
- Extends: [ADR 0066](0066-gantt-live-scope-drops-finished-work.md)（図から外した工程の受け皿として
  右ペインを指定している）
- Confirms: 2026-07-19 UI意味訂正（`docs/handoff_lattice_gantt_ui_v7.md`）

## Context

ADR 0053は右ペインを「元plan Markdown文書をそのまま表示する面」と決めていた。renderer v7で右ペインは
概要・選択工程・全工程の3面へ再設計され、2026-07-19のUI意味訂正で「元Markdown全文」は本文の再表示では
なくstore由来の全工程一覧である、と裁定された。

しかし実装には裁定後の残骸が2つ残っていた。

1. toolbarのラベルだけが旧意味（「元Markdown全文」）を名乗り、本文の再表示を期待させた。
2. Markdownを描画して`document.rendered`へ代入する処理が残り、以後どこからも読まれないまま、
   dashboardがstore変更のたびに実行して捨てていた。

さらに一覧の並びがstoreのmember順のままで、動いているplanと完走したplanが混ざっていた。dotagentsの実store
では9planのうち動いているのは1つだけで、それが4番目に埋もれていた。工程表を開く目的は「いま何が動いて
いるか」を知ることなので、先頭が履歴で埋まる並びは目的に反する。

## Decision

1. 右ペインはToDo storeを見せる面であり、元plan Markdown本文を再表示しない。元文書へは各ToDoの詳細が
   持つsource参照（`元plan: <ref>:<line>`）から辿る。narrative Markdownはanchor検証のために読むが、
   ページへは描画しない。読み込んだ量は`prose_bytes`として計上し、集約上限超過は
   `TODO_SCALE_EXCEEDED`でfail closedにする。
2. UIの文字列は実体を名乗る。全工程を開くboxのラベルは「全工程一覧」とする。
3. 「全工程」のplan並びは、全ToDoが図から外れたplanを完走扱いとして下へまとめ、動いているplanを上へ置く。
   動いているplanは最終活動の新しい順、完走planは古い順。plan内のToDo順は登録順を保つ。
4. 最終活動はそのplanのjournal末尾eventの`recorded_at`とする。同時刻は`plan_key`で決定的に割る
   （出力のbyte一致契約を保つため）。
5. 履歴は畳んで下へ置き、展開できる状態で保持する。決着済み（accepted／rejected）Phaseは概要で
   既定closedの`details`へまとめ、進行中のPhaseだけを展開する。図から外したToDoの一覧も
   planごとに既定closedの`details`へまとめる。一画面の先頭は常に動いているものから始める。

## Consequences

- ADR 0053の「右ペイン＝元Markdown文書」は採らない。ToDoの可読性はstore由来の3面が担う。
- 描画して捨てていたMarkdown処理が消え、dashboardのstore変更ごとの無駄が無くなる。
  併せてsection単位の上限を`TODO_SCALE_EXCEEDED`へ変換する経路は到達不能になるため削除した
  （この分岐を覆うtestは存在しなかった）。集約上限は従来どおり効く。
- 並びが活動時刻に依存するため、journalを持たないread modelでは全planが同順とみなされ、
  `plan_key`順へ落ちる。fixtureや部分read modelでも決定的に描ける。
- 「動いているplanが1つしかない」ことが一覧の形で即座に分かる。dotagentsではそれが事実だった。
