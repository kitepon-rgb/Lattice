# ADR 0065 — runtime dogfoodで判明した終了理由と新規path bootstrapの補正

- Status: Accepted
- Date: 2026-07-22
- Supersedes: ADR 0060 Decision 7の`--reason <identifier>`制約

## Context

AIShellの実並行waveをLatticeでcompileした際、完了済みの旧runを明示abandonしようとすると、CLI helpは
`--reason <reason>`と案内する一方、実装はASCII識別子しか受理せず、人間が監査可能な終了理由を保存できなかった。
また、future TODOが新しい専用fileを所有する正しい分割でも、base snapshotにそのpathが存在しないためSensor証拠を
構成できず、`BOUNDARY_UNKNOWN`が匿名dynamic resourceだけを返して正規の次手を示さなかった。

## Decision

1. `run abandon --reason`は前後空白、Unicode Cc、line/paragraph separator、双方向表示制御を拒否しつつ、
   1〜256 Unicode文字の説明をexact保存する。CLIとmanaged control wireは同じvalidatorを使う。
   日本語、空白、句読点を受理し、resultと`run_closed` event、managed shutdownへ同じbytesを渡す。
2. 空文字、前後空白、改行その他の制御文字、256文字超過は`INVALID_ABANDON_REASON`でrun mutation前に拒否する。
3. Sensorで裏付けられないownershipは従来どおりdispatchableへ昇格しない。安全性のためmanual witnessだけで
   future pathの不存在や独立性を証明したことにしない。
4. `BOUNDARY_UNKNOWN`はcompiler由来unknownに加えて元の`unresolved_witnesses`を保持する。Sensor adapterの
   filesystem inspectionを経たaffected targetが`path_state: absent`を示した場合だけ`BOOTSTRAP_OWNERSHIP_SEAM`を返す。
   既存path、symbol、query未束縛では
   `ACQUIRE_OWNERSHIP_EVIDENCE`を返し、不要なbase commitを促さない。

## Consequences

- stale runの退役理由が監査可能になり、CLI helpと実受理集合が一致する。
- 新規fileを理由に安全判定を緩めず、seam splitを明示的なbase変更として証拠化できる。
- Latticeが将来atomicなnew-path reservationを所有するまでは、base commitへの空seam追加が正規bootstrapである。
