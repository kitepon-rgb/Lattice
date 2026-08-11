# ADR 0172 — todo startは対象taskの構造コンテキストを返す

日付: 2026-08-12
状態: Accepted

## Decision

構造機能が有効なplanの`lattice todo start`は、着手したtaskのcanonical planned構造と
structure set identity、compile freshness、次の構造操作を同じmutation resultへ含める。

- 実装者が別コマンドやsource file探索を行うことを前提にしない。
- 未適用planは従来どおりstartでき、構造未適用を機械可読に明示する。
- planned sourceは履歴として保持し、実体との差分はappend-only realizationへ記録する。
- graph対象taskはfresh realizationなしにdoneへ遷移できず、plan終端はfresh consistent finalizationなしに閉じられない既存gateを維持する。

## 根拠

構造データの保存と検査だけでは、作業を行うAIの入力にならない。AIは装置の一部であり、
正規の着手操作が、その工程を実装するための構造契約を直接返す必要がある。一方、計画値を完成形で
上書きすると計画と実現の差分を失うため、完成形はrealizationとして追記し、最終compileで照合する。

