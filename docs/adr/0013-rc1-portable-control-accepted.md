# ADR 0013: RC1 portable control-v2 artifactをacceptする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v3`
- 対象Control: `lattice-rc1-closed-loop-v3` / `RC1-D2-portable-control-v3`
- depends on: ADR 0009、ADR 0012

## Context

ADR 0012は旧control artifactのraw Codegraph outcome digestをRC1-F predecessorから失効した。D2はraw evidenceを捨てず、
artifact identityだけを`lattice.codegraph_portable_outcome.v1`へ切り替え、normal／shared-state negative controlを
同じcontrol baseから再compileする責務を持つ。

## Decision

- commit `d0ce60fbd3a06c23da14eaea387da29eb24d4d5d`の`portableCodegraphOutcome`とportable `graphRecords`をacceptする。
- `portableCodegraphOutcome`は入力を変異させず、statusの4 telemetry fieldとdirect Codegraph nodeの`updatedAt`だけを除く。
  その他の未知fieldは保持する。
- control base `d2d412800492fbed03febe02abc6dca81c09a88b`を2つのfresh worktreeでindexし、raw outcome digest不一致を
  隠さず、portable outcome digest一致とcompiled artifact全体のdeep equalityを受入条件とする。
- `research/campaigns/rc1/artifacts/control-v2/`のnormal／negative artifactと
  `lattice.rc1.control_compilation_evidence.v2`をactive control predecessorとしてacceptする。
- 旧`artifacts/control/`は削除／上書きせず歴史証拠として保持する。RC1-E2以降はcontrol-v2だけをadmitする。

## Accepted identity

- portable outcome集合: `a8a3f762471ec685095395fde0d852e60070f6240a031a07667e5d9621aaa35d`
- normal boundary manifest: `1aec1c9efc6baa19a6df9f82464ddb8069988f5165f049573811cc3de935a064`
- normal boundary verdict: `f7e4df5b94ea7f0cb9676670d312d7aaee5ef2881854610c3bb2de41557735bf`
- normal plan graph: `506052d82f68cd1041e7b3398687a2d539053dc55ffd63b5530ed9bdf5102110`
- negative boundary manifest: `01973acb35b4fef16f6af124b3f5adffa8c2cc8da0c355c76c0a2cbb6e6f7575`
- compilation evidence: `44cfd470e01e1e115c7f687271520483fbd3295d4b8ca2962a22b21129acb00e`

## Rejected alternatives

- **old control artifactをin-place更新する:** 過去Decisionのdigest参照を壊す。
- **raw telemetryを削除する:** 診断証拠と再現した不一致を失う。
- **portable outcome集合digestだけを確認する:** compilerのmanifest／verdict／plan全体に別の非決定性が残り得る。
- **一つのworktreeで同じcompile関数を二回呼ぶ:** path／fresh index差を通らず、再現した欠陥を検査できない。

## Consequences

- RC1-E2はcontrol-v2 artifact digest、projection ID、same baseを一つのpreconditionとして検証できる。
- boundary manifest schema shapeはv1を維持するが、`graph_evidence.result_digest`の意味はADR 0012のportable projectionに固定される。
- Codegraph 1.4.1より後のraw field追加はunknown fieldとして保持されるため、非決定的ならdeterminism gateでfailしprojection更新を要求する。
- Codegraph、dotagents、Observer関連repoのwriter境界は変更しない。
