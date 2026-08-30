# Latticeの自己記述（並列可否の案内を製品自身が配る）

工程の正本はLattice store（plan key `lattice-self-description`）である。本書は目的・思想・判断理由・
非目標・受入条件を所有し、ToDoの状態と依存は持たない。

## Context

[ADR 0128](../adr/0128-todo-independence-operational-wiring.md)で着手時advisoryが、
[ADR 0129](../adr/0129-gantt-independence-presentation.md)で工程表の表示ができた。機構は揃ったが、
**Latticeを道具として使う側のエージェントへ読み方が届いていない**。実測で分かったのは次のとおり。

- Lattice MCPが配るserver instructionsはsensor（code intelligence）の説明だけで、
  todo系toolは0件、並列可否への言及も無い。MCP経由の消費者にとって独立性は存在しないに等しい。
- dotagentsのSessionStart hookが毎セッション注入するのは工程表の場所とactive／next-readyの件数だけで、
  独立性には触れない。
- dotagentsの共通憲法にあるLattice条文5箇所は「工程管理をいつ使うか」「工程正本はstore」の話であり、
  並列可否の読み方は無い。
- 前campaignで書いた作法はLatticeリポジトリの`AGENTS.md`にある。これが読まれるのは
  **Latticeを開発するエージェント**だけで、Latticeで工程管理をしながら別のプロダクトを作る側には届かない。

結果として、消費者側のエージェントは`todo start`のadvisoryを受け取っても、それが何を意味し
何をすべきかを知らない。見慣れないJSON fieldとして無視する。機構は届いているが、読み方が届いていない。

host側の配線（dotagents）はLatticeの所有ではない。したがって**製品自身が自分の使い方を配る**しかない。

## 設計判断

1. **案内の単一正本を持つ。** 状況と`{typed code, 短い説明, 次にすべきこと}`の対応を1つのmoduleが所有し、
   すべての面はそこから引く。面ごとに文言を書くと必ずずれ、同じ状況に別の説明が付く。
2. **案内は判断する瞬間に届ける。** `todo start`のadvisoryと`todo independence`の投影に載せる。
   読みに来た人だけが分かる場所へ置いても、着手する瞬間の消費者には届かない。
3. **MCP server instructionsへ並列可否の節を足す。** システムプロンプトへ自動注入される唯一の面であり、
   消費者側エージェントへの帯域が最も広い。ADR 0049が禁じているのは
   **MCP由来のproseがplan／witness契約のevidenceになること**であって、
   「並列可否の判断はCLI面で読め」と案内することは、その防壁を補強こそすれ弱めない。
   MCP面の責務を「code intelligence＋Lattice面の入口案内」へ明示的に広げる。
4. **CLI helpは手順を語る。** 現在の1行説明は「何ができるか」しか言わない。
   宣言→compile→読む、という作業の順序を書く。コマンド名を知っている人が次の一歩を踏めるようにする。
5. **案内は事実を述べ、指示しない。** 「〜すべき」ではなく「〜の状態であり、〜すると判定できる」と書く。
   Latticeは判断材料を配る面であり、dispatchの意思決定はhostが所有する（ADR 0063 Decision 5）。

## 非目標

- **dotagents側の配線**（SessionStart hookの1行、共通憲法への条文化）。別repoの所有であり、
  Lattice側の自己記述が済んでから改めて判断する。
- **MCPへtodo系toolを足すこと。** 案内テキストだけを載せ、tool面はADR 0049 Decision 2のまま8 toolに保つ。
  toolを足すとMCPがorchestration面になり、evidence防壁の構造的根拠が崩れる。
- **`todo_status_result.v4`と`dispatch_frontier`への案内追加。** 公開契約どおり不変とする。
- **dispatch gate**、**seam提案の生成と実変換**。従来どおり次段。

## 受入条件

- 同じ状況について、advisory・投影・エラー・helpが同じ文言を返す（文言の正本が1つである）。
- 未検査の工程へ着手したとき、「未判定であること」と「どうすれば判定できるか」が
  機械可読codeと日本語の両方で返る。
- MCPだけを見ているエージェントが、並列可否をCLI面で読めることを知れる。
- 実際にMCPを再ビルドし、注入されるinstructionsに節が含まれることを実物で確認する。

## 工程

正本はLattice store。以下は各ToDoが何を成すかの散文であり、状態と依存はstoreが持つ。

- `lsd-001` ADR 0130を起票する。案内の単一正本、載せる面、MCP面の責務拡張と防壁の維持根拠を固定する。
- `lsd-002` 案内catalogを置く。状況からcodeと説明と次の一歩を引く単一正本をmoduleとして持つ。
- `lsd-003` advisoryと投影へ案内を載せる。判断する瞬間と読みに来た瞬間の両方へ届ける。
- `lsd-004` CLI helpへ作業手順を書く。宣言からcompileを経て読むまでの順序を示す。
- `lsd-005` MCP server instructionsへ並列可否の節を足し、再ビルドして実物で確認する。
