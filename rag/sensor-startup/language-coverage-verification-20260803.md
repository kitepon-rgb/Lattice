# sensor言語カバレッジ検証 — upstream 49c11fc取り込み後（2026-08-03・本機実測）

オーナー指示「解釈機能の不足を検証、不足なら作る」への答え。結論は**作るべき不足は無い**。
根拠と範囲を以下に固定する。

## 測定方法

41言語（`LANGUAGES`型の名目対応から`unknown`を除く全て）に対し、同一構造のサンプル
——`f`を定義し`g`が`f`を呼ぶ——を1ファイルずつ用意し、`lattice sensor init`で索引した
SQLiteを直接読んだ。数えたのは (1) file以外のシンボル数 (2) calls/references/invokes/
imports/extends の依存辺数。測定treeは upstream 04ab45c..49c11fc 取り込み済みの
sensor（EXTRACTION_VERSION 26・kernel ABI v3）。

同一サンプルを取り込み前（0.43.0相当）でも測定しており、**カバレッジは取り込み前後で
同一**。取り込みによる退行は無い（一度cfmlの退行に見えた差はprobeディレクトリの
二重コピーによる計測汚れで、作り直して消えた）。

## 結果

| 区分 | 言語 |
|---|---|
| 依存辺まで動作（33） | typescript javascript tsx jsx arkts python go rust java c cpp csharp php ruby swift kotlin dart svelte vue astro pascal scala lua luau objc r solidity nix cobol vbnet erlang terraform cfml |
| シンボルのみ（2） | liquid(3) razor(1) |
| ファイルノードのみ（4） | yaml xml properties twig |
| 索引されず（1） | cfquery（`.cfquery`単独ファイル。実運用ではcfm内タグであり、単独拡張子の実在自体が疑わしい） |

深さ（継承・型参照・言語固有構文）は、この10行サンプルでは測っていない。その担保は
取り込んだupstreamのtorture fixture群が持つ——kernel parity 13ファイル・143テストが
言語ごとの深い構文（デコレータ、レシーバQN、値参照、fn-ref、CRLF、店舗collection等）を
native/wasm両腕で固定しており、全green。

## 「不足なら作る」の裁定

1. **33言語: 不足なし。** 依存グラフまで動き、深さはtorture群がgreenで担保。
2. **yaml/xml/properties/twig: 作らない（意図的）。** 関数・呼び出しという概念が無い言語で、
   共通ウォーカーの枠に埋める欄が無い。ファイルノードは索引されるので、Latticeの
   境界競合検知（path単位）はこれらのファイルにも機能する。ジョブ依存（CI yaml）や
   bean参照（Spring xml）を辺にする専用抽出器は「作れば価値がある」が、Latticeの
   TODO境界判定に現在その需要が無い。需要が生じた時に個別に起こす。
3. **razor/liquid: 現時点で作らない。** upstream自身が移植計画でT3（テンプレート系）を
   「may stay TS forever (fine)」と裁定している。最低限のシンボルは出ており、
   ファイル境界の検知は機能する。
4. **cfquery: 非問題。** サンプルの作りが不自然（単独`.cfquery`ファイル）。cfm内の
   cfqueryタグはcfml-extractorが処理する。

## native kernel（速い方）の現在地

wasm 41言語名目のうち、nativeは**20言語**（typescript tsx javascript jsx java python
go c cpp rust csharp ruby php swift kotlin r lua luau scala dart）。これはupstreamの
移植成果の全量であり、貰える分は全部取り込んだ上でLattice独自機能（extentStartLine・
動的import/require・spawn invokes・value-refフィルタ緩和）を全20言語分へ追従させ、
parityで一致を証明済み。残り21言語のnative化はupstreamに存在しないため「貰う」対象が
無く、作るなら新規開発になる（upstreamはテンプレート系を永久にTSのままと宣言）。

以後の増分は `npm run upstream:check`（週次Actions）が新しいkernel言語・wasm extractorを
名指しで検知し、AGENTS.mdの規範（増えたら取り込み＋Lattice機能追従＋parity green）が適用される。
