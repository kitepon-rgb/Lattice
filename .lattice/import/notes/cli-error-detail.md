## 背景

現行errorは`schema_invalid`等へ情報を畳み、AIが期待値と対象を推測している。

## 実装方針

- JSON Pointer、violation kind、expected/actual、task IDをbounded detailへ載せる。
- digest mismatchは期待digest、unsorted collectionは期待sort key、freshnessは現在時刻と許容skew窓を返す。
- repo外input、unknown subcommand、invalid argumentsを別codeへ分ける。
- write pathの`evidence_unverified`へplan/task IDと正規の検証commandを付ける。
- 秘密、ファイル本文、ローカル絶対pathを不要に返さない。

## 受入

代表的fixtureのerror detailだけで次の修正が一意に分かる。
