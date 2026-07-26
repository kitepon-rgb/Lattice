# ADR 0130 — Latticeが並列可否の読み方を自分で配る

- Status: Accepted
- Date: 2026-07-26
- Extends: [ADR 0128](0128-todo-independence-operational-wiring.md)（独立性判定の運用配線）
- Relates: [ADR 0049](0049-lattice-mcp-surface-contract.md)（MCP面の公開契約）・
  [ADR 0063](0063-ready-frontier-dispatch-contract.md)（ready frontier dispatch契約）・
  [ADR 0129](0129-gantt-independence-presentation.md)（工程表での独立性表現）

## Context

ADR 0128とADR 0129で、着手時advisory・読み出し投影・工程表表示が揃った。しかし実測すると、
**Latticeを道具として使う側のエージェントへ読み方が届いていない**。

- Lattice MCPが`initialize`で配るserver instructionsはsensorのcode intelligenceだけを説明する。
  todo系toolは0件、並列可否への言及も無い。MCP経由の消費者にとって独立性は存在しない。
- host側の常駐案内（dotagentsのSessionStart hook）が注入するのは工程表の場所とactive／next-readyの
  件数だけで、独立性には触れない。共通憲法のLattice条文も「工程管理をいつ使うか」に留まる。
- 運用の作法はLatticeリポジトリの`AGENTS.md`に書いた。これが読まれるのは**Latticeを開発する
  エージェント**だけで、Latticeで工程管理をしながら別のプロダクトを作る側には届かない。

結果として、消費者は`todo start`のadvisoryを受け取っても意味を知らない。実際、本ADR起票時の
着手で返ったのは`{"self_unknowns":[{"kind":"witness_missing","ref":"no_independence_record"}]}`
だけであり、これが「未判定である」ことも「宣言を書いてcompileすれば判定できる」ことも語っていない。
機構は届いているが、読み方が届いていない。

host側の配線はLatticeの所有ではない（`AGENTS.md`の所有境界: host配線はdotagentsが所有する）。
したがって届ける手段は、**製品自身が自分の使い方を配ること**しかない。

## Decision

1. **案内の単一正本を持つ。** 状況から`{code, message, next_action}`を引く対応表を1つのmoduleが所有し、
   advisory・投影・typed error・helpはすべてそこから引く。面ごとに文言を書けば必ずずれ、
   同じ状況に別の説明が付く。文言の重複は、どちらが正しいか分からない状態を作る。

2. **案内は判断する瞬間に届ける。** `todo start`のadvisoryと`todo independence`の投影へ載せる。
   読みに来た人だけが分かる場所（ドキュメント・help）へ置いても、
   着手しようとしている消費者には届かない。届かない案内は無いのと同じである。

3. **案内は事実と次の一歩を述べ、指示しない。** 「〜すべき」ではなく
   「〜の状態であり、〜すると判定できる」と書く。Latticeは判断材料を配る面であり、
   dispatchの意思決定はhostが所有する（ADR 0063 Decision 5）。案内が命令形になると、
   Latticeがagentを統制する面へ滑る。

4. **MCP server instructionsへ並列可否の節を足す。** MCPのinstructionsはclientが
   agentのsystem promptへ自動で載せる唯一の面であり、消費者側エージェントへの帯域が最も広い。
   ADR 0049 Decision 1が立てた防壁は「**Latticeのplan／witness契約が消費するevidenceは
   CLI面・portable projectionのみ**」であって、instructions textが orchestration面の入口を
   案内することを禁じてはいない。むしろ「並列可否の判断はCLI面で読め」と明記することは、
   MCP proseをevidenceへ持ち込ませない防壁を言葉の側から補強する。
   MCP面の責務を「session code intelligence＋Lattice公開面への入口案内」へ広げる。

5. **MCPへtodo系toolは足さない。** 案内テキストだけを載せ、tool面はADR 0049 Decision 2のまま
   吸収済み8 toolに保つ。toolを足せばMCPがorchestration面になり、
   「graph系evidenceは`plan verify`の独立再計算が機械的に強制する」という
   防壁の構造的根拠（Decision 1）が崩れる。案内は構造を変えないが、toolは構造を変える。

6. **CLI helpは順序を語る。** 現在の1行説明は「何ができるか」しか言わない。
   宣言を書く→compileする→読む、という作業の順序を書き、コマンド名を知っている人が
   次の一歩を踏めるようにする。

## 非目標

- **dotagents側の配線**（SessionStart hookへの1行、共通憲法への条文化）。別repoの所有であり、
  Lattice側の自己記述が済んでから改めて判断する。両方要ると見込んでいるが、順序として後に置く。
- **`todo_status_result.v4`と`dispatch_frontier`への案内追加。** 公開契約どおり不変とする。
  案内はADR 0128で新設したv2面と、ADR 0127で新設した投影面が持つ。
- **案内の多言語化。** 現行の利用面は日本語であり、必要になってから決める。
- **dispatch gate**、**seam提案の生成と実変換**。従来どおり次段。

## Consequences

- 同じ状況について、どの面から読んでも同じ説明が返る。文言の正本が1つになる。
- 未検査の工程へ着手した消費者が、「まだ判定していない」ことと「宣言を書いてcompileすれば
  判定できる」ことを、機械可読codeと日本語の両方で受け取る。無視するにしても、
  何を無視しているかを知った上での判断になる。
- MCPだけを見ているエージェントが、並列可否をCLI面で読めることを知る。
  MCP面の責務は広がるが、evidence防壁は構造（独立再計算とdigest一致）が担い続ける。
- 案内textはLatticeの配布物に含まれるため、hostの配線状況によらず届く。
  dotagents管理外のhostでも同じ案内が出る。
