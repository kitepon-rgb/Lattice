# 散文PLAN再構成と既存工程表の比較

## 実験条件

再構成工程は、既存工程表と実装履歴を比較材料として読む前に確定した。入力は次の散文PLAN三本だけである。

- `docs/plan_peertable-dogfood-repairs-20260811.md`
- `docs/plan_companion-repair-prerequisite-edge-20260812.md`
- `docs/plan_structure-artifact-canonical-repair-20260812.md`

確定したauthoring digestは`07a24c42ce0c7fe32e69b4bc4afc17d674331b9e0cb971d3abdb9cf85c95ebac`、scope review digestは`b6b7613619dcfa31d48ff60094f3aeae07dc8532ee6885b92364b52f1ed3d28a`である。scope reviewは作業仕様8件、工程7件、未対応0件、scope外0件で`scope_preserved`となった。

## 結果

| 比較項目 | 既存工程表 | 再構成工程表 |
|---|---:|---:|
| plan数 | 3 | 1 |
| task数 | 12 | 7 |
| 製品成果を直接実装するtask | 8 | 7 |
| 基線・配備波・終端照合だけのtask | 4 | 0 |
| companion起票を完成させるtask | 2 | 1 |
| 最大frontier | dogfood planで7 | 7 |
| critical path | dogfood planで4 | 1 |

## 要件対応

| 散文の製品要件 | 既存工程 | 再構成工程 |
|---|---|---|
| conversationとpull前提の一致 | `ldr-02` | `ar-01` |
| hold workerと制御面の分離 | `ldr-03` | `ar-02` |
| clean bindingとlanding混入検知 | `ldr-04` | `ar-03` |
| 完了済みcross-plan前提 | `ldr-05` | `ar-04` |
| companion起票の軽量化 | `ldr-06` | `ar-05` |
| companion起票時の原子edge登録 | `cre-01` | `ar-05` |
| `todo migrate --json`の一貫性 | `ldr-10` | `ar-06` |
| structure artifactのtyped診断・復旧 | `sar-01` | `ar-07` |

再構成で製品要件は落ちていない。`ldr-06`と`cre-01`は同じcompanion起票操作の入口と原子性を別taskにしていたため、一工程へ統合した。

## 既存工程から消えたもの

- `ldr-01`: 公開・監査状態の基線照合。
- `ldr-07`: Wave 1の配備とsmoke。
- `ldr-08`: Wave 2の配備とsmoke。
- `ldr-09`: 全工程のpeer audit・配備証跡・実戦結果の終端照合。

これらは製品成果ではなく、製品工程を完了させるための作業である。現在の規範で最初から作ると、各工程の試験、自己監査、最終試験結果、配布、実利用確認へ内包され、独立taskにはならない。

## graphの違い

既存dogfood planは、修理taskをWave 1、Wave 2、終端照合へ接続したためcritical pathが4になっている。再構成案は、散文中に製品機能同士の実装順序がないためhard dependencyを置かず、7工程を同時にreadyとした。実際のファイル競合は着手時のindependence判断で扱い、製品上の依存へ変換しない。

再構成案はv4の最小構成として一つの`implementation` Phaseだけを持つ。監査は作業者が提出した最終試験結果の妥当性を一度判断するgateであり、試験・配備・監査を追加工程へ分裂させない。

## 機械検証

- `lattice plan scope-review`: accepted、未対応work spec 0、scope外task 0。
- `lattice plan create`: task 7、critical path 1、frontier 7、serialization ratio 0.1429。
- `lattice todo status`: 7工程すべてready。
- `lattice todo verify`: store整合、snapshot staleなし。

比較用storeは`/private/tmp/lattice-active-reconstruction-eval-8bHsDt/.lattice/todo`に生成した。本番のLattice storeは変更していない。
