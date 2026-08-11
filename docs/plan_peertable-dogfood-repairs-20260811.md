# plan: Peertable実戦で露出したLattice摩擦の即時修理

- Status: Planned
- Date: 2026-08-11
- 工程正本: Lattice store（`plan_key: peertable-dogfood-repairs-20260811`）
- 実戦consumer: Peertable（公開CLIとversioned JSONだけを使い、storeを直読・直書きしない）

## 目的

Peertable改良をLatticeで工程管理した実戦中に露出した、Latticeの不具合、案内不足、
AIの手作業へ不必要に依存する操作を、発見したセッション内で工程化して直す。
修理した版を段階的に配備し、同じPeertable開発で直ちに使って再測する。

厳格な契約そのものを緩めるcampaignではない。active planの不変性、dirty worktreeで
independence記録を作らない原則、runtime holdの物理的barrier、Latticeがtask選択・会話・
監査判断を所有しない境界は維持する。直すのは、正しい契約へ安全に到達・復旧・配備する面である。

## 実戦で観測した破断面

1. `coordination_mode=conversation`はwitness督促を消すが、pull runのintakeは有効な
   independence artifactを要求する。会話調整だけでpull設備まで使えるように読める案内と、
   実行時の必須条件が食い違った。
2. hold済みintakeへAIの制御processそのものをattachすると、Latticeは正しく`SIGSTOP`するが、
   止められたAIはrecoveryを読んで報告できない。process barrierと制御面の接続契約が足りない。
3. independence compileのclean worktree要件を共有mainで満たすため、無関係な作業までWIP commitになり、
   別taskのpushが未監査commitを祖先として運んだ。clean bindingは維持しつつ、隔離された基準と
   landing対象外commitの混入を機械的に判別する面が要る。
4. 完了済みtaskを後からcross-plan dependencyのsourceにすると
   `dependency_source_terminal`で拒否され、既に満たされた前提を機械記録へ残せなかった。
5. active planへ部分CRUDを足さない判断は正しいが、実戦中の欠陥をcompanion campaignとして
   起票する正規手順が、計画文書・source inventory・extractionをAIが手組みする作業へ寄りすぎている。

## 所有境界

Lattice側で修理するのは、公開CLI／typed result／実行設備／配備導線である。
Peertable側の席状態、task開始・終了のroom announcement、モデル／effort変更、Peertableの`done`と
Lattice acceptの接続、円卓規律は本campaignへ移さない。

## 円卓と監査

- 実装席はCodex系を既定とする。Claude系の既存席には新しい工程を渡さず、原子的作業の区切りで
  Codex席へ交代する。特にOpusを本campaignの新規担当にしない。
- ready工程は、空いているメンバーが自分で探して着手する。親からの個別割当を待たない。
- 各工程の担当者と別の、当該工程の履歴を読んだメンバーがpeer auditを行う。
- 親は工程管理と通常監査を引き取らない。各工程が`done`かつpeer audit済みになった後だけ、
  元の設計思想・Lattice工程記録・成果物をメンバーへ言わずに照合し、問題があれば工程へ差し戻す。

## 配備方針

修理を全件ためて一度に公開しない。互いに独立な修理がpeer auditを通ったところでWave 1を配備し、
Peertable本開発で使う。残りを実戦結果で補正してWave 2を配備する。

各Waveは、対象commitがremote既定branchの祖先であること、package payload、npm版、Mac global install、
常駐processのruntime version、公開面の実応答を別々に検証する。FOX／WSL2は変更面が届く場合だけ対象にする。
配備前には、現在`origin/main..HEAD`にある20 commitと公開済み0.57.3の関係を実物で照合する。

## 非目標

- active planへの汎用append／partial CRUDを追加すること。
- dirty worktreeからindependence artifactを記録できるようにすること。
- hold時の物理barrierを警告だけに弱めること。
- Latticeへtask選択、席割当、会話、AI判断、親監査を実装すること。
- 本campaignと無関係なbacklogを便乗して解消すること。

## 工程

- [ ] ldr-01 配備基線と既存20 commitの公開・監査状態を照合する
- [ ] ldr-02 conversation調整とpull実行前提の案内・typed next actionを一致させる
- [ ] ldr-03 AI制御processを凍結しないworker attach・hold回復契約を作る
- [ ] ldr-04 clean independence bindingとtask外WIPを分離し、landing混入を検知する
- [ ] ldr-05 完了済みsourceを「既に満たされたcross-plan前提」として記録できるようにする
- [ ] ldr-06 companion campaignの正規起票を軽くし、active topology不変を保つ
- [ ] ldr-07 Wave 1を配備し、進行中Peertable campaignで実戦smokeする
- [ ] ldr-08 Wave 1の実測を反映し、残修理をWave 2として配備する
- [ ] ldr-09 全工程のpeer audit・配備証跡・実戦結果を照合してcampaignを閉じる

## 依存

- `ldr-01`完了後に`ldr-02`〜`ldr-06`へ着手できる。
- `ldr-02`・`ldr-03`のpeer audit後に`ldr-07`を行う。
- `ldr-04`〜`ldr-06`と`ldr-07`の実戦結果が揃った後に`ldr-08`を行う。
- `ldr-08`後に`ldr-09`を行う。

## 受入

- 5件すべてが「既存契約を維持した修理」または「実測に基づく明示的な契約変更」として、
  focused test・typed CLI出力・証拠へ束縛されている。
- Peertableからは公開CLIとversioned JSONだけで新しい導線を利用できる。
- 各修理は担当外メンバーのpeer auditを通り、親の事前監査や工程代行を受入条件にしていない。
- Wave 1／Wave 2ごとに、commit、push、publish／install、runtime、実戦consumerの結果を区別して記録する。
- 同じPeertable開発で、修理前の再現と修理後の挙動を少なくとも1回ずつ実測する。
