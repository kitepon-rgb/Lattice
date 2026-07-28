# seam 切断コストの観測・検証網・確実の門

工程状態の正本は Lattice store の `seam-cost` plan。本書は目的・思想・判断理由・非目標・
受入条件だけを所有する（2026-07-28 起票、オーナーと Fable の設計対話による裁定）。

## 目的

請求項7（直列化）/8（変換）の振り分けが `symbol|path なら code_seam` という enum 1行
（`src/todo-independence-contracts.mjs:69`）しかなく、**何を共有していて切るのがどれだけ
高いかを装置が見ていない**。同時に、共有 module 変数を見逃したまま変換が「成功」できる
検証の穴がある——これは実行者（装置/AI）に依存しない。

sensor は材料を既に持っている。「関数 → module 変数」の辺（`references` +
`metadata.valueRef=true`、実 DB に2620本）を Lattice は一度も引いていない。CLI が辺種別を
落としているだけで、相手ノードは `callees` に混ざって返っている。

## 思想（裁定済みの不変条件）

1. **装置は観測を記録する。振る舞いを採点しない。** 履歴採点（「このファイルは3回競合した」）は
   宣言の過大化・回避行動・過剰直列化を生む（呪い）。`detectNonConvergentConflicts` は事実を
   述べて止まるだけなので観測側。
2. **装置が出すのは数えられる事実だけ。閾値を持たせない。**「深さ2まで」を決めるのは方針と
   AI であって装置ではない（seam-proposal の Pareto 支配と同じ規律）。
3. **cost profile は投影であって記録ではない。** digest 済み artifact へ焼き込まない
   （ADR 0127 の independence.json と同じ線）。記録に残らないものは採点にも使えない。
4. **盲点は confidence で申告する。** 見えていないもの（未対応言語の write 情報、名前フィルタの
   死角）を黙って「共有なし」と言わない。
5. **新しい面は実 run の受入まで通して完成扱い。**「契約もコードも green test もあるのに
   一度も実行されていない経路」を12件直した教訓（2026-07-28）。
6. **網は檻にしない**（オーナー裁定）。検査は受入の一点だけ（完成した変換の成果物、隔離
   worktree 内、五条件と同じ場所）。過程を監視しない。失敗は理由と次の一手を返す**不認定**で
   あって拒否ではなく、再試行は安価、回数・失敗は誰にも記録されない。境界は予測であって
   制約ではない（ADR 0143/0144）の裁定を検証側でも守る。**網は賢いモデルを縛るのではなく
   解放する**——機械的な確認を装置が引き受けるから、AI は設計判断だけに知能を使える。

## 判断理由の要点

- **リファクタリングの主体は Lattice を操作する AI**（オーナー裁定）。装置は観測・契約・検証・
  記録を供給する。スクリプト変換は「確実の門」の内側だけ——**確実にできる内容だけ。
  チャレンジは駄目。怪しければ AI へ。巨大な多言語コードは書かない**（オーナー裁定）。
- **網が先、profile が後。** profile を出すと「内訳を見て AI が直す」経路が動き出す。網が無いと
  module 変数の移し忘れが黙って通る。静かな破壊は「直せない」のではなく「直す対象の再発見が
  高い」——検証者の偽陽性だけは、壊して直すループの前提そのものを壊す。
- **sensor の言語理解を活かす**（オーナー指示）。言語知識は `EXTRACTORS`（29言語の宣言的
  テーブル）と import 解決に集約済み。書き換え側が正規表現で再実装している部分を sensor 実データへ
  置き換え、「流れているのに読んでいない/捨てている」情報（辺種別・束縛区別・装飾行）を拾う。
- **read/write の区別は作る**（オーナー裁定: 処理は index 時の一瞬、AI に聞くより速い）。
  共有の重さは「読むだけ/片方が書く/両方書く」でほぼ決まる。

## 非目標

