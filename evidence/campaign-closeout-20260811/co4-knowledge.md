# co4-knowledge 実施記録

- 還流先: private caveat `entry-20260811-50e3df`
  (`/Users/kite/.caveat/own/entries/lattice/entry-20260811-50e3df.md`)
- 題: 同じ概念を複数経路で再計算すると、各経路が正しくても契約が分裂する
- 対象の実例:
  - ADR 0165: dashboard daemon が配信する集合と hub heartbeat が名乗る集合の二重定義
  - ADR 0166: split persistence state を診断する経路と復旧する経路の契約不一致
  - witness set: `readWitnessSetInput` と `readTodoWitnessSet` の canonical bytes 契約不一致

## 検証

`caveat_search` で類似記録がないことを確認してから一件に統合した。記録には、唯一の情報源／唯一の正規writerへ収束させ、消費側が再計算しないことを対処として明記した。
