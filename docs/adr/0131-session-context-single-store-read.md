# ADR 0131 — session開始時の現在地を1プロセス・1 store読みで返す

- Status: Accepted
- Date: 2026-07-26
- Relates: [ADR 0053](0053-todo-store-and-gantt-surface.md)（TODO工程store面）・
  [ADR 0058](0058-project-discovery-and-initial-authoring.md)（project discovery）・
  [ADR 0127](0127-todo-independence-projection.md)（独立性の記録面）・
  [ADR 0130](0130-lattice-describes-its-own-parallelism-surface.md)（並列可否の自己記述）

## Context

host側のSessionStart hookは、session開始のたびに`lattice status --json`と`lattice todo status`を
**順に2回**実行して現在地を組み立てている。実測（dotagents、store 9.7MB／218ファイル）で、

- `lattice status --json` 4.2〜5.3秒（うちdashboard autostartが約1.1秒）
- `lattice todo status` 3.4〜3.7秒
- hook全体 6.7〜7.8秒

これに対しhostが与えている実行枠は**6秒**であり、**現在地の案内は毎回途中で殺されている**。
つまりLatticeは正しい答えを出しているのに、配信面へ届いていない。

原因は二重払いである。`src/project-cli.mjs`の`status`は`readTodoStore`を読んで
`projectTodoStatus`を投影し、`lattice todo status`も同じ`readTodoStore`と`projectTodoStatus`を
繰り返す。store読みは規模に比例して伸びるため、planが増えるほど二重払いの実額が増える。
storeが小さいproject（Lattice repo自身、store 560KB）ではhook全体1.8秒で収まっており、
問題はstoreが育ったprojectで先に顕在化する——**運用が進むほど案内が消える**構造になっていた。

さらに、hostへ並列可否（ADR 0127-0130）を届けようとすると3本目のプロセスが要る。
現状のままでは、唯一生きている小規模projectの案内まで枠外へ押し出す。

## Decision

1. **`lattice session-context --json`を加算の別面として新設する。** session開始時にhostが必要とする
   現在地——project discovery、工程状態、並列可否の要約——を**1プロセス・1回のstore読み**で返す。
   schemaは`lattice.session_context.v1`とし、自己digest規則の`result_digest`を持つ。

2. **既存2面は一切変えない。** `lattice status`（`lattice.project_status.v1`）と
   `lattice todo status`（`lattice.todo_status_result.v4`）はそれぞれ別の消費者を持つ公開面であり、
   不変とする。統合入口はその合成であって置き換えではない。

3. **`todo`フィールドは`todo_status_result.v4`をそのまま埋め込む。** 新しい意味論を発明せず、
   既にhostが検証器を持っている契約を再利用する。移行時、hostは埋め込まれた部分木を
   従来どおりの検証器へ通せる。並列可否も`todo_independence_projection.v2`と同じ
   `{coverage, guidance}`語彙で述べる。

4. **dashboard autostartを行わない。** `lattice status`はdashboard活動を登録する副作用を持つが、
   session-contextは**読み取りだけの面**とする。hookは現在地を知るために呼ぶのであって、
   常駐面を起こすために呼ぶのではない。副作用が要るhostは`lattice status`を別途呼ぶ。
   これが実測1.1秒の削減にもなる。

5. **並列可否は追加のプロセスもstore読みも払わずに載せる。** 同じstore読みから
   `computeReadyFrontier`とactive集合が得られ、記録artifactの読み出しは
   planごとの小さなファイル1つである。readyが無いplanについては述べる対象が無いため、
   `independence`は空配列を返す（ADR 0130の案内catalogが持つ`independence_no_ready_frontier`と同じ判断）。

6. **消費者へexact key検証を要求しない。** 応答は必要fieldだけのallowlist読みで消費できる形にし、
   未知keyの追加が消費者を壊さないことを契約として明記する。並列可否のfieldは
   同日に版を上げずキーが増えた実績があり、exact keyで読む消費者はその瞬間に壊れた。
   **hostは知っているkeyだけを読み、知らないkeyを無視してよい。** 逆に、Lattice側は
   既存keyの意味を変えるときだけschema版を上げる。

## 非目標

- **既存2面の統合や廃止。** それぞれ別の消費者がいる。session-contextはhookのための面である。
- **常駐サービス化。** 1回のプロセス起動で答える面のままとし、daemonへ問い合わせる形にしない
  （RC3制約「CLI+driver常駐でない」を変えない）。
- **store読みそのものの高速化。** 二重払いをやめるのが本ADRの範囲で、
  1回あたり3.7秒という実額の改善は別に扱う。
- **hostの実行枠（6秒）への依存。** 枠はhost側の設定であり、Latticeはそれを前提に
  契約を組まない。速いことは良いが、正しさは速さに依存しない。

## Consequences

- SessionStart経路が2プロセスから1プロセスになり、dotagentsの実測で約9秒（2面の合計）から
  約3.7秒へ落ちる。枠内へ収まり、案内が配信面へ届くようになる。
- 並列可否をhostへ載せても追加プロセスが要らない。ADR 0130で「製品自身が読み方を配る」と
  決めた案内が、session開始時点でhostへ届く。
- storeが育つほど効く。二重払いの削減額はstore規模に比例する。
- 新しい公開面が1つ増える。既存2面と合わせて3つの入口が同じ情報を返すことになるが、
  用途が違う（副作用つきdiscovery／工程状態単体／session開始時の合成）。
