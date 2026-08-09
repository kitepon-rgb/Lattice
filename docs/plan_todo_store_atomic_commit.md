# ToDo store書込みとGit着地のatomic化（todo-store-atomic-commit-20260809）

オーナー裁定（2026-08-09）: 現campaignの緊急割込みとして、sourceのclean窓を待たずに
ToDo store変異からstore path限定commitまでを一つの機械操作へ畳み、publish・global install・
実運用smokeまで早期に届ける。task状態の正本はLattice storeの
`todo-store-atomic-commit-20260809`。

## 問題

現行の`lattice todo` write commandは`.lattice/todo`を排他更新するが、Git commitは呼出者へ
残している。そのためsourceがdirtyな間は「store 3pathは誰の変更か」「いつcommitしてよいか」を
roomで照会し、clean窓を全席で直列化している。2026-08-09のroom [1541]〜[1561]、
[1572]〜[1579]で、書込み自体より照会・block宣言・裁定の方が大きな運用費を生んだ。

## 固定する契約

- `lattice todo`のstore writeは、明示的なatomic commit入口から実行できる。その一操作が
  **共通Git dir上の機械ロック取得 → store変異 → `.lattice/todo`内の実変更だけを独立indexへ
  stage → path限定commit → lock解放**までを所有する。
- sourceや他者のstageがdirtyでも開始でき、それらをcommitへ含めず、bytes・stage状態も変えない。
- atomic入口の開始時点でstore自身がdirtyなら、所有者を推測せずtyped errorで拒否する。
- 同時atomic入口は同じlockへ直列化する。待たず拒否する場合はtyped errorとowner情報を返す。
- store変異後にGit着地が失敗した時は、開始時点のstore bytesへ戻してdirty storeを残さず、
  失敗をtypedに返す。silent fallbackや「storeだけ成功」は作らない。
- commit messageは操作・plan・taskを識別できる決定的な文面とし、commit hashをCLI resultへ返す。
- 既存のatomic指定なしwrite挙動は加算互換として残す。campaign残作業と`.team/scripts/done.sh`は
  新しいatomic入口を使い、実運用で照会なしの着地を実証する。

## 非目標

- source、evidence、docs、任意pathを自動commitしない。
- push、release、publishを個々のstore mutationへ混ぜない。
- dirtyなstoreを自動merge・上書きしない。
- sensorがsource dirtyをstaleと判定する契約を緩めない。`independence compile`自体に必要な
  clean sourceと、compile後のstore着地を原子的にcommitすることは別問題である。
- Git hookや署名設定の失敗を握り潰さない。

## 既知の罠

- 裸の`git commit`や共有indexへの`git add`は、他席のstageを巻き込む。
- worktree内だけのlockはlinked worktree間で共有されない。lockは`git-common-dir`へ置く。
- preflight後にHEADが進む競合を無視すると、最新sourceを親に持たないcommitやtreeの巻戻しを作る。
  HEAD束縛を検査し、有限再試行またはtyped conflictで止める。
- rollbackでrepo全体をrestoreしない。開始時cleanを確認したstore rootだけを正確に戻す。
- commit成功後にCLI出力整形だけが失敗してもcommitを巻き戻さない。commit receiptを回収可能にする。

## 工程

### ac1 atomic store commit実装

共通Git dir lock、store clean preflight、独立index、path限定commit、失敗rollback、typed診断を実装する。
`start` / `done` / `note` / phase state / witness系を同じ入口で扱い、helpとfocused testを加える。
dirty source・他者stage非巻込み、lock競合、commit失敗rollbackを負のコントロールで固定する。

### ac2 実repo受入と運用配線

`.team/scripts/done.sh`をatomic入口へ配線し、意図的なsource dirtyを残した実repoでstore writeが
照会なしにcommitまで完了すること、source bytesとindexが不変であることを実測する。
既存のwrite commandとsensor clean gateに退行がないことを確認し、証跡を残す。

### ac3 publish・global install・campaign smoke

関連gateを通し、package publishとglobal installを行う。global CLIが新atomic入口を公開することを
確認し、campaign残りの実store mutationを新入口で1件完了させて、lock・path限定commit receipt・
source dirty非干渉をsmokeする。

## 受入条件

1. source pathがdirtyな実repoでstore mutationが照会なしにcommitまで完了し、sourceと既存stageは不変。
2. lock競合は待機またはtyped errorで閉じ、store/sourceの巻込みcommitがゼロ。
3. commit失敗時はstoreが開始時bytesへ戻り、部分成功を返さない。
4. focused testと関連gateがgreen。
5. publish・global install後のCLIでatomic入口が使え、campaign残作業の実store mutationが着地する。
