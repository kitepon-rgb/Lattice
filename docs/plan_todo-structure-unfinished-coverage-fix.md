# ToDo構造検査・未完了coverage一致修理

日付: 2026-08-12  
状態: 実装中  
管理方法: Markdown ToDo（Lattice plan／ToDo／runは使わない）

## 再現

Peertableの既存planへ途中適用したところ、`todo structure input --dry-run`は
pending／in-progress／blocked taskをすべて列挙した入力をvalidとした。一方、同じ保存sourceを
`todo structure compile`へ渡すと、完了済みtaskを`topology_only_task_ids`として
`STRUCTURE_COVERAGE_MISSING`にし、有効化を拒否した。

入力契約と製品正典は途中適用時のcoverageを未完了taskに限定している。compileだけがplan topologyの
完了済みtaskまで要求しており、入口間で判定が一致していない。

## 成功条件

- 完了済みtaskはstructure setに含めなくてもcoverage漏れにならない。
- pending／in-progress／blocked taskの列挙漏れは従来どおり拒否する。
- structure setに含めたtaskが登録topologyに存在しない場合は従来どおり拒否する。
- realization、finalization、構造schemaは変更しない。
- Peertableの再現入力6 planが`consistent`になり、公開dashboardへ表示される。

## ToDo

- [x] 現在のcompile誤判定をcharacterization testで固定する。
- [x] overlayへplan全taskの状態を渡し、topology-only判定からdoneだけを除外する。
- [x] 未完了taskのcoverage漏れが残る回帰を追加する。
- [x] focused testと関連testを通す。
- [ ] version、CHANGELOG、公開証跡を0.58.2へ揃える。
- [ ] main着地、npm公開、global install、bridge再起動を行う。
- [ ] Peertableで全structure sourceを再compileしdashboardを確認する。

## 非目標

- 完了済みtaskへ遡及的なplanned structure／realizationを要求しない。
- immutable bindingの再発行方式を変更しない。
- structure以外のLattice工程・実行層を修正しない。

## 今回の実行手順とAI介入境界

Peertableへの途中適用で実際に行った順序を、後続の自動化候補として残す。

1. `todo status`とplan snapshotからpending／in-progress／blocked taskを列挙する。
2. 保存済み`logical_dataflow.v0`と計画正本から、各taskのinput／operation／output／contract／anchorを設計する。
3. structure setをcanonical JSONへ整形し、self digestを付ける。
4. 対象planをまとめて`structure input --dry-run`し、coverage・topology・baseline違反を集計する。
5. validなsourceをplan単位で保存し、構造sourceだけをpathspec限定でGit追跡する。
6. 対象planをまとめてcompileし、verdict・finding・有効化状態を集計する。
7. findingを入力不備とLattice実装欠陥に分け、欠陥なら再現test→修正→focused test→実project再compileの順で閉じる。
8. version／lock／CHANGELOGを揃え、完全CI、pack、audit、既定ブランチ祖先gateを通す。
9. publish、global install、bridge再起動、dashboard／実project smokeを同じrelease候補で行う。

AI判断を残すのは2と7だけとする。1、3〜6、8、9は入力・対象・承認が揃えば機械処理できる。
特にcanonical化、digest、planごとの反復、結果集計、release後のruntime整合はAIの手作業へ依存させない。
