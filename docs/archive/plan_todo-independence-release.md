# 独立性面のreleaseとSessionStart予算修復

工程の正本はLattice store（plan key `todo-independence-release`）である。本書は目的・思想・判断理由・
非目標・受入条件を所有し、ToDoの状態と依存は持たない。

dotagents側の工程（hook切替・orchestrate正典の改訂）はdotagents自身のstoreが持つ。
このrepoのstoreへは入れない——host配線はdotagentsの所有であり、dotagentsは自前storeに
host配線planを10本持つ既存慣行がある。

## Context

独立性面（[ADR 0127](../adr/0127-todo-independence-projection.md)〜[ADR 0130](../adr/0130-lattice-describes-its-own-parallelism-surface.md)）は
mainへ着地していたがNPM未リリースで、globalは0.12.34のまま`todo independence`を持たなかった。
消費者へ届いていない機構は無いのと同じである。

着手前の敵対的検証（refuter 3体）で、当初計画の2本柱が崩れ、より深刻な実バグが露見した。

- **dotagentsのSessionStart hookは既に毎回6秒枠を超えて殺されている。** 実測6.71〜7.76秒に対し
  外側timeoutは6秒。工程表のINFOが黙って捨てられ続けていた。内訳は`lattice status --json` 3.6秒と
  `lattice todo status` 3.4秒で、**どちらも同じ`readTodoStore`を払っている**（dotagents storeは
  9.7MB／218ファイル）。ここへ独立性の照会を足せば、唯一生きているLattice repo側（1.75秒）も殺す。
- hook側にprojectionのexact key検証を持たせる設計は脆すぎる。実際、`projection.v2`へ版を上げずに
  `guidance`が追加された事例が同日に発生している。exact keyで読む消費者はその瞬間に壊れる。
- 規範の条文化先は共通憲法ではない。`shared/orchestrate/composition.md`が「同一repo writerの
  直列化」を**唯一の正本**と自称し、`delegation-contract.md`が「並列化の検討とLattice既定」節を持つ。
  憲法へ書けばLattice `AGENTS.md`と重複し、ADR 0130で決めた案内の単一正本を割る複製になる。

## 設計判断

1. **版は0.13.0とし、0.12線のpatch運用から離れる。** `lattice.todo_mutation_result`のv1→v2は
   6つのmutationコマンド共通のwire破壊である。0.12線では同種の置換をpatchで出していたが
   （`todo_gantt_artifact`、`bridge_cli_result`）、新しい公開CLI面3つと合わせた変更量では、
   patchのまま出すと利用側が破壊的変更に気づけない。
2. **`.codegraph/`の無視規則は再追加しない。** CodeGraphはsensorへ吸収され索引は`.lattice/sensor/`へ
   移った。CLIもnpm globalもsrc参照も不在で、生成する主体が存在しない。退役pathへ無視規則を残すと
   「戻ってくるかもしれない」と読める。万一復活したら`git status`で気づけるほうが正しい。
3. **hookの予算はLattice側で直す。** 独立性を載せる前に、`lattice status`と`todo status`が同じstoreを
   二重に読む構造をやめる。SessionStartが必要とする情報を1プロセス・1 store読みで返す入口を作る。
   hook側で2呼び出しを並列化するのは、CLIが払っているI/Oを隠すだけで根本ではない。
4. **既存2面は変えない。** `lattice status`と`todo status`はそれぞれ別の消費者を持つ公開面である。
   統合入口は加算の別面とし、`todo_status_result.v4`も`project_status.v1`も不変とする。
5. **消費者はexact keyで読まない。** 統合入口の応答は、必要fieldだけのallowlist読みで消費できる形にする。
   未知keyの追加が消費者を壊す構造を、新しい面へ持ち込まない。

## 非目標

- **witness set schemaの配布物同梱**。runtimeが読むschemaだけを同梱する既存方針が正しい
  （`todo_extraction` v1/v2も同様に非同梱）。
- **共通憲法への並列可否条文**。`shared/orchestrate/`が所有面であり、dotagents側の工程で扱う。
- **dispatch gate**（conflict／unknownの同時起動を機械拒否）。ADR 0063の改訂を伴う。
- **seam提案の生成と実変換**。本campaign完了後の次campaignで、プラン時と実行時の両方を扱う。

## 受入条件

- `lattice --version`が0.13.0で、配布物にMCP instructionsの並列可否節と独立性面のsrcが含まれる。
- 実storeで`todo independence`がprojection v2を返し、daemonが新版へ入れ替わっている。
- dotagentsでSessionStart hookが6秒枠に収まり、INFOが捨てられなくなる。
- 記録が古い状態で「検証済み」と読める出力が無い。

## 工程

正本はLattice store。以下は各ToDoが何を成すかの散文であり、状態と依存はstoreが持つ。

- `tir-001` 吸収前CodeGraphの残骸掃除を完遂する。削除済み実体に対しtrackedな無視規則の削除を閉じる。
- `tir-002` 0.13.0のCHANGELOGを書く。独立性面とwire破壊、patch運用から離れる理由を記す。
- `tir-003` 版を0.13.0へ上げる。package manifestとannotated tagを揃える。
- `tir-004` 既定ブランチへ着地させてpublishする。sensor buildを経由させMCP instructionsを配布物へ届ける。
- `tir-005` global installして実物で確認する。版・配布物・実store応答・daemon入れ替えまでを見る。
- `tir-006` SessionStart向け統合入口の決定をADRとして固定する。二重store読みの事実と、加算の別面とする根拠を書く。
- `tir-007` 統合入口を実装する。project discoveryと工程状態と独立性要約を1プロセス・1 store読みで返す。
- `tir-008` 記録が古い時に検証済みと読める出力を修理する。ready集合が空でも空虚に検証済みへ倒れない。
