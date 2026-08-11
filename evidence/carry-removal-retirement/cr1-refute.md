# cr1-refute 受入証跡

## 実施

ADR 0167（Proposed）を実コードで反証。実行者は円卓の suzune（gpt-5.6-terra × medium）。
読み取りのみ、実装は行っていない。

## 結論

**条件付き採用。** 提案の骨子（同revisionで`removed`と宣言された相手への辺だけ消滅を許す）は、
removed集合を`task_migration`の`to_task_id:'removed'` かつ `state_policy:'removed'`だけから
作る限り、非removed辺の意味変化を隠す合成を作れない。

根拠として引かれた行:
- task属性は従来どおり比較される（`todo-store.mjs:2295-2303`, `2337-2350`）
- 非removed incomingは完全一致のまま（`2386-2389` / `2426-2428`）
- 非removed outgoingの削除も拒否のまま（`2390-2393` / `2430-2432`）

## 必須条件（1点）

`joins.after`のfilter後が空になる場合、そのjoin全体をpredecessor意味論から除外すること。
空`after`を残すとdesired plan側のvalidatorが`after.length > 0`を要求するため
（`todo-migration.mjs:125-131`）表現不能で、carry比較も一致しない。
複数afterからremovedを1本だけ抜く場合は、残ったafterをsortしてjoinを比較する。

→ ADR 0167 Decision 5 として取り込み済み。

## 棄却された懸念

- **incoming削除が履歴偽装になる**という懸念は成立しない。task stateはcarry時に既存の
  status/done_at/evidenceをそのまま写す（`todo-store.mjs:2491-2495`）ので「先行条件なしでdoneだった」へは
  書き換わらない。projection上の依存が消えるだけで、これはremovedを明示した帰結である。
- **phase_accept_dependencies**はtask側へのincomingだけを保持する形（`2366-2369`）なので、
  removed taskを対象にするedgeはcarry taskの比較に残らない。
- **phase構成員比較**は既にremoved taskを除いている（`2516-2534`）。

## 代替案の評価

`retired`状態の新設は、state machine・runtime migration・source cutoverを広げるため、
本決定の限定修正より安全とは言えない。→ 棄却（ADR 0167「棄却した代替」へ記録）。

## 要求された試験（cr2の受入条件）

hard incoming / hard outgoing / 複数after join / 単独after join（join全体消滅） /
非removed辺削除の拒否 / acquire_phase / carry_reconciled_metadata。
