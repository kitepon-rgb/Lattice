# seam提案生成（プラン時・read-only）

Latticeを「conflictを見つけて直列化する検出器」から、「どこで切れば並列化できるかを提示する
compiler」へ進める工程群。実変換（隔離worktreeでの実行）と実行時hold→`seam_split`配線は本planの
非目標であり、後続campaignが持つ。

工程状態の正本はLattice storeの`seam-proposal` plan。本書は目的・思想・非目標・受入条件・罠を持つ。

## なぜ今これか

[PLAN.md](../PLAN.md)の五層のうち第4層「Seam transformer」だけが未着地で、製品の中心的主張
（`seam-candidate → code transform → re-analyze → new plan version`）が実物になっていない。
[AGENTS.md](../AGENTS.md)も「Latticeをread-only推薦器で完了扱いしない」と明記している。

本planはその閉ループの**入口**だけを作る。実変換に賭ける前に、提案の品質を実データで人が裁定
できる状態にするのが目的である。read-onlyなので失敗してもstoreを壊さない。

## 着手時点の現状（棚卸しで確定した事実・以降の工程で解消済み）

- `lattice todo independence`はconflictを検出し、`severabilityOfConflictKind`で
  `symbol|path → code_seam`、それ以外 → `serial`まで分類する。判断材料はconflict kindの一点だけで、
  caller/callee/impact/source rangeは一切見ていない。
- **conflict artifactは実targetを保持していない。** `todo_independence.v2.conflicts[]`は
  `{task_ids, resource_id, kind}`だけで、`resource_id`はruntime front-endが作った`own-path-<hash>`。
  どのsymbol・どのpathが衝突したかは復元できない。ここが提案生成の最初の欠落である。
- 実変換の隔離実行系（`runIsolatedTransform`、patch生成、verifier receipt、cleanup後の
  canonical fingerprint検査）は実在し、RC1/RC2で通っている。ただし切断点・新symbol・新path・
  test分割はすべてfixture固有のhard-codeで、汎用の候補生成器は存在しない。
- `bounded-seam.mjs`は汎用runnerの外形を持つが、production呼び出し元がゼロ（testのみ）。
  `behavior_equivalent`等はrunnerの再計算ではなくcaller assertionである。

## 非目標（本planではやらない）

- 隔離worktreeでの**実変換**の実行。提案までで止める。
- 実行時conflict（`observed_write_conflict`）→hold→`seam_split`のtodoレーン配線。
- `todo start`のdispatch拒否gate化（ADR 0063改訂）。判定運用の実績が先。
- witness宣言の自動生成（`witness suggest`）。採用摩擦の低減は別枠。
- `bounded-seam.mjs`のcaller assertion問題の解消。実変換campaignが所有する。

## 受入条件

1. conflictから**exact target**（symbol名またはrepo path）が機械可読に取れる。
2. 提案artifactが、変更前後のsurfaceと所有者・残余conflict・sensor証拠・未知を1つの
   versioned artifactとして持つ。切断の**手順**は正本にしない。
3. 提案後ownershipへ**compilerと同一の競合規則**を適用して検証する。残余が0にならない候補は出さない。
4. read-only CLI入口から提案が読め、工程表（Gantt）にも現れる。
5. このrepo自身の実conflictで提案を出し、人が3秒で妥当性を判断できるサマリが出る。
6. 不変DecisionがADRに記録され、公開契約の記述が実装と一致する。

## 既知の罠

- sensorのsymbol lookupは存在しない名前を近いsymbolへfuzzy解決する。返却symbol名とpathのexact一致を
  照合し、不一致・空結果はunknown／absentとして提案を棄却する（AGENTS.md所定）。
- `boundary_verdict.v1`はToDoをちょうど2件に制限しており、最大256件を扱うTODO independenceと
  契約差がある。既存schemaへ無理に相乗りしない。
- `todo_independence`のschema versionを上げる変更は公開契約の変更である。docs/schemasと
  公開契約の記述を同じ受入単位で揃える。
- 公開契約は現在independence artifactを`v1`と書いているが実装とADR 0128は`v2`。この既存driftを
  本planの記述更新へ含める。
- 提案は構造証拠であり、semantic independenceやbehavior preservationの証明ではない。
  artifactにその限界を明記する。

## 工程

工程の状態・依存・完了証拠はLattice storeの`seam-proposal` planが正本。以下は対応表である。

- [x] conflict artifactへexact targetを復元する
- [x] seam proposal artifactの契約とschemaを定義する
- [x] conflict targetからsensor query setを決定的に構成する
- [x] cut候補を列挙し仮想ownershipの再compileで選別する
- [x] read-onlyのCLI入口から提案を投影する
- [x] 工程表（Gantt）へ提案を表示する
- [x] このrepoの実conflictで提案を出し裁定用サマリを作る
- [x] 不変DecisionをADRへ記録し公開契約の記述を実装へ揃える

## 導線

- 製品思想: [PLAN.md](../PLAN.md)
- 公開契約: [docs/00_product-contract.md](00_product-contract.md)
- 直近の前提: ADR 0127（witness宣言とcompile）、ADR 0128（着手時advisoryとseverability）、
  ADR 0129（工程表への独立性投影）
