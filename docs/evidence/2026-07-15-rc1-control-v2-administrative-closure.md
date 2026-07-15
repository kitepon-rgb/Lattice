# RC1 Control v2 administrative closure evidence

- Date: 2026-07-15
- Control: `lattice-rc1-closed-loop-v2`
- Control revision at diagnosis: 10
- Decision: [ADR 0004](../adr/0004-rc1-control-admission-correction.md)
- Confidence: high（Control manifest、placement dry-run、Control Record実装契約の実読）

## Finding

RC1-B候補のplacement dry-runは`ineligible`となり、hard reasonとして次を返した。

- `budget-unknown`: Controlの`max_cost_microusd`が`null`であり、既知reservationを追加できない。
- `verification-insufficient`: `codex-native`観測はrouting smoke由来の`verified`で、writeに必要な
  `execution-verified`ではない。

dry-runはmutationではないためControl revisionは10のまま。Workerへ実作業はdispatchしておらず、
`worker_runs=0`、`consultations=0`、`campaigns=0`、dispatch receipt 0である。

## Acceptance matrix

| 条件 | 観測 | 判定 |
|---|---|---|
| source実装が開始されていない | RC1-B／RC1-Cへのfollow-up未送信、worker run 0 | pass |
| 誤りをempty／unlimitedへ丸めない | dry-runの2 hard reasonを保持 | pass |
| 既存研究artifactを失効させない | fixture、query set、characterization、plan topologyは無変更 | pass |
| 旧Control履歴を保存する | directoryを削除せずcancel／finalize／archiveへ進める | pass |
| writer境界を守る | dotagents／Observerはread-only、Latticeだけを編集 | pass |
| 後継の再開条件を明示する | known budget＋read-only実タスクによるexecution verification | pass |

## Audit and refutation

反対仮説「`null`は未使用なので0扱いできる」は、Control Recordの`assertBudgetWithin`がlimit `null`かつ
reservationありを`BUDGET_UNKNOWN`で拒否する実装とdry-run実測に反する。

反対仮説「routing smokeでwrite実行能力は証明済み」は、routing smokeがrole／model／effort／developer
instructionsの照合だけで、Task packetの実行、structured report回収、親acceptanceを含まないため棄却する。

Controlをそのまま残して独立Controlを作る案は、同じobjectiveの失敗instanceをactiveのまま放置し、後継関係と
archive条件を曖昧にする。取消Decisionで閉じてcontinuationを作る方が履歴と再開条件を一意に保つ。

## Regression evidence

この管理停止ではsourceを変更しない。直近のsource契約gateは
[fixture boundary preflight](2026-07-15-rc1-fixture-boundary-preflight.md)のfocused
`3 pass / 0 fail / 0 skip`と`npm run check` greenである。以後の変更はdocsだけなので、同一source digestの
focused greenを再利用し、full suiteを追加実行しない。

## Knowledge return

- Controlのnullable budgetは「未使用」ではなく「未知」であり、Run追加前にknown envelopeが必要。
- routing smokeとexecution verificationは別gateである。
- admission dry-runを実作業前に置いたため、source差分や未記録dispatchを生まずに設定欠陥を検出できた。
- plan versionとControl instance versionを分離し、運用訂正だけで研究topologyを再compileしない。

## Scope statement

これはRC1実装完了の証拠ではない。Control v2を実装未着手で閉じ、同じplan versionを後継Controlへ継続する
ためのadministrative closure evidenceである。
