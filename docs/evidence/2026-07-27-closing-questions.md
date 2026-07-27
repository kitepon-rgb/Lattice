# 2026-07-27 closing-questions — 未決を尽くし、Lattice自身で自分の工程を組んだ

Decision: [ADR 0142](../adr/0142-adjudicating-every-open-question.md)

## この工程の組み方

閉じる作業そのものをLatticeの工程として組み、並列可否を製品に判定させた。自分の閉じ作業を
自分の製品で組めないなら、その製品は完成していない。

1. `todo migrate`で`closing-questions` planを起こす
2. `todo independence witness scaffold`で宣言を書く
3. `todo independence compile` → **conflict_count 1**。cq-002とcq-003が同じ
   `src/seam-commit.mjs`を書く
4. 投影の`severability`が`code_seam` → `todo seam-proposal compile` → `seam_candidate 1`
5. `todo seam-proposal apply` → 隔離worktreeで変換、五条件で採否
6. `todo seam-proposal land --names` → 本ツリーへ着地
7. 変換後の所有で宣言し直して再compile → **conflict_count 0**、
   `parallel_groups: [["cq-002","cq-003"]]`、`serialize_pairs: []`

`src/seam-commit.mjs`は`seam-ref.mjs`（cq-002所有）・`seam-commit-transform.mjs`（cq-003所有）・
`seam-commit-shared.mjs`（共有）・`seam-commit.mjs`（残余・公開symbolを再export）へ分かれた。
**人が手で切ったのではない。工程の並列化のために製品が切った。**

## 実運用で見つけて直した欠陥（7件）

使わなければ出なかったものばかりである。

1. **symbol範囲の取得が既定limitで打ち切られる。** 変換が`symbol_extent_missing:GIT_SHA1`で
   棄却された。原因はwitness evidenceの共通経路がsensor CLIの既定`--limit 10`で名前を引くこと。
   実測で`GIT_SHA1`は17 fileにあり、名前順で先頭10件に入らない`src/seam-commit.mjs`の定義が
   返らなかった。**実在するsymbolを「範囲なし」と誤報していた。** 専用経路で明示limitを渡し、
   limitに達した結果は`missing`でなく`symbol_lookup_truncated`として区別する。
2. **隔離worktreeにbuild成果物が無い。** `sensor/dist`はgitignoreされているのでどのcommitの
   worktreeにも存在せず、同梱sensorを起動するfocused testが全部ENOENTで落ちる。
   `focused_tests_passed`が原理的に満たせなかった。存在する時だけmountする。
3. **verifierの失敗理由が返らない。** `verifier failed (1): node`だけで、どのtestがなぜ落ちたか
   追えなかった。argv全体とstdout/stderrの末尾を載せる。
4. **その修正自体のbug。** 空のBufferはtruthyなので`stderr || stdout`ではstdoutへ落ちない。
   `node --test`は失敗をstdoutへ書くため、理由がまるごと消えていた。
5. **残余面が移動した公開symbolを再exportしない。** 原pathをimportしている全fileが壊れ、
   外部挙動同等性が原理的に満たせなかった。移動先を指すexport文を残余面へ足す。
6. **入力契約違反が期待する形を言わない。** `schema_invalid`だけで、何をどう直せばよいか
   分からなかった。`detail.expected`へ形を返す。**案内が悪いのも不具合である。**
7. **cleanliness拒否が汚染pathを言わない。** landへ渡す名前fileそのものが木を汚して詰まった。
   汚しているpathと次の一手を返す（`visibleStatus`はNUL区切りBufferなので、行として扱うと
   空文字が並ぶ点も直した）。

1・2・5がそろって直るまで、変換は**一度も受理されなかった**。3・4・6・7が無ければ、
なぜ受理されないのかを追う手段が無かった。

## cq-001 — 未決25件の一括裁定

[ADR 0142](../adr/0142-adjudicating-every-open-question.md)。3種類が混ざっていた。

- **既に裁定済みなのに印が無い** 7件（0132 OQ3/OQ4、0133 OQ1/OQ2、0137 OQ2、0139 OQ1/OQ2）
- **いま裁定できるのに保留** 6件（命名、改善量の下限、対の同一性、封じ込め境界、ref寿命、連鎖）
- **実データ待ち** 7件 → すべてに観測できる発火条件を書いた

同じ見た目で並ぶと放置と保留が区別できず、件数だけが残る。全件へ裁定を与え、各ADRへ書き戻した。

## cq-002 — seam commitの寿命

**自動では消さない。** refが指すのは五条件を通って受理された変換の実体であり、どの版がどの競合を
どう解いたかを辿れる唯一の資源である。証跡を寿命付きにするのは、記録を所有するという製品の
役目と衝突する。`listSeamRefs`で在庫を見せ、消すかは所有者の裁定に委ねる。

## cq-003 — 変換の連鎖

**前の変換を含むbaseの上でのみ確定できる。** 同じcandidateへ2回目が来た時、既存refが今回のbaseの
祖先を指していなければ拒む。黙って上書きすると1回目の証跡が消える。

## cq-004 — 未配線moduleの裁定

sensor索引で消費者ゼロを確認した上で裁定した。`bounded-seam.mjs`とRC1〜RC3の実験moduleは
**研究成果物であって製品ではない**。消さずに残すが、製品と区別する。

名前だけ中核に見えるものも出た。`boundary-compiler.mjs`（製品は`runtime-front-end`の
`compileRuntimePlanV1`）、`runtime-worktree-executor.mjs`（製品の隔離実行は`isolation-runner`）
など5本が、製品経路から一度も呼ばれていない。充足表の根拠へ研究moduleを挙げる事故は
以後gateが防ぐ。

## cq-005 — 未決に発火条件を必須にするgate

`npm run check:open-questions`。発火条件・移譲先・裁定先のどれも持たない未決を落とす。
初回17件が該当し、すべて解消。現在26件すべてがanchoredである。

## 残した保留（発火条件つき7件）

| 内容 | 発火条件 |
|---|---|
| task intent binding | 割り当てが実データで2件以上失敗したら |
| 複数の非劣位候補 | `multiple_incomparable_candidates`が1件出たら |
| 同名conflict resource | `exact_surface_evidence_missing`が同名衝突で1件出たら |
| affected空の既存path | 実データで1件出たら |
| 1 ToDoが複数path所有 | 実データで2件以上詰まったら |
| 共有面の粒度 | 独立な依存塊が2つ以上の実例が1件出たら |
| 他worktreeへの誤帰属 | wc-002と同根（holdで捨てた作業量の実測） |

## 未着手のまま残すもの

**scaffoldが創作境界に対応していない。** `todo independence witness scaffold`は、まだ存在しない
pathを所有するToDoの宣言を作れない（`affected_tests_unobserved`で断る）。ADR 0136の
`creates: true`は`run_request`と`witness_set`にはあるが、**下書き契約に無い**。この工程でも
cq-005の宣言を作れず、既存file 2件だけで進めた。2つの機能が組み合わさっていない。

## gate

- `npm test`: 1040 pass / 0 fail
- `npm run ci`: 完全green（sensor側 2192 pass / 37 skip 含む）
- `npm run check`: 126 files
- `npm run check:cli-surface`: 54 commands、未収載0・未確認0
- `npm run check:open-questions`: 26件すべてanchored
- `npm run check:reachability`: 製品79 module・宣言済み研究33 module
