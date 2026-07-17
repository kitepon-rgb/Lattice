# 0048 — Stage 0真値の訂正と真値判定方法論の固定

- Status: Accepted / Immutable
- Date: 2026-07-17
- 訂正対象: [ADR 0047](0047-codegraph-absorption-and-sensor-ownership.md)（裁定は不変・根拠数値を訂正）、
  [Stage 0 evidence](../evidence/2026-07-17-rc4-stage0-witness-cost.md)
- 根拠: 2026-07-17 HEAD実ビルド再測定（dotagents統括セッション）

## Context

ADR 0047の根拠数値に、測定者（統括AI）の2つの誤りが含まれていた。吸収裁定そのものは
オーナー意志決定であり不変だが、訂正後の数値は**L2改良の受入オラクル**（「真値とexact一致」）に
使われるため、誤ったまま残すと修理後のsensorを間違った的で採点することになる。

## 誤り1: 「upstreamは3ヶ月停止」は虚偽

ADR 0047は代案却下理由に「upstreamは3ヶ月停止（最終commit 2026-04-30）」と記した。
実際は star 60,508・2026-07-17当日もcommitされている現役repo（`gh api`で確認。
v1.4.1 = tag `ecc8b30` 2026-07-10、HEAD `04ab45c` 2026-07-17、39 commits ahead）。
測定者がfork時点のattribution commit `841beea` を最終commitと誤読した。

- 却下理由3本のうちこの1本は崩れる。ただし残り2本（depth表現は機能しない／契約緩和は
  中核主張を殺す）で却下は立ち、吸収裁定に影響しない。
- 帰結の変更: 「停止repoの吸収」ではなく**活発なupstreamを持つrepoの吸収**であり、
  追従コスト（upstream改善の取り込み判断）は0047の想定より重い。

## 誤り2: 真値4件は過少（正しくは7件）

`affected`はREADME定義で推移的import依存である。初回測定は**直接importだけ**を数え、
推移経路を持つ3件を「偽陽性」と誤分類した。

`lib/orchestrate/control-record.mjs`の訂正後真値（7件・全件grep実証）:

| test | 実経路 |
|---|---|
| control-record.test.mjs | `loadControl()`＝helpers経由の動的import |
| executor-contracts.test.mjs | 直接import |
| placement-policy.test.mjs | 直接import |
| worker-report-skeleton.test.mjs | `loadControl()`＝動的import |
| rate-selector.test.mjs | → rate-selector.mjs →（静的import）control-record |
| quota-snapshot.test.mjs | → quota-snapshot.mjs → control-record |
| quota-adapter.test.mjs | → quota-adapter.mjs → quota-snapshot.mjs → control-record |

訂正後の測定表:

| 情報源 | 件数 | 内訳 |
|---|---|---|
| 真値（推移的import閉包・動的import込み） | **7** | 上表 |
| Codegraph depth=1 | 3 | 真陽性3・**偽陰性4** |
| Codegraph depth=5（既定） | 12 | 真陽性6・**偽陽性6**（factory系・経路実在せず）・**偽陰性1** |

「真値を返すdepthが存在しない」（0047 Context）は訂正後も成立する。

## 誤り2の下で見えた真の機序（HEAD実ビルド再測定）

2026-07-17、upstream HEAD `04ab45c` をソースからビルド（wasm経路・vendored Node 24）し、
同一clone（dotagents `73947b3`）で再測定した。**v1.4.1とHEADの出力は1件の差もなく同一**。
CHANGELOG Unreleased #1230（literal receiver偽陽性修正）は本欠陥と無関係。

index DBの辺を直接検査した結果:

- `control-record.test.mjs → control-record.mjs` の辺は **`imports` 0本・`calls` 8本**で、
  8本すべてが `reject` という名前への呼び出し辺だった。すなわちdepth=1の「正解」は
  import追跡ではなく**名前一致フォールバックの偶然**による。
- `worker-report-skeleton.test.mjs → control-record.mjs` の辺は**0本**（偶然一致する名前が
  無かっただけ）。
- 機序は3点: (1) `resolution/index.ts` Strategy 3がimport解決失敗時に無条件で
  プロジェクト全体の名前一致へフォールバックし、経路の実在を検証しない
  (2) 計算したconfidence（0.4〜0.95）を`edges`スキーマが持たず永続化前に破棄、下流の
  affected算出が低信頼辺を同格に扱う (3) JS/TSのextractionに動的import/require処理が
  存在しない（`import_statement`のみ。Lua/R/Rubyには実装がある）。

## Decision

1. 真値の判定方法論を固定する。**真値＝対象moduleへの推移的import閉包に属するtest file。
   経路の各辺は (i) 静的import文 (ii) 定数畳み込みで解決可能な動的import
   （`import(join(定数...))`）のいずれかで、grepによる実在検証を伴う。**
   名前の偶然一致・spawn経由の結合は真値に含めない（後者はL2改良(c)の対象として別掲）。
2. L2改良の受入オラクルは本ADRの訂正後真値（7件）を使う。0047 Decision 4の
   「Stage 0で確立した真値」は本ADRの定義へ読み替える。
3. 0047の裁定本文（吸収・自前所有・MIT notice維持・改良優先順(a)(b)(c)）は変更しない。
   改良(a)の対象は「存在しないimport経路の辺」から**「経路実在を検証しない名前一致
   フォールバックと、confidenceの非永続化」**へ具体化する。
4. upstream活発の事実を受け、fork後のupstream追従は「取り込まない」を既定にせず、
   吸収実装時に追従方針（cherry-pick基準）を明文化する。

## Consequences

- 測定者の教訓として記録する: 真値の定義（推移的か直接か）を測定前に固定しなかったことが
  誤分類の根因。受入オラクルに使う数値は、定義→測定→独立検証の順を崩さない。
- Stage 0 evidenceには本ADRを指す訂正注記を追記する（本文は履歴として保持）。
