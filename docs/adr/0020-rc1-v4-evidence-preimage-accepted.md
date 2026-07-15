# ADR 0020: RC1 v4のevidence preimageとbounded source invariantをacceptする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v4` / RC1-K
- 対象Control: `lattice-rc1-closed-loop-v3` / `RC1-K-evidence-preimage-invariant-v4`
- depends on: ADR 0016、ADR 0017、ADR 0018、ADR 0019

## Context

RC1 v3はfresh Codegraph runのdigestだけを保存し、digestのpreimageとなるportable outcome本文を残さなかった。また、raw、
人間向けdiagnostic、plan identityへ使うportable projectionの責務が混在し、除外fieldをartifactから独立監査できなかった。
隔離runnerもHEADとgit statusは比較したが、既に存在するignored fileのcontent-only driftを検出できなかった。

## Decision

- 1 fresh runを`lattice.rc1.evidence_bundle.v1`へcompileし、次の3 componentを分離する。
  - raw opaque receipt: Codegraph CLIのstdout byte列そのものではなく、adapterが構造化したevidenceをcanonical JSON byte列へ固定し、
    base64、byte長、SHA-256を保存する。
  - sanitized diagnostic: rawから固定versionのallowlistだけを除外／置換し、実際に適用したJSON pointer operation、rules digest、
    payload digestを保存する。絶対pathまたはmanifest外のfield dropはfail closedにする。
  - portable preimage: 全query outcome本文、queryごとのdigest、aggregate digestを保存し、artifact本文だけからaggregateを再計算できる
    ようにする。
- validatorはopaque rawをdecodeし、query setとの順序／target bindingを確認したうえでdiagnosticとportableを再生成する。
  component側のdigestだけを書き換えてもrawから再構成した値と一致しなければrejectする。
- campaign gateは同じquery setを持つcontrol 2 run、treatment 2 runを必須とし、各condition内でportable preimageとsanitized
  diagnosticが再現することを要求する。実runの発行はRC1-Lが所有する。
- canonical source invariantはHEAD、git-visible status、ignored path status、`src/`と`test/`のrecursive content fingerprintを
  独立fieldで比較する。fingerprintはfile content、directory、missing、symlink target、special entryを型付きで扱い、symlinkを
  followしない。
- `runIsolatedTransform`は成功時にも`lattice.source_invariant_receipt.v1`を返し、失敗時は同receiptを
  `transformEvidence`へbindする。protected content driftをcleanup成功へ丸めない。
- accepted identityとgate結果は
  [RC1-K acceptance evidence](../evidence/2026-07-15-rc1-v4-evidence-preimage-acceptance.md)へ固定する。

## Rejected alternatives

- **v3 digest-only evidenceを継続する:** preimageがなく、query単位の再計算もfield dropの監査もできない。
- **raw telemetryをportable identityへ含める:** temp path、index時刻、DB byte数、node更新時刻がfresh run再現性を壊す。
- **未知fieldを汎用scrubberで落とす:** 将来のsemantic fieldまで黙って消せるため、固定allowlist以外は保持し、絶対pathならrunをrejectする。
- **sanitized payloadだけをrawと呼ぶ:** 除外前の証拠を失い、sanitization manifestを独立検証できない。
- **canonical repo全体をcontent fingerprintする:** `.codegraph`等のsensor stateは再indexで意図的に変わる。HEAD／statusを全repoへ、
  content fingerprintを保護対象の`src/`／`test/`へ適用して責務を分ける。

## Consequences

- RC1-Lはfresh control／treatment worktreeから2 runずつbundleを生成し、このcampaign gateを実データで通す。
- RC1-LはADR 0019のfinal transform receiptへ本Decisionのsource invariant receiptを明示的にbindする。K単独ではその統合を
  完了扱いしない。
- `src/`／`test/`外に既に存在するignored fileのcontent-only driftはfingerprint保証外である。新規／削除ignored pathはignored
  status、tracked／untracked driftはvisible statusで検出する。このbounded scopeをfull-repo content invariantとは呼ばない。
- raw opaque receiptはadapter evidenceの完全preimageであり、Codegraph processのoriginal stdout／stderr byte archiveではない。
- 本Decisionはevidence機構とrunner invariantのacceptであり、実4-run再現性、corrected comparison、H1-v4、Phase successを
  先取りしない。
- dotagents／Observer関連repoのwriter境界とremote／push／publish禁止は変えない。
