# ADR 0174 — v0.58.3の着手時構造コンテキストを受理する

日付: 2026-08-12
状態: Accepted

## Decision

`@quolu/lattice@0.58.3`を、工程着手時の構造コンテキスト自動供給を実運用へ届けた版として受理する。

- 構造が有効な工程では、`todo start`の返却だけで対象taskのcanonical planned構造を実装者へ渡す。
- 構造が未適用の工程は従来どおり着手可能で、未適用を機械可読に返す。
- graph対象taskは実装後に現HEADのrealizationを記録しない限り完了できない。
- plan終端は、全工程の実体を反映したfresh consistent finalizationなしには閉じられない。

## Acceptance basis

[公開証跡](../evidence/2026-08-12-v0.58.3-start-structure-context.md)に記録した完全CI、production audit、
pack、既定ブランチ祖先gate、npm公開、global install、bridge確認、Peertable実工程smokeを受入根拠とする。
Peertable smokeでは生の工程表を変更せず、独立clone上で`structure_context`とrealize次操作を確認した。

## Consequence

工程を担当するAIへ構造データを渡すための親の手作業は不要になる。AIが実装を終えた後の構造更新は
任意の報告ではなく、`todo done`およびplan終端の機械gateで強制される。
