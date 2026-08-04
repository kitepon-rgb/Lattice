# 予測境界の自由化と実競合の対象限定処理

- Status: In progress
- Lane: Orchestrated（公開契約・特許請求項9/10・多段受入を変更するため）
- Lattice plan: `runtime-prediction-freedom`
- Patent canonical: `/Users/kite/Developer/Patent/Lattice/出願書類/03_特許請求の範囲案.md`

## 目的

計画時の`owns`／`reads`／`writes`／`creates`を実装AIの許可リストとして扱わず、不完全な予測として
並列計画へ利用する。実装AIは割り当てられたproject worktree内で、新規・既存を問わず必要なfileを
作成・変更・削除できる。実変更は実行時に観測し、競合の影響を受ける作業群だけを停止・再計画する。

併せて、seam変換前後のwave計算がprecedenceを捨てる欠陥と、terminal receipt受理前の最終実diff観測が
managed runtimeへ配線されていない欠陥を直す。

## 不変条件

- `creates: true`、exact absent path、nonempty/exact `owns`、affected exact一致をdispatch許可条件にしない。
- 既知のwrite×write、write×read、state/effect競合は計画時の直列化材料として維持する。
- rawな`writes`予測外をboundary violation、rollback、成果破棄の理由にしない。
- 請求項9の実変更範囲観測を維持し、actual writeと同時稼働作業の予測read/writeまたは実変更の重複を捕る。
- 請求項10どおり、競合の対象作業群だけを停止し、無関係な実行中作業を止めない。
- 無関係作業はorigin dispatch／plan revision／leaseのまま継続し、そのreceiptを最新全体epochとの差だけで棄却しない。
- `NO_PLAN`強制、意図的直列化の二度止め、terminal auditを変更しない。
- startup、shutdown、外部process状態を再構成できないrecoveryの全体barrierは維持する。

## 実装単位

### 1. 予測contractとauthoring

最新版witness/run requestの意味をpartial predictionへversion upする。旧artifact readerは残す。
scaffold/guidance/front-endから`creates`と完全境界の通過gateを外し、空または不完全な予測でもcompile・dispatchする。
単独の予測超過は観測記録に留め、freezeやreceipt rejectへ昇格しない。

### 2. precedenceを含むwave計測

active planのhard dependencyとjoinからcanonical precedenceを一度導出し、同じ対象task集合・capacity・precedenceを
seam変換前後へ渡す。waveから新しい依存を作らず、同期barrierにも変えない。

### 3. 対象限定barrierとtask-scoped execution binding

既存のhold/continue裁定後に全workerを止める経路を、対象bindingだけをquiesceする経路へ変える。
plan revisionの全体連番は維持し、実行許可・receipt照合をattempt単位へscopeする。旧revisionで継続中の無関係attemptと、
新revisionで再開した対象attemptを同時に有効化する。対象の後継作業は無関係attemptのterminalを待たず開始する。

### 4. terminal実diff観測

terminal応答をorigin bindingへ検証した後、receipt受理前にsupervisorがworktreeの最終diffを独立取得して耐久化する。
receipt自己申告を実diffへ偽装せず、新しい自己申告一致gateも追加しない。actual×他task予測read/writeと、実行時間が
重なったattempt同士のactual×actualを分類し、actionable conflictだけを対象限定barrierへ渡す。

### 5. 統合・請求項監査

3 workerの実daemon fixtureで、A/B競合時にCが同一process/bindingのまま走り、Cのterminal前にA/B後継が開始し、
C receiptが受理されることを確認する。unknown×unknown同一path、actual×predicted read、sentinel無効時のterminal検出も
同じ受入面で固定する。公開契約、ADR、請求項充足表は実装と検証結果に合わせて更新する。

## F/A/H

- **F**: predictionと変更影響範囲の契約、receipt/lease binding、対象作業群、請求項9/10、ADR裁定。
- **A**: producer/consumer配線、既存fixtureを使うfocused testとintegration test、文書反映。
- **H**: push、publish、release、本番deploy、特許正本の変更。今回の依頼には含めない。

## 成功条件

- `creates`なし、空または不完全な`owns`／`writes`、未知の新規file名・件数でもcompile・dispatchできる。
- 単独の未予測added/modified/deletedはfreezeせず、有効なreceiptを受理する。
- precedenceが残るseamを偽のwave改善として採用しない。
- A/B/C同時実行でA/Bだけが停止し、Cはrebindされず、A/B後継がC terminal前に開始する。
- Cの旧revision receiptをproducer/verifier双方がorigin bindingにより受理する。
- terminalの独立実diffがreceipt受理より前に分類され、actual×predicted read/writeとunknown×unknownを検出する。
- 変更に直結するfocused test、関連integration、最後の`npm run ci`がgreenである。
- 請求項本文を変更せず、請求項9・10の充足根拠を実コードと試験で示す。

## 非目標

- 実agent dispatch機能、AI生成機能、新しいopen-resource機構を追加しない。
- runtime全体を書き直さず、内部の検証器・digest・fallbackを増設しない。
- legacy artifact、過去ADR、archive、evidenceを削除しない。
- waveを同期実行barrierへ変えない。
- 一般workerの自由化と、限定的な機械seam transactionの境界を混同しない。

## 検証

各実装単位では変更に直結するfocused testだけを回す。統合時に関連integrationを1回、全単位完了後に
`npm run ci`を1回実行する。外部worker/process境界の試験以外へ新しい失敗時チェック機構を追加しない。

## Rollback

予測contract、wave計測、対象限定barrier、terminal観測を独立commitにする。回帰時は当該commitだけをrevertする。
旧schema readerと全体barrier recoveryを残すため、既存artifact再生と外部processの明示停止経路は失わない。
