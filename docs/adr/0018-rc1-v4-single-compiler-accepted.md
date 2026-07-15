# ADR 0018: RC1 v4のsingle boundary compiler機構をacceptする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v4` / RC1-I
- 対象Control: `lattice-rc1-closed-loop-v3` / `RC1-I-single-boundary-compiler-v4`
- depends on: ADR 0016、ADR 0017

## Context

RC1 v3はcontrolとtreatmentを別compilerで測り、future TODOが共同変更するtest writeもcontrol conflictへ含めなかった。
したがって観測されたwave減少をseam transformationへ識別できない。ADR 0017は、conditionを入力に持たない同一compiler、
production＋test candidate spec、fixed query set、完全success predicateを実装前のsafety netとして固定した。

## Decision

- `compileBoundaryCondition`をRC1 v4のcontrol／treatment共通測定入口としてacceptする。condition selectorは契約違反とする。
- active surfaceはfixed query receiptからだけ選ぶ。currentが全てexactでproposedが全てabsentならcurrent、currentとproposedが
  全てexactならproposed、それ以外はcurrent＋typed dynamic unknownとし、parallel-readyへ進めない。
- exact resolutionはsymbol nameまたはqualified nameとexpected pathの一致で判定する。receiptのID、operation、順序、targetも
  query setへ一致させ、空、fuzzy、stale、別target付替えを成功へ丸めない。
- TODOのproduction symbol／pathとfuture test symbol／pathを第一級write resourceにし、全TODOのpairwise intersectionから
  write conflictを導出する。manual state、effect、unknownはmanual provenanceを保ったまま同じmanifestへ合成する。
- `evaluateRc1Hypothesis`の15条件truth tableをv4 success predicateとしてacceptする。artifact内の自己申告resultは証拠に
  使わず、必須fieldのないv3 artifactはfail closedにする。
- accepted source／test identityとCodegraph再index結果は
  [RC1-I acceptance evidence](../evidence/2026-07-15-rc1-v4-single-compiler-acceptance.md)へ固定する。

## Rejected alternatives

- **control／treatment compilerをwrapperで共通名にする:** 内部のcondition別導出が残り、測定器交絡を解消しない。
- **condition selectorを受けて期待conflict数を返す:** independent variable以外も条件間で変わり、実験を非識別にする。
- **testをaffected testとしてだけ記録する:** TODO outcomeが同じassertionを書き換えるshared write conflictを見落とす。
- **非空queryをresolutionとみなす:** fuzzy resultやaffectedのself-only resultを実在surfaceへ誤分類する。
- **comparisonの`result` fieldを信頼する:** 欠落条件や壊れたpreimageがあってもsupportedを自己申告できる。

## Consequences

- RC1-Jはこのcompilerがexact解決するproduction＋test seamとtransform外black-box oracleを実装する。
- RC1-Kはcompilerへ渡したCodegraph payloadのportable preimage、sanitized diagnostic、source invariantを保存・検証する。
- RC1-Lは同じcompiler source digest、candidate spec、query set、manual evidence、capacityでfresh control／treatmentを再発行する。
- 本Decisionはsingle compiler機構のacceptであり、H1-v4、実transform、portable evidence、Phase successを先取りしない。
- dotagents／Observer関連repoのwriter境界とremote／push／publish禁止は変えない。
