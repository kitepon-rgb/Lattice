# plan: Peertable実戦で露出したLattice摩擦の修理

- Status: Planned
- Date: 2026-08-11
- 実戦consumer: Peertable（Latticeの公開CLIとversioned JSONを利用する）

## 目的

Peertableの開発をLatticeで進めた際に実際に作業を止めた6件の摩擦を修理する。
このPLANが定めるのは、利用者が得る機能とその受入条件だけである。試験、作業者の自己監査、
最終試験結果の提出、配布と実利用確認は現行の共通規範に従って各修理の完遂へ含め、
基線確認、配備Wave、監査、closeoutを独立工程として追加しない。

## 実現する機能

1. `coordination_mode=conversation`を選んだ場合でも、pull設備を使うために必要な
   independence artifactと次の操作が、実行前に分かる。
2. hold対象のworkerとAIの会話・制御processを分け、workerが停止してもAIが回復操作を続けられる。
3. 共有mainの無関係なWIPをcommitせず、隔離されたclean基準からindependence bindingを作れる。
4. 完了済みtaskを、後から「既に満たされたcross-plan前提」として記録できる。
5. 実戦中に見つけた欠陥をcompanion campaignとして起票する際、AIが計画文書、source inventory、
   extractionを一から手組みする量を減らす。
6. typed JSONを返す`todo migrate`は、通常実行、dry-run、schemaのいずれでも`--json`を一貫して受理する。

## 実装原則

- 既存の公開CLI、store transaction、dependency、independence、landingの面を再利用し、
  この6件のためだけの台帳、承認gate、監視機構、復旧系統を新設しない。
- 既存制約は、それ自体を守ることを目的にしない。利用者が得る機能に必要なものだけ残す。
- 外部入力やGitなど制御不能な境界の失敗はtypedに返す。内部処理は検査層を重ねず、
  状態遷移とtransaction自体を正しくする。
- PLANにない失敗を想定した追加機能は実装しない。実装中に別の問題を見つけた場合は本工程へ便乗させない。

## 工程

- [ ] ldr-02 conversation調整とpull実行前提の案内を一致させる
- [ ] ldr-03 hold対象workerとAI制御面を分離して回復可能にする
- [ ] ldr-04 共有mainを汚さず隔離されたclean基準からindependence bindingを作る
- [ ] ldr-05 完了済みsourceを既に満たされたcross-plan前提として記録する
- [ ] ldr-06 companion campaignの起票を軽量化する
- [ ] ldr-10 `todo migrate --json`の受理を一貫させる

## 受入条件

### ldr-02

conversation調整だけでpull可能だと案内しない。pull設備の実行に不足するものと、
independence artifactを用意する操作または別の実行方法を、公開CLIのtyped next actionから辿れる。

### ldr-03

holdがworkerへ作用している間も、AIの会話・制御processはrecoveryを読み、状況報告と回復操作を行える。
この実現のためにLatticeがtask選択、会話、席管理を所有しない。

### ldr-04

共有mainを無関係なWIP commitでcleanにすることなく、隔離されたclean基準からindependence bindingを作れる。
原因となった無関係WIP commit自体を不要にし、その後段へ別のlanding監視機構を追加しない。

### ldr-05

完了済みsourceと未完了targetを指定すると、sourceを「既に満たされた前提」として記録し、
targetを不必要にblockしない。新しい証拠台帳や完了状態の不変化機構は作らず、既存のtask完了記録を利用する。

### ldr-06

公開CLIからcompanion planの必要入力を取得し、既存planを部分変更せず新planとして起票できる。
AIが判断すべき目的、工程分割、依存関係をLatticeが推測・生成しない。

### ldr-10

`todo migrate`の通常実行、dry-run、schemaで`--json`の扱いが反転しない。
既存のversioned JSON出力は維持する。

各工程は変更に直結するfocused test、作業者自身の監査、最終試験結果の記録を持つ。
監査担当はその結果の妥当性を判断し、試験を再実行しない。成果は現行の共通規範に従い利用面まで届ける。

## 依存関係

6件の製品機能に相互の先決関係は定めない。実装境界の競合は着手時の実測で判断し、
配備や監査の都合を製品上のhard dependencyへ変換しない。

## 対象外

- Peertableの席、room、モデル／effort、円卓規律の変更。
- Latticeによるtask選択、会話、監査判断の代行。
- 本PLANと無関係なbacklogの修理。
