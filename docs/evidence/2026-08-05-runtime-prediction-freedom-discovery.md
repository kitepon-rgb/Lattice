# runtime prediction freedom discovery

- Date: 2026-08-05 JST
- Scope: `runtime-prediction-freedom`
- Patent canonical: `/Users/kite/Developer/Patent/Lattice/出願書類/03_特許請求の範囲案.md`

## 確認済みの実装差

1. `src/witness-scaffold.mjs`と`src/runtime-front-end.mjs`が、`creates: true`、fresh absent、exact owned path、
   affected exact evidenceを新規fileのcompile/dispatch gateにしている。一般executor自体はpath allowlistで編集を拒否していない。
2. `src/runtime-engine.mjs`のlegacy classifierは、単独`undeclared_write`も`conflict_found`とfreezeへ運ぶ。
   managed runtimeのI/O sentinel側はADR 0144どおり単独prediction excessを記録だけにしている。
3. `src/seam-verification.mjs`はwave計測へ常に`precedences: []`を渡し、`src/seam-apply.mjs`もcanonical topologyを渡さない。
   scheduler本体のprecedence制約は既に正しい。
4. `src/runtime-managed-supervisor.mjs`のconflict holdは`barrierAll()`を呼び、論理上のhold/continue集合を決める前に
   全running workerを停止する。global epoch/gate/receipt lookupがこの全体停止を前提にしている。
5. `src/runtime-cli.mjs`のmanaged terminal経路はreceiptを記録・裁定するが、受理前の独立final worktree diffを
   conflict classifierへ流していない。sentinelが無効または取りこぼした場合、terminalだけで判明する競合を失う。

## 特許との固定対応

- 請求項9: 実変更範囲の観測、変更影響範囲外または他の実行中作業との重複による実行時競合。
- 請求項10: 影響を受ける対象作業群を特定し、その作業だけを停止・再計画。
- `writes`予測外と請求項9の変更影響範囲外を同一視しない。raw prediction excessは許可違反にしない。
- actual writeは、同時稼働作業の予測writeだけでなく予測read、および実行時間が重なったactual writeとも照合する。

## 裁定

実装範囲はADR 0158と`docs/plan_runtime_prediction_freedom.md`の4改修だけとする。新しいagent dispatch、
open-resource schema、runtime全面書換え、内部検証器の増設、release/pushは行わない。
