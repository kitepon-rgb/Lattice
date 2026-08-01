## 背景

AIがToDoを読む正規入口は`todo show`と`todo start`である。ここで設計メモが自動供給されなければ、storeに保存しても再調査が必要になる。

## 実装方針

- show/start resultのversioned schemaへ`design_memo`を追加する。
- 初期設計メモとappend-only task noteを別fieldで返し、来歴と用途を混同しない。
- start失敗時にも設計メモ欠落の修正方法を案内するが、開始eventは書かない。
- legacy欠落はnullへ黙って丸めず、`missing_legacy_design_memo`として明示する。

## 受入

AIが単一のshow/start応答だけで背景、方針、受入条件、後続noteを読める。
