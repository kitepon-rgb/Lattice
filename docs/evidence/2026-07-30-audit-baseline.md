# 監査していない歴史を正直に閉じる — 完了報告

- 工程: Lattice store の `audit-baseline`（6 ToDo・2 Phase）
- 版: **0.37.0**
- 正典: [ADR 0148](../adr/0148-history-closes-unaudited-not-audited.md)・[計画](../plan_audit-baseline.md)

## 直した欠陥

0.36.0 の終端監査 gate（[ADR 0147](../adr/0147-audit-is-on-by-default.md)）は、**過去に終わった工程まで
「監査待ち」にしてしまった。** 過去は監査できない——監査対象のコードが既に変化しているため、監査を
要求すると「今のコードを見て問題があると言い出す（実際には後の意図的な変更）」か「中身を見ずに
`accept` を押す」のどちらかを誘発する。どちらも gate が原因の事故になる。

0.36.1 は公開済みで、アップグレードした利用者に影響していた（実測: Lattice 自身 23 plan / 104 ToDo、
ServerManager 1 plan / 26 ToDo）。何が起きたかも、何をすればよいかも画面に出ていなかった。

## 実施

| ToDo | 実施 | 検証 |
|---|---|---|
| ab-001 `closed_unaudited` 状態 | 実施 | `accepted` へ化けない（解錠は厳密一致）／抜け道2件を塞ぎ test で固定 |
| ab-002 一括入口 `phase baseline` | 実施 | 対象選定・`--except`・既 accept を書き換えないこと |
| ab-003 画面での案内 | 実施 | 原因（0.36.0 の gate が過去へ及んだ）と2択のコマンドを guidance へ |
| ab-004 docs | 実施 | CHANGELOG 冒頭へアップグレード注意、公開契約・README 英日 |
| ab-005 release | 実施 | ci 1182 green → push → publish → install → daemon → 公開後 smoke |
| ab-006 適用 | 実施 | 下記 |

**スキップ: なし。**

## 適用の結果（公開版 0.37.0 で実施）

- Lattice 自身: **23 plan へ基準線を適用**（applied 23 / excluded 0 / not_applicable 8 / failed 0）。
  既に accept 済みの Phase は `already_accepted` として書き換えていない
- 工程図の fold: **53 → 164 件**。監査待ちの札が外れ、過去の完了分が畳まれた
- 最終状態: 監査待ち **0**、監査なしで閉じた **23**、監査済み **6**
- **ServerManager の 26 ToDo は監査対象として残した**。最終 done が 2026-07-29 でコードも生きており、
  基準線で流すのは誤りである（`--except` を設けた理由そのもの）

## 重監査が捕まえたこと

**機構だけあって test が無い箇所を1件検出し、差し戻した。** worker が自ら見つけて塞いだ抜け道
「`closed_unaudited` の後に task だけ無警告で reopen できる」は、実装を故意に壊しても test が落ちない
状態だった（もう1件の「`phase_reopen` の対象解決」は落ちた）。test を追加させ、私自身も同じ壊し方を
再現して 7 pass/1 fail で落ち、戻して 8/8 になることを確認した。**機構があって守りが無い状態は、
この戦役が塞ごうとしている失敗そのものである。**

## 途中で踏んだ自分の欠陥

plan 文書（68 行）を超える `narrative_ref`（#L69・#L70）を extraction へ書いていた。`todo migrate` は
通ったが `todo gantt` が `narrative_line_missing` で拒否した。文書へ「適用の方針」節を足して参照行を
実在させて解消した。**migrate が受理して gantt が拒否する非対称**は、起票条件つきで記録する価値がある
（同じ anchor 検査を migrate 側でも掛けるか、gantt 側の検査時点を明示するか）。

## 請求項との関係

工程 store の gate であり請求項本文には触れない。`closed_unaudited` は ToDo の dispatch 可否へ影響せず
（`next_ready` / `active_set` / `dispatch_frontier` は不変・test で固定）、請求項1の並行実行制御を
弱めない。

## 検証

- `npm run ci` 全段 green（product 1182 test・sensor・CLI 表面 59 command・store verify）。
  一度 1 件 fail したが孤児 daemon による並列干渉で、掃除後の再実行は clean
- 公開後 smoke（global install 0.37.0）: `phase status` の guidance、`phase baseline` の対象選定、
  `close-unaudited` の help、bridge 200、dashboard health 0.37.0