| やらないこと | 理由 |
|---|---|
| 履歴（競合再発回数・変更頻度）による判断 | 閾値の根拠が無い＝勘。構造は現在形で観測でき、履歴は既に無い状態の情報。採点は呪いになる |
| 耐久的な競合台帳 | 同上＋時間で変わる値を不変記録へ入れない |
| cost_profile の artifact 焼き込み（seam_proposal v3） | 投影を記録にしない（思想3） |
| 機械可読な refactoring policy | 「変換を厭わない」は AGENTS.md に一行書けば AI が従う |
| seam-proposal への閾値 | Pareto 支配・曖昧なら unknown は明示的な設計判断 |
| 多言語変換器の一括実装 | 1言語でも穴がある状態で広げると穴が言語数分になる。網→門→1言語ずつ |
| 関数内ブロック構造のグラフ化 | 局所変数ノード化はグラフ爆発（sensor が意図的に回避）。行数で代用 |
| 型依存の辺・decorator 束縛の強化 | 実 DB で0本/1本。必要になった時に再検討 |
| AI 変換の「限定性」検査 | 「共有 X を解消しろ」で無関係 file を触る AI はいない。git 巻き込みは pathspec 明示の運用規則 |
| `ImportMapping`（正規表現ベース）の再利用 | `[^}]+` 前提・8系統のみ・型 import を落とす。AST 由来で取り直す |

## 受入条件

- 網: 共有 module 変数 fixture（**focused test が当該経路を通らない**構成）で、変更前=五条件を
  通ってしまう／変更後=`behavior_equivalent` が落ちる、の**対照**。未解決参照は件数でなく
  **集合差分**（(file, reference_name)、変換が触った file に限定）。
- profile: 実 daemon での受入（integration test）。分類の組み合わせ別の単体。
- read/write: 読むだけ/書く fixture で分かれる。未対応言語は confidence 申告。
- フィルタ緩和: 前後でグラフサイズ・`sensor sync` 時間・DB サイズを実測して報告。
- 門: 閉じる各条件で typed 理由が返り、変換が実行されないこと。
- 回帰: `npm test` / `npm run check` / `npm run test:sensor` / `npm run ci`。
- 記録: CHANGELOG（receipt digest ドリフトは破壊的変更として明記）、ADR（装置は採点しない／
  profile は投影／装置と AI の分担と確実の門）。

## 工程

- [x] 検証網——変換の静かな破壊を捕まえる（実験でprimitiveを訂正: unresolved_refsでなく切断参照の計数。ADR 0145）
- [x] 親ディレクトリへの移動で import 指定子が壊れる bug を直す
- [x] sensor の callers/callees へ辺種別と valueRef を出す（--limit 200も。既定20件で実際に3件切られていた）
- [x] 切断コストの内訳を計算する seam-cost module を作る
- [x] seam profile コマンドを作る（plan/run の両モード・投影のみ）
- [x] valueRef へ read/write の区別を足す（TS/JS 先行。kernel経路は未配線でconfidence申告、ミラーはsc-007=要Rust toolchain）
- [ ] read/write の区別を go/python/java のミラーへ広げる
- [ ] sensor の名前フィルタを緩めて実測する
- [ ] import 束縛の区別（default/named/namespace）を保持する
- [ ] 装飾込みの開始行を出す
- [ ] 拡張子省略テーブルを export する
- [ ] 確実の門——ESM 変換の暗黙前提を明示的な事前条件にする
- [ ] 書き換えの土台を sensor 実データへ置き換える

## 主要な対象

- sensor: `bin/lattice-sensor.ts`（callers/callees の push 4箇所）、`extraction/tree-sitter.ts`
  （`:746` フィルタ、`:779-950` write 判定、`:3380` 束縛区別、`:5146` 装飾行）、kernel ミラー
  （tsjs→go/python/java）、`resolution/import-resolver.ts:22`（export）
- Lattice: `src/seam-cost.mjs`（新規）、`src/sensor-adapter.mjs:336`（`--limit`）、
  `src/seam-apply.mjs`（unresolved 差分・node フィールド読み増し）、`src/seam-verification.mjs`、
  `src/seam-rewrite.mjs`、`src/seam-derivation.mjs`、`src/runtime-cli.mjs`（`seam profile`）
