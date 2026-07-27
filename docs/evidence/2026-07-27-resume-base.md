# 2026-07-27 resume-base — 再開先が変換を含むbaseになった

Decision: [ADR 0141](../adr/0141-resume-base-carries-the-transform.md)

## 直した欠陥

実行時のseam_transformレーンは、競合を観測し隔離worktreeで変換し五条件を通して
`runtime_seam_split`を組むところまで動いていた。しかしその成果を**どこにも着地させず**、
後継planの`base_sha`も前進させていなかった。

結果、splitは「`T1`は`src/page-left.mjs`を所有する」と宣言するのに、再開したworkerの
worktreeにはそのfileが存在しない。請求項8の「解消後に二つの作業を再開させる」が成立して
いなかった。実測待ちでも裁定待ちでもない、配線されていないだけの欠陥である。

## rb-001 — 採用された変換をcommitとして確定する

`src/seam-commit.mjs`。`commitSeamTransform`は使い捨てworktreeをbaseへ張り、変換後のfileを
書き、detached HEADでcommitし、`refs/lattice/seam/<candidate_id>`へ繋いでからworktreeを畳む。

- canonical branchは動かない。`refs/heads/`へ触らないので通常のbranch一覧に現れない。
- refを張るのはGC対策。commit objectはworktreeを消しても残るが、refが無いと回収される。
- 変換で1 byteも変わらなかった場合は確定しない（空commitで「進んだ」ように見せない）。
- pathの安全検査（絶対path・`..`・`.git`配下）を通らないfileは受けない。

検証: `test/seam-commit.test.mjs` 3 pass。

## rb-002 — 後継planのbaseだけを前進させる

`src/runtime-hold-recompile.mjs`の`recompileNextEpochPlan`が任意の`successorBaseSha`を受け、
新planの`base_sha`をそこへ進める。redispatch packetは新planから作られるので自動で追従する。

carry-over側のrebind packetは触らない。rebindはcontent digest不変が要件であり、継続している
作業は自分のworktreeで走り続けているので、baseを付け替える対象ではない。

`src/runtime-seam-treatment.mjs`の`resolveRuntimeSeamTreatment`が`commitTransform`を受け、
`successor_base_sha`／`successor_base_ref`を返す。確定手段が渡されていない場合は
`committer_absent`、確定に失敗した場合は`transform_not_committed`で意図的直列へ送る——
「変換した」と言いながら再開できない状態を作らない。

検証: `test/runtime-seam-treatment.test.mjs` 8 pass（うち2つが上の2つの拒否経路）。

## rb-003 — 実git repositoryで再開まで通す

`test/integration/resume-base-carries-transform.integration.mjs`（1 pass）。
確定したcommitへworktreeを張ると`page-left.mjs`／`page-style.mjs`が実在し、旧base——
直す前の再開先——には存在しないことを、同じrepositoryの2つのworktreeで対比して示す。
確定commitはbaseの子孫であり、canonical HEADは動いていない。

`test/integration/runtime-seam-transform.integration.mjs`（実sensor・実repository）も、
観測→変換→split→**確定→再開**まで延長した。後継baseへ張ったworktreeに、splitが所有を
宣言した2つのpathが両方存在する。

## 併せて直したもの — syntax gateの穴

`npm run check`は`package.json`へfile名を手で並べる形だった。実測でsrc配下108本のうち
**53本が未収載**で、今回の新規fileも全部漏れていた。列挙を足すとまた漏れるので、
`scripts/check-syntax.mjs`でdirectoryを走査する形へ変えた。62本 → 119本。
`precheck`と`check:project-identity`は走査に吸収されたので畳んだ。

## gate

- `npm test`: 1020 pass / 0 fail
- `npm run ci`: 完全gate green（sensor側 2192 pass / 37 skip 含む）
- `npm run check`: 119 files
