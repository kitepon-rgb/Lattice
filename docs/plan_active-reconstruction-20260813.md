# 散文PLANからの将来工程再構成（比較実験）

## 入力

この工程表の意味上の入力は次の散文PLAN三本だけとする。

- `docs/plan_peertable-dogfood-repairs-20260811.md`
- `docs/plan_companion-repair-prerequisite-edge-20260812.md`
- `docs/plan_structure-artifact-canonical-repair-20260812.md`

既存のLattice工程表、実装履歴、現在の完了状態は、工程表を確定するまで判断材料にしない。

## 再構成方針

散文が要求する製品成果を一つも落とさず、試験、監査、配備、基線調査を独立した工程へしない。これらは各製品工程を完成させる作業に含める。companion campaignの起票軽量化と、起票時の対象工程への前提edge原子登録は、同じ利用操作を完成させる一工程へ統合する。

工程間の実装順序は要求されていないためhard dependencyを置かない。並行作業時のファイル競合は、工程の依存関係ではなく着手時のindependence判断で扱う。

## 製品工程

1. conversation調整とpull実行前提の案内を一致させる。
2. hold対象workerとAI制御面を分離し、制御AIが回復操作を継続できる接続契約を作る。
3. clean independence bindingを隔離環境で作成し、landing対象外commitの混入を検知する。
4. 完了済みtaskを既に満たされたcross-plan前提として記録する。
5. companion campaignの起票と、repairから対象工程への前提edgeを一操作で原子登録する。
6. typed JSONを返す`todo migrate`で`--json`を一貫して受理する。
7. 不正なstructure artifactをtyped診断し、安全に一意な入力からcanonical復旧する。

各工程の完了には、変更に直結する試験、作業者自身の監査、最終試験結果の記録、製品として必要な配布と実利用面での確認を含む。これらを別工程へ分解しない。
