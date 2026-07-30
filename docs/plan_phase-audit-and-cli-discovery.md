# 重監査を飛ばせない工程管理と、authoring CLI の発見可能性 — 統括 plan

**工程正本は Lattice store（`lattice todo status --json`、plan_key `phase-audit-and-cli-discovery`）。**
本書は目的・思想・判断理由・非目標・受入条件を所有する。
下部の ToDo は store への移転用 source であり、移転完了後に本書から削除する。

## 目的

Lattice を「重監査を**飛ばせない**工程管理」にする。あわせて、2026-07-29 の実運用で
起票済みの authoring CLI の発見可能性 4 件を実装する。

## なぜ今か — 実際に飛ばされた

2026-07-29〜30、ServerManager の戦役 `parent-child-repair`（26 ToDo）が
**一度も重監査を通らずに完走した**。実行者（AI）の落ち度だが、Lattice 側にも
それを許す構造があった:

1. **extraction v2 で作った plan は phase を持たない。** Phase gate（`phase review` →
   evidence を束縛した `phase accept`）が存在しない状態で全 ToDo を軽量確認だけで
   閉じられ、**どの時点でも警告が出ない**
2. **後から救済できない。** 全 task done の plan に Phase を被せる `revise-phase` は
   `state_policy: carry` が必要だが、carry は Phase 割当ての獲得を
   `carry_semantics_changed` として拒否する。`reset_pending` にすると done が消える。
   **「工程は終わったが監査だけ後から積む」経路が存在しない**
3. オーナー規範は「**Phase ごとに重監査。Phase の定義がない小さい plan なら最後にやる**」。
   Lattice はこの既定をどこにも表現していない

直列化と同じ構図である——`all_ready_parallel_by_default` は規則として書かれていたが、
AI が読み飛ばして直列化した。0.35.0 で機構（突き返し gate）にした。
重監査も同じで、**規則を書くだけでは飛ばされる。機構で守る。**

## 思想

**監査の既定は「有り」。無しは明示の宣言が要る。**

- phase を持つ plan → 各 Phase の `accept` が evidence 束縛の重監査（現行のまま）
- **phase を持たない plan → 終端に重監査が自動で要る。** 全 task done は「完走」ではなく
  「監査待ち」であり、終端監査の記録が積まれるまで plan は閉じない
- 監査の中身（何を検証するか）は host / 人間の裁量。Lattice が持つのは
  **「監査の記録なしに閉じたことにさせない」という gate だけ**

**救済経路を用意する。** 誤って phase 無しで作ってしまった plan・途中で方針が変わった plan が、
実行状態を失わずに Phase gate を獲得できること。gate は「作り直せ」を強制しない。

## 判断理由

| 論点 | 判断 | 理由 |
|---|---|---|
| 終端監査を新概念にするか、Phase の特例にするか | **Phase の特例にする** | phase 無し plan の終端監査は「全 task を含む暗黙の単一 Phase の accept」と同型。既存の review → accept / evidence slot / journal event をそのまま使い、新しい状態機械を増やさない |
| 作成時に phase 無しを拒否するか | **拒否しない（通知に留める）** | 小さい plan で phase を強制すると authoring が重くなり、Markdown へ逃げる誘因になる。「最後に重監査」が担保されるなら phase 無しは正当な形 |
| done を保つ Phase 獲得を carry の緩和でやるか、専用 policy でやるか | **専用 policy（例 `acquire_phase`）** | carry の「意味論が変わっていないことの保証」は緩めない。「Phase の獲得**だけ**を許し、他の変化は従来どおり拒否する」を独立の policy として型で表現する |
| 4 つの CLI 改善を同じ plan に含めるか | **含める** | どれも 2026-07-29 の同じ実運用で踏んだ不足で、起票済み（docs/plan_backlog.md）。別 plan に散らすと backlog が腐る |

## 非目標

- **監査の中身を Lattice が採点しない。** evidence の妥当性判断は host / 人間の裁量のまま
- **既存の phase 付き plan の挙動を変えない。** 終端監査は phase 無し plan だけに掛かる
- **store の canonical 形式・digest 計算を変えない。** journal event の追加は既存の
  event 型の範囲で設計する（必要なら ADR で判断を残す）
- **特許請求項（Patent/Lattice、12 項凍結）を逸脱しない。** 本 plan は工程 store の
  gate と CLI の案内の改善であり、請求項本文には触れない

## 受入条件

1. **phase 無し plan は、終端監査の記録なしに「閉じた」状態にならない。**
   全 task done の後、監査を経ずに済ませる経路が無いことをテストで固定する
2. **`plan create` / `todo migrate` が phase 無し plan の作成時に、終端監査が要ることを
   結果へ明示する**（作成は拒否しない）
3. **done を保ったまま Phase を獲得できる**。専用 policy で `revise-phase` が通り、
   実行状態（done / in-progress）が失われないことをテストで固定する
4. CLI 4 件: `plan create --schema` の既定が最新版 / revise 系と migrate に `--schema --json` /
   スキーマ違反の detail に違反フィールド名 / `lattice plan show <key>`
5. `npm test` 全 green
6. **release まで届く**: docs / CHANGELOG 更新 → commit → push → npm publish →
   npm install → 公開後 smoke
7. **本 plan 自身が Phase gate 付きで運用される**（migrate 後に revise-phase で Phase を
   被せ、各 Phase を evidence 束縛の accept で閉じる）

## ToDo（Lattice store への移転用 source）

### 終端重監査の機構

- [ ] 終端監査 gate と Phase 獲得 policy の設計を ADR に記録する（何が閉じを止めるか・acquire_phase の意味論・作成時通知の形）
- [ ] phase 無し plan の終端重監査 gate を実装する（全 task done でも監査記録なしでは閉じない・作成時に明示・テスト込み）

### done を保つ Phase 獲得

- [ ] revise-phase に Phase 獲得専用の state_policy を実装する（実行状態を保持・他の意味論変化は従来どおり拒否・テスト込み）

### authoring CLI の発見可能性

- [ ] plan create --schema --json の既定を最新版にする（または非最新である旨を出力へ含める・テスト込み）
- [ ] revise / revise-set / revise-phase / migrate に --schema --json を実装する（テスト込み）
- [ ] スキーマ違反エラーの detail に違反フィールド名と位置を載せる（テスト込み）
- [ ] lattice plan show を実装し、bindings が空を返すことでの誤読を解消する（テスト込み）

### 閉じ

- [ ] docs（製品契約・README・CHANGELOG）を実装へ揃える
- [ ] npm test 全 green を確認し、version bump → push → npm publish → npm install → 公開後 smoke まで通す
- [ ] オーナーへ最終報告（実施 / スキップ理由 / 検証結果）
