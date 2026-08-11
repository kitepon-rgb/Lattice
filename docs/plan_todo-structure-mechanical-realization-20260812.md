# ToDo構造realizationの定型配線を機械化する

日付: 2026-08-12
管理方法: Markdown ToDo（Lattice自身の修理なのでLattice工程管理は使わない）
対象版: `@quolu/lattice@0.58.4`

## 目的

構造付き工程の実装後、AIがfull realization envelopeを組み立てていた手作業を廃止する。
AIはplannedどおりか、異なるなら実体構造が何かだけを入力し、それ以外のGit・store・履歴metadataは
Latticeが生成して検証する。

## 成功条件

- `--planned`だけでplanned構造を現在HEADへrealizeできる。
- `--realized <file>`はbare transformだけを受け取り、envelopeを機械生成する。
- `--commit`省略時はHEADを使い、反復指定時は各refをfull commit OIDへ解決してcanonical sortする。
- 2回目以降はsequence、previous digest、supersedesを最新chainから生成する。
- identity、planned digest、actor、時刻、self digestをAIに書かせない。
- 不正transform、解決不能commit、重複commit、chain競合は追記前にtyped拒否する。
- 既存full realization `--input`と、done／finalization gateを維持する。

## 非目標

- 実体構造の意味をLatticeが推定すること。
- どのcommitを工程が所有するかを曖昧なmessageから推定すること。
- Git commit、todo done、terminal acceptをrealizeと同時に実行すること。

## 検証

- focused CLI／contract／help test。
- 実Git・実Sensorでcompile→start→実装commit→`--planned`→done→finalizeを一周するintegration test。
- 完全CI、pack、production audit、公開後global／bridge smoke。
