# ADR 0129 — 工程表で独立性を示す

- Status: Accepted
- Date: 2026-07-26
- Extends: [ADR 0128](0128-todo-independence-operational-wiring.md)（独立性判定の運用配線）
- Relates: [ADR 0066](0066-gantt-live-scope-drops-finished-work.md)（scope liveの表示規約）・
  [ADR 0068](0068-gantt-routes-run-between-the-columns.md)（配線規約）・
  [ADR 0063](0063-ready-frontier-dispatch-contract.md)（ready frontier dispatch契約）

## Context

独立性の記録と読み出しは配線されたが、工程表からは読み取れない。Ganttが描くのは依存線だけで、
同じ段に並ぶToDoが検証済みで独立なのか、conflictを抱えているのか、まだ調べていないのかを
区別しない。図を見た人は依然として「線が無い＝並列可」と読むしかない。

右ペインの記述はさらに踏み込んでいて、「ready frontierは全件同時dispatchが既定です」と
断定している。これはADR 0063のdispatch契約の正確な引用だが、独立性の記録が存在する今は
不完全な助言になる。記録がconflictを示していても図と文言は同時dispatchを勧め続ける。

表現方法には配線規約からの制約がある。ADR 0068はカード間の経路を列境界の縦チャネルへ通し、
全経路×全カードの非交差を機械gateで検査する。conflictペアは依存関係ではないため段を跨がず、
同じ段の中で横に並ぶカード同士を結ぶことになるが、**同一段内を横断する経路の置き場が
配線モデルに定義されていない**。カードの枠線もstatusとready frontierの破線で使い切られている。

## Decision

1. **独立性はカード内のバッジと色で示し、カードの寸法と配線には触れない。**
   `検証済み独立`／`要直列`／`未検査`の3状態を、状態記号と同格の宣言として持つ。
   枠線（stroke・dasharray）はstatusとready frontierが既に使っているため使わない。
   バッジはカード内の既存テキスト帯の余白へ置き、`GEOMETRY`の`node_width`／`node_height`を変えない。
   これによりADR 0068の配線規約と非交差gateへ影響を与えない。

2. **conflictペアを線で描かない。** 同一段内を横断する経路はADR 0068の配線モデルに定義が無く、
   Decision 5のgate対象（`edges`と`connectors`）にも入らない。新しい線種を別配列で足せば
   gateを素通りする実装になってしまう。conflictの相手は右ペインの言葉で示す。
   線による表現は配線モデルの拡張として別に決める。

3. **右ペインは独立性の記録がある時だけ断定を弱める。** 記録が無い（`coverage: missing`）plan では
   従来どおりADR 0063の既定を述べる。記録がある場合は、検証済み並列グループ・要直列の組・
   未検査の件数を述べ、「全件同時dispatchが既定」という無条件の断定をやめる。
   凡例にもバッジの意味を加える。

4. **layout schemaを`lattice.todo_gantt_layout.v2`へ上げる。** node projectionへ独立性を持たせ、
   右ペインが語るための投影ブロックをtop-levelへ置く。独立性の読み出しはasync I/Oとgit実行を
   伴うためCLI層で行い、layoutへは値として渡す。layoutは同期pureのまま保つ。
   Ganttは複数planを同時に描くので、plan単位でartifactを引いてmergeする——
   `todo independence`の曖昧判定（単一plan前提）はここへ持ち込まない。

5. **`TODO_GANTT_RENDERER_VERSION`をv17へ上げる。** 表示が変わる以上、既存artifactは
   `todo gantt status`でstaleと判定されなければならない。版数据え置きでの表示変更は、
   古い成果物をcurrentと偽ることになる。

6. **live配信の更新検知へ独立性を混ぜる。** 現状の`head_digest`は`manifest_digest`だけを見るため、
   再compileやHEAD前進では画面が更新されない。plan別のindependence result digestを
   合成した値を共有関数として持ち、描画側と検知側の両方で使う。
   同じ値を二箇所で別々に組み立てると、更新されない状態が静かに再発する。

## 非目標

- **conflictペアの線による表現。** 配線モデルの拡張が要る（Decision 2）。
- **layout内部のready計算と`computeReadyFrontier`の統合。** 前campaign同様見送る。
  両者は結果一致の設計であり、不一致が生じたらlayout側でtyped errorとして顕在化させる。
- **未検査ToDoの非表示や強調による誘導。** 図は事実を示す面であり、dispatchの意思決定は
  advisoryと右ペインの言葉が担う。ADR 0066の「事実の記述は除外前のグラフから」を変えない。
- **dispatch gate。** ADR 0128と同じく本ADRの範囲外。

## Consequences

- 工程表を見た人が、同じ段のToDoについて「検証済みで独立」「衝突がある」「まだ調べていない」を
  区別できるようになる。依存線の不在だけを根拠に並列可と読む余地が図の側でも減る。
- 右ペインが記録の有無で語り方を変えるため、未検査のplanでは従来どおりの助言、
  記録のあるplanでは根拠のある助言になる。
- renderer v17への更新で、既存のGantt artifactは一度すべてstaleになる。再生成で解消する。
- live配信が独立性の変化に追従する。再compileが画面へ届くようになる。
