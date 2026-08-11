# todo start 構造コンテキスト自動供給

日付: 2026-08-12
管理方法: Markdown ToDo（Lattice plan／ToDo／runは使わない）
対象版: `@quolu/lattice@0.58.3`

## 背景

ToDo構造検査はplanned input／operation／output／contract／code anchorを保存し、compileで
既存ソースグラフと合成できる。一方、`lattice todo start`の返却はdesign memoとnote contextだけで、
着手するAIへ対象taskの構造データを供給していない。構造データが正本にあっても、実装者が別コマンドや
ファイル探索を行わなければ読めないため、計画と実装の接続が機械化されていない。

完了側は既に、graph対象taskのfresh realizationが無ければ`todo done`を拒否し、全task完了後の
fresh consistent finalizationが無ければphase accept／closeを拒否する。本修理はこの既存gateを変えない。

## 成功条件

- `todo start`の正規JSON返却へ`structure_context`を必ず含める。
- 構造機能が有効なplanでは、対象taskのapplicabilityとplanned構造を直接返す。
- planned構造にはinput、operation、output、contract、code anchor、failure、non-goal、outcomeを欠落なく含める。
- structure set identity、compile freshness、stale reason、次の構造操作を同じcontextへ載せる。
- 構造機能未適用planは従来どおりstartでき、`status=not_enabled`を明示する。
- source／bindingの不整合を空contextへ丸めず、typed failureまたは機械可読な非有効状態として表す。
- graph対象taskのrealization-before-doneと、plan終端のfinalization gateを維持する。
- Peertableの実planで、着手結果から対象taskの構造データを一回で取得できる。

## 公開契約

start mutation resultを`lattice.todo_mutation_result.v5`へ上げ、次を追加する。

```json
{
  "structure_context": {
    "status": "available | not_enabled",
    "enabled": true,
    "freshness": "fresh | stale | missing | superseded | null",
    "stale_reasons": [],
    "structure_set_digest": "sha256 | null",
    "task": {
      "task_id": "T1",
      "applicability": "graph | excluded",
      "planned": {},
      "excluded_reason": null
    },
    "next_actions": []
  }
}
```

`task`はcanonical structure sourceの対象taskをそのまま投影する。excluded taskはplannedを持たず、
除外理由を渡す。未適用planは`task=null`とし、構造データが無いことを明示する。

## ToDo

- start contextの現状欠落をcharacterization testで固定する。
- structure source／stateから対象task contextを作るpure projectionを追加する。
- start mutation result v5へprojectionを接続する。
- graph／excluded／未適用／不整合状態の回帰testを追加する。
- completion lifecycle gateの既存testを通し、完了強制が後退していないことを確認する。
- version、lock、CHANGELOG、公開証跡を0.58.3へ揃える。
- focused test、完全CI、pack、audit、既定ブランチ祖先gateを通す。
- npm公開、global install、bridge再起動、Peertable実plan smokeを行う。

## 非目標

- planned structureをAIに生成させる機能は追加しない。
- planned sourceをrealizationで破壊的に上書きしない。
- 構造機能未適用planへ入力を強制しない。
- todo done／phase終端の既存gateを再設計しない。

## 既知の罠

- start結果へfieldを増やすためschema世代を上げ、v4のまま黙って形を変えない。
- compile artifactの鮮度とplanned taskの存在を混同しない。staleでも計画値は返し、鮮度を別fieldで明示する。
- ControlのDecision evidenceに使った文書を追記更新しない。公開結果は別evidence／Decisionへ固定する。
- 既存のdirty dependency symlinkをrelease commitへ含めない。

## F／A／H

- F: start返却契約、構造source identity、完了gate非退行の裁定。
- A: projection実装、focused test、文書・version更新。
- H: npm publishとglobal runtime更新。Lattice通常releaseの恒久承認（2026-08-12）を使用する。

