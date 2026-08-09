# scope-split-viz-20260809 終端独立監査

- 監査者: suzune（すずね）
- 日付: 2026-08-09
- Phase: `terminal-audit`
- review event: `001d5fd67e609542888a98be88f1d04b92600362d3ea8ec1ce6f288d13856676`

## 結論

**findingなし。受入可。** scope splitの前段s1〜s6、可視化v1／v2、主要source commit、
実split plan、公開Gantt実ブラウザ受入を独立に照合した。宣言膨張の観測からAI判断、
split revision、lineage、依存付替え、nested表示までの受入連鎖は閉じている。

## 照合した面

- `evidence/scope-split-20260809/s1.md`〜`s6.md`と`s6-live-plan.md`を読んだ。
- `evidence/scope-split-viz-20260809/v1.md`／`v2.md`を読んだ。
- `scope_expanded`は閾値・分類・自動判断を持たず、比較不能とsubset gapをnullで表し、
  unknown累計を後続compileへ伝播する現行sourceを照合した。
- s1で露出した例外握り潰し、subset入替、null非伝播、同名schema変更、fixture漏れ、
  shellの終了code誤測定は、v5 bump・回帰test・再測定まで閉じていることを確認した。
- `todo split`は子taskへ`parent_task_id`を付与し、子→残余、残余→旧下流を維持する。
  source ref衝突とwitness移行をapply前に拒否し、失敗時のplan／source／witness bytes不変を負側で固定している。
- 実plan `scope-split-live-20260809`でAだけの膨張勧告、A1→A2→残余A→B、
  親なしCの負対照、全task完走、store verify greenを確認した。
- nested Ganttは同一plan親だけを許し、不在親・循環を`TODO_LAYOUT_INVALID_HIERARCHY`でfail-closeする。
  座標用縮約graphとready意味の実graphを分離し、完了親container維持と空panel抑止を回帰testで固定している。
- 公開`gantt serve`の実ブラウザ受入でA内のA1→A2、開閉・再開、親なしC、SSE最新、
  console warning/error 0件、focused 7/7を確認した。
- 主要Lattice commitへ`git show --check`を実行し、全件greenだった。公開前full gateも
  product 1550/1550、sensor／static／store gateすべてgreenだった。

## store検証

review前の`todo verify --plan scope-split-viz-20260809 --json`はthrough sequence 4、
`snapshot_stale:false`、result
`41518a5b2bc68cb8210004561b11def9727967e74645cb7907b0ad907e79ee4c`。
`registered_unreconciled`はsource inventory未導入の旧planを示す公開状態で、
`lifecycle_blocked:false`／`dashboard_visibility_blocked:false`であり、本Phaseの受入を妨げない。

reviewはsequence 5、status `reviewing`、event digest
`001d5fd67e609542888a98be88f1d04b92600362d3ea8ec1ce6f288d13856676`。

## 判定

実装中に差し戻された表示・schema・測定器の欠陥は、いずれも補修後の負対照と実ブラウザ受入で閉じている。
未解決の受入findingは無い。この証拠を`terminal-audit` slotへ束縛してPhaseをacceptする。
