# structure artifactの診断とcanonical復旧

## 目的

structure artifactがpretty JSON、trailing bytes、truncated JSON、schema invalidになった時、
`lattice status`と`todo verify`が問題のplan、path、reasonをtypedに返し、利用者が正規の
`structure input` writerで復旧できるようにする。

## 利用者が得る機能

壊れたartifactをgenericな成功やgenericなverify案内へ丸めず、どのplanの何が不正かと、
復旧に使う次のcommandを得られる。利用者または操作AIが正しいlogical input refを明示すると、
既存writerがcanonical 1-line+LFでartifactを書き直す。

## 最小実装

- status／verifyのartifact読取失敗を、plan、artifact path、parseまたはschemaのreason付きで返す。
- 復旧には既存の`structure input` writerを使う。自動的な入力推測、provenance探索、
  repair専用writer、別の復旧台帳は作らない。
- この修理のためにgenericな全store検査や自動healを追加しない。

## 受入条件

1. pretty JSON、trailing bytes、truncated JSON、schema invalidの各fixtureでgeneric成功を返さない。
2. 結果にplan、artifact path、reason、`structure input`を使う次のcommandが含まれる。
3. 明示した正しいinput refを適用するとcanonical 1-line+LFへ復旧できる。
4. 適用時は指定したplanの対象artifactだけを変更する。

変更に直結するfocused test、作業者自身の監査、最終試験結果の記録、利用面までの配布は本工程の完遂へ含め、
別の試験、監査、release工程は追加しない。

## 対象外

- AIによるlogical inputの推測。
- 直接JSON編集やgenericな全体repair。
- Peertableのroomや公開処理の変更。
