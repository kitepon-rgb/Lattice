# 構造artifact canonical復旧修理計画

## 目的

構造artifactがpretty JSON、trailing bytes、truncated JSON、schema invalidになった時、
`lattice status` と `verify` がgenericな成功・`todo verify`へ丸めず、offending path・plan・reasonをtypedに返す。
登録済みlogical inputのprovenanceが安全に一意なら、正規writerで復旧するdry-run+rewrite commandを返し、
入力が一意でなければ再指定を要求する。

## 対象工程

- plan/task: `structure-artifact-canonical-repair-20260812/sar-01`
- 前提: `structure-provenance-repair-20260812/spr-01`
- spr-01の実装・監査待ちはこの計画の着手条件であり、spr-01をこの計画で完了扱いにしない。

## 処理契約

入力はinvalid artifact bytes、structure source/input provenance、plan identityとする。structure source自身も検証対象に含め、
canonical 1-line+LF、JSON parse、schema、trailing bytes、truncated inputをpath付きで診断する。
安全なlogical input refが一意な場合だけ、正規の`structure input` writerによるdry-runとatomic rewrite commandをtyped receiptへ返す。
一意でない場合は入力refの再指定を要求し、無変更で停止する。直接編集やgeneric `todo verify`成功を解決としない。

## 受入条件

1. pretty JSON、trailing bytes、truncated JSON、schema invalidの各fixtureで、誤ったgeneric成功を返さない。
2. 正しいpretty inputは`structure input`のcanonicalize経路で復旧できる。
3. dry-runは無変更で、rewriteはcanonical 1-line+LFをatomicに書き、repairable/unrepairableとreceiptをtypedに返す。
4. offending path・plan・reason・安全な入力refまたは再指定要求・次のcommandをstatus/verifyへ表示する。
5. 他plan、他task、Lattice store、未対象artifactを変更しない。
6. `spr-01 → sar-01` の明示hard dependencyを正本へ登録し、spr-01後の工程としてfrontierに反映する。

## 非対象

AIによる入力推測、直接JSON編集、genericな全体verifyの成功扱い、spr-01の実装変更、Peertable roomや公開物の変更は行わない。
