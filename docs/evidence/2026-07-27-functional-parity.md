# 2026-07-27 functional-parity — 実行時変換レーンを本番から到達可能にし、CLI表面を確認する

Decision: [ADR 0141](../adr/0141-resume-base-carries-the-transform.md)

## 直した機能不全

**変換の中身は動くのに、実運転からそこへ行く道が無かった。** `resolveRuntimeSeamTreatment`——
観測した競合をその場で変換して解消する、請求項8の一手——の呼び出し元はtestだけだった。実運転側が
使う`routeConflictTreatment`は「事前宣言済みtreatmentがpathを覆う時だけ`seam_transform`、それ以外は
常に`intentional_serial`」なので、予期しなかった競合は変換にかからない。壊れて止まるのではなく
直列へ退化するだけなので、runは緑のまま進み、欠落が表に出なかった。

## fp-001 — 実行時変換レーンに本番の入口を作る

`lattice run seam resolve --run <ref> --finding <digest> --input <request.json>`。
[src/runtime-seam-resolve.mjs](../../src/runtime-seam-resolve.mjs)。

入力（`lattice.runtime_seam_request.v1`）へ書くのは、係争fileの中で各TODOが触るsymbol、新しい面の
名前、後継planへ渡すtask migrationのdigestだけ。どれもAIが既に持っている情報である。実行時witnessは
`concern_anchors`を持たない（係争資源の中のどのsymbolを触るかは実行時に確定する情報で、run開始時点の
契約に書けるものではない）ので、宣言から足してtodo witness set v3を組む。

Latticeが供給するのは、構造観測、隔離実行、五条件の検証、変換の確定と記録に限る。推定しない。

検証: `test/runtime-seam-resolve.test.mjs` 15 pass（宣言の受理／拒否、witness合成、別epoch findingの拒否）。

## fp-002 — 後継baseが変換を含むことを検証する

`mode: 'seam_split'`の再計画requestは、**変換を含まないbaseを指していても通っていた**。splitは新しい
面の所有を宣言するのに、compileされる後継treeにそのfileが無い——rb工程で直したのと同じ欠陥が管理
runtimeの層に残っていた。

`verifySeamSplitSuccessor`が3つを見る。baseが前進し旧baseの子孫であること、splitが消えると述べた
競合辺が後継planに実際に無いこと、新たに所有すると述べた資源が後継requestでcreationとして宣言されて
いないこと。満たさなければ`SEAM_SPLIT_UNPROVEN`で止める。どれも手元のartifactだけで判定でき、
推定を含まない。

## fp-003 — 実CLIで観測から再開まで通す

[test/integration/runtime-seam-resolve-cli.integration.mjs](../../test/integration/runtime-seam-resolve-cli.integration.mjs)。
実repository・実sensor・実CLI processで、`run start` → managed activate → checkpoint観測 →
finding記録 → `run seam resolve` まで。**事前宣言されたtreatmentは無い。** 返った
`successor_base_sha`へworktreeを張ると`src/page-left.mjs`／`src/page-style.mjs`が実在し、
canonical branchと`HEAD`は動いていない。

## fp-004/005 — CLI表面の機能確認

[scripts/verify-cli-surface.mjs](../../scripts/verify-cli-surface.mjs)。出荷54コマンドについて、
`--help`が本文を返すかと、CLI入口を通るtestがそのtoken列を実際に渡しているかを見る。

初回の結果は**未収載10件・未確認5件**。

- 未収載: `run activate`／`conflict`／`hold`／`recompile`／`reprocess`／`finding record`／
  `seam resolve`、`todo migrate`、`status`、`session-context`。存在するのに使い方を知る手段が
  無かった。usageを足し、namespaceを持たない1語コマンドが`SUBCOMMAND_USAGE`へ落ちるようにした。
- 未確認: `runtime-errors resolve`／`reopen`／`compact`（実binaryで、実エラーを1件記録して
  fingerprintを解決する経路まで）、`todo bindings`、`bridge register`（bridge無効時の拒否と
  registrar未設定時の`not_configured`）。

`npm run check:cli-surface`としてciへ入れた。現在54コマンドすべてgreen。

## fp-006 — 確認で見つかった問題の修正

**死んだ引数。** `recompileNextEpochPlan`の`successorBaseSha`は呼び出し元もtestもゼロだった。管理
runtimeでは後継planを`compileFromRepo`が実repositoryから作り、`resolveRepoBinding`が`repo HEAD ===
request.repo.base_sha`を要求するので、baseを決めているのは後継requestであって、pure coreの引数では
ない。渡しても効かない。除去し、ADR 0141へ実際の責務分担を書き直した。

**生NULバイト。** `src/seam-apply.mjs`と`src/seam-commit.mjs`が区切り文字として生のNULバイトを
含んでいた。1つ入るだけで`git diff`は`Binary files differ`になり、`grep`はそのfileを黙ってskipする。
この2本は、動くのにreviewもcodebase検索もできない状態でcommitされていた（到達可能性の監査で
実際に誤った結論が出た）。escape sequenceへ置き換え、`check-syntax`で制御文字を拒むようにした。
意図的にNULを入れたfileでgateがexit 1になることを確認済み。

**syntax gateの穴。** `npm run check`は`package.json`への手書き列挙で、src配下108本のうち53本が
未収載だった。directory走査へ変え、62本 → 121本。

## 実施しなかったもの

`write-coverage`の**wc-002（I/O検知の採否裁定）**。着手の発火条件を「holdで捨てた作業量を実測し、
checkpoint間隔を詰めても割に合わないと分かった時」と明文化してある。実運用の測定が前提で、
いま実施できる作業ではない。

## gate

- `npm test`: 1038 pass / 0 fail
- `npm run ci`: 完全gate green（sensor側 2192 pass / 37 skip 含む）
- `npm run check`: 121 files
- `npm run check:cli-surface`: 54 commands, 未収載0・未確認0
