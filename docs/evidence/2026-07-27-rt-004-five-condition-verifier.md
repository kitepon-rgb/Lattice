# rt-004: 五条件の検証器を実装し、3条件を実データで測った

- 日付: 2026-07-27
- plan: `real-transform` / task `rt-004`
- 契約: [ADR 0138](../adr/0138-transform-acceptance-five-conditions.md)

## 作ったもの

`src/seam-verification.mjs`。五条件を判定する。実行を伴う観測（focused test、再index）は
呼び出し側が行い、ここは観測から判定だけを作る。

| 関数 | 役割 |
|---|---|
| `readExportSurface(text)` | moduleが外へ出している名前を読む |
| `compareExportSurface({before, after})` | 原pathの公開面が保たれたか。**欠落だけ**を違反とする |
| `buildPostTransformWitnessSet(...)` | 変換後の宣言。所有面を指すよう写し、中身は変えない |
| `measureWaveCount(...)` | 既存の`compileSchedulabilityGraphV2`で最小実行段階数を測る |
| `evaluateSeamVerification(...)` | 五条件を判定し、欠けた条件を名指しする |

### 外部挙動同等性の基準を決めた（ADR 0137 Open question 2）

**原pathの公開面（export名の集合）が欠けないこと**とする。

分割で外部の消費者が影響を受けるかは、原pathが同じ名前を出し続けるかで決まる。原pathを
importしている側は、名前が保たれる限り一行も変わらない（ADR 0137 Decision 3）。名前が増える分は
既存の消費者に影響しないので、**欠落だけ**を違反とする。

これはfocused test通過とは別の条件である。testが触れていない公開名が消えても、testは通ってしまう。

### 波数は既存のschedulerで測る

独自の近似を持たない。変換前後を同じ規則で測らないと、「改善した」という主張が測り方の差で出る。

### 測れなかったことを「満たした」へ丸めない

波数が測れなければ`parallelism_improved:waves_unknown`、競合対を数えられなければ
`overlap_reduced:pair_count_unknown`で棄却する。観測の欠落は成功ではない。

## 実データでの測定（`tio-008`×`tio-009`）

rt-003の変換結果に対して測った。

| 条件 | 結果 |
|---|---|
| `behavior_equivalent` | **保たれた**。`TODO_GANTT_HTML_MAX_BYTES`／`TODO_GANTT_PROSE_MAX_BYTES`／`TODO_GANTT_RENDERER_VERSION`／`TodoGanttRenderError`／`renderTodoGanttHtml`の5つが残余に全部残る |
| `focused_tests_passed` | **通った**（rt-003、6ファイル73件） |
| `parallelism_improved` | **2波 → 1波**。容量4で、競合が消えれば2 taskが同時に走る |
| `sensor_fresh` | 未測定。変換後worktreeでの再indexが要る |
| `overlap_reduced` | 未測定。変換後worktreeでの再compileが要る |

## 検証

- `node --test test/seam-verification.test.mjs` — 7 pass。五条件の充足、1つ欠けたときの名指し、
  観測欠落を満たしたへ丸めないこと、公開面の欠落だけを違反とすること、波数を同じ規則で測ること、
  変換後witnessが宣言の中身を発明しないこと、観測できていないaffected testを空配列へ丸めないこと。
- `npm test` — 985 pass / 0 fail。

## この記録が主張しないこと

- 五条件のうち2つは測っていない。`sensor_fresh`と`overlap_reduced`は変換後worktreeで
  sensorとcompileを走らせる必要があり、その配線は`rt-005`が持つ。
- したがって**この変換はまだ採用されていない**。3条件が通ったことは、5条件が通ることの証拠ではない。
- 本ツリーへの着地はしていない。
