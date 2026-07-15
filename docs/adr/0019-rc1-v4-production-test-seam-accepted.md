# ADR 0019: RC1 v4のproduction＋test seam機構をacceptする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v4` / RC1-J
- 対象Control: `lattice-rc1-closed-loop-v3` / `RC1-J-production-test-seam-v4`
- depends on: ADR 0016、ADR 0017、ADR 0018

## Context

RC1 v3のtransformはproduction concernを分離したが、future TODOが書き換えるshared test architectureを分離せず、変換後testを
挙動不変証拠にも使った。これではtest write conflictが測定から落ち、transformが期待値と実装を同時に変える自己証明も可能だった。

## Decision

- versioned oracle v2と`runRc1BlackBoxOracle`をtransform外behavior contractとしてacceptする。正常2件、validation failure 6件の
  return／throw contractをpre／postで同じexecutorから実行し、repo絶対pathを含まないdigest receiptへする。
- v4 seamはproductionをchannel／label／compositionへ、future TODO-owned testsを
  `channelPolicyContract`／`labelPolicyContract`へ分ける。shared composition testはpublic shapeとfrozen状態だけを持つstable
  contractとし、policy-specific expected valueの共同write先にしない。
- transformはfixed 6 pathsだけをdisposable detached worktreeで変更する。oracle inputとoracle executorはscope外であり、
  scope violation、oracle divergence、test seam欠落をtyped rejected artifactへする。
- accepted artifactにはbase SHA、control source bindings、fixed-input digest、binary patch、全changed-file content digest、fixed
  verifier receipt、pre／post oracle receipt、cleanup／canonical source invariantをbindする。
- oracleとsource bindingsはisolated execution前にsnapshotし、custom transformやcallerの共有参照から測定入力を変異できないようにする。
- accepted source／test identityとCodegraph結果は
  [RC1-J acceptance evidence](../evidence/2026-07-15-rc1-v4-production-test-seam-acceptance.md)へ固定する。

## Rejected alternatives

- **production seamだけをv4へ流用する:** future test write conflictが残り、parallel-readyを誤判定する。
- **shared testへconcern別期待値を残す:** 2 TODOの共同write先を隠したままになる。
- **変換後testsだけでbehavior preservationを判定する:** transformが実装と期待値を同時に変えられる。
- **missing test pathをverifier成功だけで受理する:** verifier実装差で存在しないexplicit pathが成功しても、fixed 6-path completenessが
  rejectする。
- **caller objectをそのままartifact sourceへ使う:** transform中の参照変異でfixed-input digestとartifact identityが乖離する。

## Consequences

- RC1-Kはこのrunnerのcanonical source invariantを既存ignored fileのcontent fingerprintまで拡張し、portable preimage bundleを作る。
- RC1-Lは実control artifactからsource bindingsを作り、このv4 transformを一度だけaccepted predecessorとして発行する。
- generated symbolsの存在と分離は、accepted patchを適用したworktreeのfresh Codegraph indexで再確認する。
- 本Decisionは変換機構のacceptであり、実campaign transform、treatment compile、H1-v4、Phase successを先取りしない。
- dotagents／Observer関連repoのwriter境界とremote／push／publish禁止は変えない。
