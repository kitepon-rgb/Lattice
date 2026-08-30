# 独立性判定の運用配線（independence ops）

工程の正本はLattice store（plan key `todo-independence-ops`）である。本書は目的・思想・判断理由・
非目標・受入条件を所有し、ToDoの状態と依存は持たない。現在地は`lattice todo status --json`で読む。

## Context

[ADR 0127](../adr/0127-todo-independence-projection.md)で並列可能性の記録面ができた。`todo independence compile`が
判定を記録し、`todo independence`がready frontierを検証済み並列・要直列・未検査へ分けて返す。
しかし現状は**読みに行けば正しく答える台帳**であって、運用へは配線されていない。

配線されていないことの実害は4つある。

1. **着手する瞬間に何も伝わらない。** `todo start`はADR 0063のready frontier gateだけを見る。
   そのgateはactive taskが1件も無い初回にしか発火しないため、**すでに誰かが走っている状態で
   別のToDoを着手する**という最も競合しやすい場面が素通りになる。記録済みconflictがあっても黙って通る。
2. **記録がすぐstaleになり、伝える中身が消える。** 鮮度キーがbase_shaの一致だけなので、
   宣言境界と無関係なcommit（docsの修正など）でも全taskの記録が一斉にstaleへ落ちる。
   運用が進むほど「常に未検査」になり、柱1で伝える情報が空になる。
3. **revisionでwitness宣言が置き去りになる。** planを改訂するとtask_idが写像され、
   plan versionディレクトリも変わる。宣言は`.lattice/todo/witness/`に残るが、
   task_idが古いまま誰も移行させない。
4. **見えない。** 工程表は依存線しか描かず、独立性の記録があってもGanttからは読み取れない。

加えて、製品思想（Latticeはconflictにseamがあればrefactorを候補化する）に対して、
現在の記録は**conflictの切断可能性を判別していない**。symbol/path起因の衝突とstate/effect共有の衝突は
対処がまったく違うのに、どちらも同じ`conflict`として記録されている。

## 設計判断

1. **conflictの種別はartifactが持つ（v2）。** 投影側で分類しようとしても復元できない——宣言state
   resourceのIDは任意文字列でprefixから種別を導けず、witness setは読み出し時に手元に無い。
   `compileRuntimePlanV1`の戻り値へnormalized bundleの`resources`を露出させ、compile時に
   resource_id→kind（symbol／path／state／effect）を引いて記録する。引けなければtyped failにする。
2. **切断可能性は投影側で導く。** kindがsymbol／pathなら`code_seam`（コードの分割で並列化しうる）、
   state／effectなら`serial`（共有状態なので直列必須）。precedenceは常に`serial`。
   read×write交差から作られる`rw-*` resourceはkind=stateなので直列側へ倒れる。
   これは保守的な誤りであり、seam候補を見逃す方向にしか外れない。
3. **鮮度はtask単位の事実として扱う。** artifactにtask別の宣言境界（owns path・writes・reads・
   affected_tests・symbol queryのpath）を持たせ、読み出し時に`base_sha..HEAD`のdiffと突き合わせる。
   交差しなかったtaskは、HEADが進んでいても宣言相対では観測が変わっていないのでverified独立を維持する。
   交差したtaskだけを未検査へ落とす。coverageは従来どおりsha水準の事実を述べ、値を増やさない。
   base_shaがgit historyから消えている（rebase等）場合は全task交差扱いにする——これは諦めではなく、
   「差分を確定できない」という事実に対する唯一正しい保守側の答えである。
4. **着手時の伝達は助言であって拒否ではない。** `todo start`の結果へadvisoryを足し、
   activeとの競合・未検査・自分自身のunknownを機械可読で返す。拒否しないのでADR 0063の
   dispatch契約は変えない。ただしadvisoryを計算できない状況（git HEADが読めない等）は
   silent degradeせず、journalへ書く前にstart自体を止める。
5. **witness宣言の移行はコマンドで明示的に行う。** revisionの`task_migration`を読んで
   task_idを写像する。宣言内容が意味的に妥当かは機械には判定できないため、写像だけを担い、
   解決できないIDはfail closedにする。witness fileのpath規約は運用文書からコードの所有へ移す。
6. **Ganttは寸法と配線に触れずに表現する。** カード内のバッジ記号と色、右ペインの文言、凡例で示す。
   枠線はstatusとready frontierで使い切っているため使わない。conflictペアを線で結ぶのは
   ADR 0068の配線モデルに同一段内を横断する経路の定義が無いため、今回はやらない。

## 非目標

- **dispatch gate**（conflict／unknownの同時起動を機械拒否する）。ADR 0063の改訂を伴う。
  判定運用が回り、未検査が実際に減ってから別ADRで決める。
- **seam提案の生成と実変換**。今回は切断可能性の分類までとし、「どう分割すれば並列化できるか」の
  候補生成はRC1ロジックの汎用化を伴うため次段。
- **conflictペアの線による表現**。ADR 0068の配線モデル拡張が要る。
- **dotagents側SessionStart hookへの並列可否行**。別repoの作業。
- **witness宣言の自動導出**。

## 受入条件

- activeなToDoと競合するToDoへ着手しようとしたとき、`todo start`の結果に相手のtask_idと
  切断可能性が載る。載らない状況（記録が無い・未検査）もその旨が機械可読で載る。
- 宣言境界と無関係なcommitでHEADが進んでも、記録済みtaskはverified独立のまま残る。
- revision後に`witness migrate`を通せば、宣言が新task_idへ写り、再compileできる。
- Ganttのカードで独立性が判別でき、右ペインが「全件同時dispatchが既定」と断定しなくなる。
- このcampaign自体をwitness宣言し、共有ファイルへの書き込みがconflictとして記録され、
  着手時に実際に警告が出ることを実物で確認する。

## 工程

正本はLattice store。以下は各ToDoが何を成すかの散文であり、状態と依存はstoreが持つ。

- `tio-001` ADR 0128を起票する。artifact v2・projection v2・start advisory・witness migrateの決定と非目標を固定する。
- `tio-002` artifact v2へconflict kindとtask別宣言境界を持たせる。front-endのresourcesを露出し、compile時にkindを引く。
- `tio-003` projection v2へactive面とdriftを足す。activeとの競合を拾い、切断可能性を導き、非交差staleでverifiedを維持する。
- `tio-004` mutation result v2へadvisoryを足し、start時にactiveとの競合と未検査をjournal書込前に返す。
- `tio-005` witness setのpath規約をコード所有にし、revisionのtask_migrationで宣言を移行するコマンドを置く。
- `tio-006` ADR 0129を起票する。Gantt独立性表現の範囲とrenderer version、conflict線を描かない理由を固定する。
- `tio-007` layout v2へ独立性を通す。plan単位で記録を引いてmergeし、node projectionとtop-levelブロックへ載せる。
- `tio-008` SVGカードへ独立性バッジを描く。記号と和名の宣言を置き、寸法と枠線には触れない。
- `tio-009` 右ペインと凡例を独立性へ追従させる。全件同時dispatchという断定を条件分岐へ改める。
- `tio-010` liveの更新検知へ独立性を混ぜる。再compileとHEAD前進が画面へ届くようにする。
