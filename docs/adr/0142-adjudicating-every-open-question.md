# ADR 0142 — 未決25件の一括裁定

- Status: Accepted
- Date: 2026-07-27
- Relates: ADR 0132〜0141のOpen questions全件

## Context

ADRのOpen questionsが25件あった。読み直すと3種類が混ざっていた。

1. **後のADRで既に裁定したのに、元のADRへ戻って印を付けていないもの。**
2. **いま裁定できるのに保留しているもの。** 材料は揃っていた。
3. **実データの発火条件を待つもの。** 待つのが正しい。ただし条件が書かれていなかった。

3種類が同じ「未決」という見た目で並んでいると、**放置と保留が区別できない**。件数だけが
残り、どれを見ればよいか分からない。これは記録の欠陥であって、判断の保留ではない。

本ADRは25件すべてに裁定を与える。以後、発火条件を持たない未決は
`npm run check:open-questions`が落とす。

## Decision

### A. 既に裁定済み（記録が古いだけ）

| 元 | 内容 | 裁定先 |
|---|---|---|
| 0132 OQ3 | `verification` digestを契約側で締めるか | 締めた。`verificationEntry`が`residual_conflicts`の空を含めてexact検査する |
| 0132 OQ4 | 新規fileだけを作るToDoの独立性 | [ADR 0136](0136-declared-creation-boundary.md) 創作境界の宣言 |
| 0133 OQ1 | evidence receiptが候補pathを保持するか | [ADR 0134](0134-ambiguous-symbol-receipt-narrowed-by-declared-resource.md) `candidate_paths` |
| 0133 OQ2 | 宣言が資源の一部しか覆わない時の残余 | [ADR 0137](0137-real-transform-acceptance-contract.md) 残余面（residual） |
| 0137 OQ2 | 外部挙動同等性の基準 | [ADR 0138](0138-transform-acceptance-five-conditions.md) 原pathの公開export面の保存 |
| 0139 OQ1 | 後継planのbaseを前進させる配線 | [ADR 0141](0141-resume-base-carries-the-transform.md) 後継requestが決め、Latticeが検証する |
| 0139 OQ2 | canonical branchへの着地 | 同上。branchを進めるのは操作するAI、Latticeは検証を持つ |

### B. 本ADRで裁定する

**0137 OQ3 — 所有面のpath命名。** 閉ループは1周した。**名前は操作するAIが与える。**
`seam-proposal land --names`と`run seam resolve`の`path_names`がその口である。機械が
`<stem>.seam-<hash><ext>`を出すのは、名前が与えられなかった時の既定に留める。命名は
意味の割り当てであり、AIが既にできることを装置へ実装しない（AGENTS.md）。

**0138 OQ1 — 改善量の下限。** **実行段階数が1減れば足りる**とする。変更費用との比を
閾値にするのは、費用の単位を決めなければ成立せず、その単位は今のところ観測できない。
段階数の減少は`measureWaveCount`が実際に測っている量であり、五条件の他の4つが挙動と
競合の非悪化を押さえているので、下限を高くしても得られるのは「変換を減らす」ことだけである。

**0138 OQ2 — version barrierを跨ぐ競合対の同一性。** **`task_migration`で写す。** epoch
successorはtask migrationを必須入力に持ち、predecessor→successorの全射像を宣言する。
対の比較はこの写像を通して行い、写像に現れないtask_idの対は比較しない（新しく生まれた対は
「増えた」として扱う）。

**0140 OQ1 — packetによる封じ込め境界の宣言。** **足さない。** `scope.writes`と
`forbidden_operations`に加えて「このworktreeの外へ書くな」を宣言しても、守らせる手段が
hostの善意しかない。実際の担保は宣言ではなく観測側にあり、ADR 0140がcanonical repositoryの
fingerprintで、`detectCheckpointFindings`が`scope_violation`でそれぞれ果たしている。
守れない契約を増やすと、守られている契約との区別が薄れる。

**0141 OQ1 — seam commitの寿命。** **自動では消さない。** refが指すのは五条件を通って
受理された変換の実体であり、どの版がどの競合をどう解いたかを辿れる唯一の資源である。
証跡を寿命付きにするのは、記録を所有するという製品の役目と衝突する。`listSeamRefs`で
在庫を見せ、消すかどうかは所有者の裁定に委ねる。

**0141 OQ2 — 変換の連鎖。** **前の変換を含むbaseの上でのみ確定できる。** 同じcandidateへ
2回目が来た時、既存refが今回のbaseの祖先を指していなければ拒む。黙って上書きすると
1回目の証跡が消える。連鎖の順序を管理するのは呼び出し側のままだが、順序が壊れていることは
機械が検出する。

### C. 発火条件つきで保留する

| 元 | 内容 | 発火条件 |
|---|---|---|
| 0132 OQ1 | task intent bindingを持つか | 宣言からの割り当てが実データで2件以上失敗したら着手する。現状は人（AI）がcandidate specで与える運用で足りている |
| 0132 OQ2 | 複数の非劣位候補（`candidate_set` v2） | `multiple_incomparable_candidates`が実データで1件出たら着手する |
| 0134 OQ1 | conflict resource自身が同名の場合 | `exact_surface_evidence_missing`が同名衝突を理由に実データで1件出たら着手する |
| 0136 OQ1 | affected testを持たない既存path | 宣言の無いabsent pathと同様に扱えるかを、実データで1件出たら裁定する |
| 0136 OQ2 | 1 ToDoが複数pathを所有する | `affected_tests`をbinding単位のexact比較でなくする改訂が要る。実データで2件以上詰まったら着手する |
| 0137 OQ1 | 共有面の粒度 | 共有面が2つ以上の独立な依存塊を持つ実例が1件出たら着手する |
| 0140 OQ2 | 他workerのworktreeへの誤帰属 | I/O水準の観測が要る。`write-coverage` planのwc-002と同根であり、その発火条件（holdで捨てた作業量の実測）に従う |

## Consequences

未決は25件から**保留7件**へ減り、その7件すべてが観測できる発火条件を持つ。
`npm run check:open-questions`が、条件を持たない未決を落とす。

「未決が残っている」ことは、以後**放置ではなく設計上の待ち**を意味する。

## Open questions

1. **発火条件そのものの陳腐化。** 条件を書いた時点の前提が変わっても、gateは条件の存在しか
   見ない。条件の妥当性を見直す契機を、次にADRを1本書いた時とする——ADRを増やす側が、
   隣接する保留の条件をその場で確認する。
