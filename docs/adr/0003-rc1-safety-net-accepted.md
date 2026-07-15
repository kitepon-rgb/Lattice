# ADR 0003: RC1 fixture safety netをaccepted predecessorにする

- 状態: Accepted
- 日付: 2026-07-15
- 対象Task: `RC1-S-safety-net-v2`
- accepted commit: `dffd5261497dc916cd5801a7d0ed6a613a6b8421`

## Context

Research Campaign 1のproduct implementationより先に、Lattice所有のmonolithic fixture、現挙動を固定する
characterization、通常／negative manual evidence、固定query setをaccepted artifactとして確定する必要がある。
これが変動するとcontrol／treatment比較を識別できない。

## Evidence

- source編集前のCodegraphは5 files、23 nodes、57 edges、pending 0。planned symbolは未収載であり、
  `new_surface_unknown`として記録した。
- testをfixtureより先に置き、focused gateが`ERR_MODULE_NOT_FOUND`でredになることを確認した。
- monolithic `buildDispatchRecord`追加後、focused characterizationは3 pass、0 fail、0 skipped。
- `npm run check`は新規fixture／testを含めて成功した。
- Codegraph post indexは7 files、35 nodes、85 edges、pending 0。callerはcharacterization test、calleeはvalidation helper、
  impact／affected testは同testを返した。planned seam symbol二つは未存在のままである。
- 初稿TODO outcomeがseam抽出後もcomposition validationを変更する欠陥を監査で検出し、既存入力だけを変更する
  `routine→batch`とlabel separator変更へ修正した。
- negative controlは通常条件とstate write以外が一致することをtestで固定した。

詳細証拠は[fixture boundary preflight](../evidence/2026-07-15-rc1-fixture-boundary-preflight.md)を参照する。

## Decision

commit `dffd526`のfixture、characterization、plan input、manual evidence、query setをRC1-A／B／Cのaccepted
predecessorとして採用する。後続はこれらの意味を黙って変更せず、変更が必要なら新plan versionと新Decisionを作る。

このDecisionはfixtureが`parallel_ready`であることを宣言しない。control boundary manifest、typed conflict、
manual state／effect、negative controlをRC1-Dでcompileするまで、schedulability verdictは未確定である。

## Consequences

- RC1-A／B／Cは固定fixture artifactを共通入力にし、非交差write scopeで開始できる。
- behavior matrix、TODO outcome、manual evidence、query setを変更した結果は同じ実験runとして比較しない。
- fixture固有の成功を汎用transform classや一般的速度改善へ外挿しない。
