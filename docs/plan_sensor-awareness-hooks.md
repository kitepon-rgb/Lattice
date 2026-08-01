# sensor気づかせ導線をinstall契約として提供する

- Status: Completed（2026-08-02・完了裁定は [ADR 0152](adr/0152-sensor-awareness-hooks-campaign-completion.md)）
- Lane: Orchestrated Control（planned interruption・多段受入・複数repo調整・裁定証跡）
- Lattice plan: `sensor-awareness-hooks`
- Owner decision: 2026-08-01 GO（[backlog bk-006背景](plan_backlog.md#6-sensor気づかせ導線のinstall契約新設)）

## 目的

Lattice単体導入環境で、AIがsensor（コード構造index）の存在に気づける導線を、Latticeの
install時契約として提供する。

これは旧Codegraphがinstall時に配線していたUserPromptSubmit導線（`codegraph prompt-hook`）の正式継承である。
Codegraph吸収時にsensor本体とSessionStart工程表hookは継承されたが、この導線は契約化も退役処理も
されなかった。2026-08-01のオーナー裁定とbacklog `bk-006`に基づき、その欠落を製品側で埋める。

## 思想と所有境界

製品自身がhookを所有・管理する。参照するのはSpotter方式であり、dotagentsへhook実体を預けない。

- Latticeはhook本体、installer、status契約、rollback、検証を所有する。
- dotagentsは導入先として統合契約へ追従するwaveだけを所有する。
- AIの推定や文章生成を製品内へ二重実装しない。Latticeは、AIへ構造sensorの存在を知らせる契約と
  検証可能な配線だけを供給する。
- Spotter併載時に案内が二重になることは許容する。提案の住み分け制御より、Lattice単体で導線が
  欠落しないことを優先する。

## 判断理由

旧Codegraphの配線が死にentryとして残った事実は、導線をhost側の暗黙設定に任せると、製品吸収や
更新の境界で所有者と退役経路が失われることを示した。hookをLatticeのinstall契約に含めれば、
install・status・uninstallを同じcanonical entryへ束縛し、導入とrollbackを製品versionと一緒に検証できる。

UserPromptSubmitごとに無条件で案内する方式は採らない。空砲を繰り返すとAIが案内を無視するよう学習するため、
git repoかつsensor indexが存在する場合に限定し、session×repoで一度だけ通知する。これは2026-08-01の
工場裁定と同型の判断である。

## 非目標

- Spotterとの提案住み分け制御。併載時の二重案内はオーナー裁定により許容する。
- dotagents所有の既存SessionStart工程表hookをLatticeへ移管すること。
- sensor indexを自動で`init`すること。indexが無いrepoでは導線hookは沈黙する。
- dotagents側のonboarding／verify-install文書をLattice側の実装waveで編集すること。実編集はP6の
  dotagents側waveが所有する。

## 公開契約

### install

`lattice hooks install --host claude|codex`は、対象端末の設定へ導線hookを冪等マージする。

- Claudeは`~/.claude/settings.json`、Codexは`~/.codex/hooks.json`を対象とする。
- 適用前にbackupを作り、既存entryを保持する。
- 書込み後にJSON妥当性を検証する。
- 失敗はfail-loudとし、部分適用を残さない。

### status

`lattice hooks status --host claude|codex`は、配線状態をschema付きtyped JSONで返す。単なるexit codeや
自由文ではなく、host、canonical entryの有無、期待との差、次の一手を機械可読にする。

### uninstall

`lattice hooks uninstall --host claude|codex`は、Lattice自身が配線したcanonical entryだけを除去する。
既存の他製品hookや利用者設定を削除せず、install前へ戻せるrollback経路とする。

### 導線hook本体

Lattice配布物内のhookをUserPromptSubmitで起動し、次の全条件を満たす時だけ、sensorツールの存在を
1行のINFOで案内する。

1. 現在地がgit repoである。
2. `.lattice/sensor/`にsensor indexが存在する。
3. 同じsession×repoでまだ案内していない。

非git repoとindex無しでは沈黙する。判定不能とCLI異常は、既存Lattice hook群の規律に揃えて
fail-visibleと意図した沈黙を区別する。`LATTICE_HOOKS=off`で無効化できる。毎プロンプトでは発火しない。

### 契約正典とrelease

- `docs/01_integration-package.md`へ「hooks導線」の節を追加し、CLI、host設定、通知条件、停止条件、
  rollbackを正典化する。
- publish対象commitが既定ブランチ祖先であることを検証する機械gateの有無をP0で確認し、無ければ
  本campaignで導入する。参照実装はAIShellの`scripts/verify-release-commit.mjs`と`prepublishOnly`である。
- version bump、npm publish、対象端末global install、公開後smoke、証跡記録までを同一campaignで閉じる。
  npm publishはH操作であり、明示承認前には実行しない。

## 受入条件

1. Claude／Codex双方でinstallが既存設定を保持し、backup、冪等性、書込後JSON検証、原子的rollbackを満たす。
2. statusが配線済み・未配線・差異・判定不能をschema付きtyped JSONで区別する。
3. uninstallがLatticeのcanonical entryだけを除去し、他entryを不変に保つ。
4. 導線hookがgit＋index有りの場合だけsession×repoで1回案内し、非git・index無しでは沈黙する。
   判定不能／CLI異常はfail-visible契約に従い、`LATTICE_HOOKS=off`で停止できる。
5. `docs/01_integration-package.md`のhooks導線契約が実装・CLI help・testと一致する。
6. 既定ブランチ祖先gateが存在し、無ければ追加され、対象commit以外のpublishを機械的に拒否する。
7. H承認後のversion bump→npm publish→対象端末global install→公開後smoke→証跡記録が同一campaignで完了する。

## レーン判定

本campaignはControl laneへadmitする。4条件はいずれも着手時点で確定している。

| admission fact | value | 根拠 |
|---|---:|---|
| `planned_interruption` | `true` | P5にnpm publishのH承認待ちが計画済み |
| `chained_acceptance` | `true` | 実装→gate→publish→install→smoke→追従が多段連鎖する |
| `multi_repo_write_coordination` | `true` | Lattice、dotagents追従、対象端末設定を調整する |
| `decision_evidence_required` | `true` | 端末設定の非破壊性、公開、rollbackの裁定証跡が必要 |

オーナー裁定は2026-08-01のGOであり、[backlog bk-006背景](plan_backlog.md#6-sensor気づかせ導線のinstall契約新設)を
入口とする。Fは端末設定書換え契約、公開契約、release gate、公開後の受入裁定を親が直接所有する。
Aは仕様と安全網が固定されたhook／CLI実装である。Hはnpm publishと対象端末へのglobal installであり、
明示承認を要する。

## Phase構成と依存

工程状態・依存・完了証拠の正本はLattice storeの`sensor-awareness-hooks` planである。
散文上のPhaseは次の対応を持ち、P0からP7まで前段完了を必要とする直列chainとしてcompileする。

| Phase | 目的 | gate |
|---|---|---|
| P0 baseline | repo green、release祖先gateの有無、CLI／既存hook構造を把握する | baselineと不足一覧を証拠化 |
| P1 設計裁定 | 端末設定書換え、canonical entry、backup／rollback、fail-visible境界を確定する | 契約クリティカル変更として実装前にrefuter反証を1回受ける |
| P2 安全網 | Claude／Codexの既存設定を壊さないcharacterizationと負例を先行する | 本体変更前に安全網green |
| P3 実装 | hooks install／status／uninstallと配布物内hook、必要ならrelease祖先gateを実装する | focused test green |
| P4 統合検証 | host別fixture、実CLI、rollback、関連gate、クロスproviderレビューを通す | 未実行をgreenへ丸めず受入裁定 |
| P5 publish | 契約正典化、version bump、H承認後publish、global install、公開後smokeを行う | publish receiptとsmoke証跡 |
| P6 dotagents追従 | dotagents側waveでonboarding／verify-installを公開契約へ追従させる | 別repo差分と統合検証を受入 |
| P7 知識還流 | Decision、証跡、backlog／plan状態へ学びと最終結果を還流する | campaign terminal gate |

直列化は依存関係による。P1はP0の実態、P2はP1の裁定、P3はP2の安全網、P4は実装、P5は統合green、
P6は公開済み契約、P7は全受入結果を必要とする。

## Lattice工程への導線

- 着手時は`lattice todo start --plan sensor-awareness-hooks --task sah-p0-baseline`の`advisory`を読む。
- source変更ToDoをdispatchする前に、`.lattice/todo/witness/sensor-awareness-hooks.json`へowned symbol／path、
  caller／callee、impact、affected test、state／effect／dynamic unknownを宣言し、
  `lattice todo independence compile --plan sensor-awareness-hooks --input <ref>`を通す。
- 読出しは`lattice todo independence --plan sensor-awareness-hooks --json`を使う。`coverage: missing`を
  競合無しとして扱わない。
- 実行中に実変更資源と宣言scopeの差、他のactive scopeとの重なりを観測し、静的unknownを実行時境界検知へ渡す。
- plan topologyを変える必要が生じた場合はactive versionへ追記せず、accepted artifactをpredecessorにした
  新versionへaffected ToDoを再compileする。task ID変更時はwitnessをmigrateしてから再compileする。

## 既知の罠と検証方針

- 利用者のJSON設定は製品の専有物ではない。parse→backup→merge→validate→atomic replaceの途中失敗で
  部分適用や他entry消失を起こさない。
- ClaudeとCodexの設定形を同一視しない。host adapterごとにcanonical entryを固定し、共通contractを
  provider固有形式へ投影する。
- session×repoの一度だけ通知するstateは、repo取り違え、永久抑止、並行prompt、壊れたstateを負例に含める。
- hookの沈黙は成功の握り潰しにしない。非対象条件による沈黙と、判定不能／CLI異常のfail-visibleをtestで分ける。
- 実端末設定、publish、global installは外部状態を変える。目的・影響・rollbackを示し、H承認後だけ実行する。

検証はfocused test、`npm test`、`npm run check`、`npm run ci`、Claude／Codex fixtureによる非破壊mergeと
rollback、H承認後の実install／status／uninstall smoke、公開packageからのsmokeを順に行う。

## 導線

- 製品思想: [PLAN.md](../PLAN.md)
- 公開契約: [docs/00_product-contract.md](00_product-contract.md)
- integration package正典（P5で追記）: [docs/01_integration-package.md](01_integration-package.md)
- 起票元: [docs/plan_backlog.md](plan_backlog.md)

