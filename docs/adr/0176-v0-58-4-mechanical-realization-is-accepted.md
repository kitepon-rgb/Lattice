# ADR 0176 — v0.58.4の構造実体記録機械化を受理する

日付: 2026-08-12
状態: Accepted

## Decision

`@quolu/lattice@0.58.4`を、工程実装後の構造実体記録から定型作業を除去した版として受理する。

- 計画どおりなら、実装者は`--planned`を宣言するだけでよい。
- 計画と異なるなら、実装者は`--realized`へ実際のtransformだけを渡す。
- identity、digest、HEAD、commit解決、chain metadata、actor、timestampはLatticeが生成する。
- 実装者が判断するのは実体構造とcommit帰属だけであり、判断そのものは機械へ移さない。
- 従来のfull envelope入力は、import／replay／互換経路として維持する。

## Acceptance basis

[公開証跡](../evidence/2026-08-12-v0.58.4-mechanical-realization.md)に記録したfocused test、Real Git／Sensor E2E、
完全CI、production audit、pack、既定ブランチ祖先gate、npm公開、global install、bridge確認を受入根拠とする。

## Consequence

工程着手時の構造供給から、実装後のrealization生成、完了時のfreshness gateまでが一続きになる。
AIは製品の実体を判断して申告し、Latticeは再現可能な定型envelopeを生成・検証する。AIが介入しなくてよい
転記・digest計算・git ref解決は、今後の通常運用から外れる。
