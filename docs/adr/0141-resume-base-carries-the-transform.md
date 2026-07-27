# ADR 0141 — 再開先は変換を含むbaseでなければならない

- Status: Accepted
- Date: 2026-07-27
- Relates: [ADR 0064](0064-runtime-hold-public-bridge.md)（hold／carry-over／再計画）・
  [ADR 0137](0137-real-transform-acceptance-contract.md)（変換の受入契約）・
  [ADR 0139](0139-worktree-local-commit-is-permitted.md)（worktree内commitと観測）

## Context

実行時のseam_transformレーンが整合していなかった。競合を観測し、隔離worktreeで変換し、五条件を
通して`runtime_seam_split`を組むところまでは動く。しかし：

- 変換した成果を**どこにも着地させていなかった**。静的側は`land`が本ツリーへ書くが、実行時側は
  `files`を返すだけで誰も使っていない。
- **後継planのbaseが前進しなかった**。`recompileNextEpochPlan`は`base_sha: plan.base_sha`を渡し、
  redispatch packetは`buildExecutorPackets({ plan: newPlan })`経由でそれを引き継ぐ。

結果、splitは「`T1`は`src/page-left.mjs`を所有する」と述べるのに、再開したworkerのworktreeは
変換前のbaseであり、**そのfileが存在しない**。請求項8は「競合の解消後に二つの作業を再開させる」
まで述べており、再開が成立していなかった。

素のhold／carry-overレーンは機能不全ではない。carry-over witnessが非重複を証明しているので、
止めた側と継続する側の成果は互いに素なdiffとして合成でき、baseが前進しなくても壊れない。
壊れるのは**変換でsourceの構造が変わる**seam_transformレーンだけである。

## Decision

### 1. 採用された変換をcommitとして確定する

canonical branchへは出さない。使い捨てworktreeをbaseへ張り、変換後のfileを書き、detached HEADで
commitし、`refs/lattice/seam/<candidate_id>`へ繋いでからworktreeを畳む。

commit objectはobject DBを共有するのでworktreeを消してもshaは生き残るが、refが無いとGCの対象に
なる。branch名前空間（`refs/heads/`）へは置かないので、通常のbranch一覧には現れない。
branchは動かず外部へ効果を出さないまま、worktreeを張れる実在のcommitになる（ADR 0139と同じ理由）。

**変換で1 byteも変わらなかったなら確定しない。** 空commitで「進んだ」ように見せない。

### 2. 後継baseは後継requestが決め、Latticeはそれを検証する

当初は`recompileNextEpochPlan`へ`successorBaseSha`を渡して新planの`base_sha`を進める形にした。
**これは管理runtimeでは効かない。** 後継planは`compileFromRepo`が実repositoryから作り、
`resolveRepoBinding`が`repo HEAD === request.repo.base_sha`を要求する。baseを決めているのは
後継run requestであって、pure coreの引数ではない。渡された`successorBaseSha`は誰にも使われず、
testも無い死んだ引数として残っていたので除去した。

したがって責務はこう分かれる。branchを確定commitへ進めるのは操作するAI——静的側の`land`と
同じ分担である。Latticeが持つのは、**後継baseが本当に変換を含むかの検査**である
（`verifySeamSplitSuccessor`）。`mode: 'seam_split'`の再計画requestに対して3つを見る:

1. baseが前進し、かつ旧baseの子孫であること。変換が着地していなければ前進しない。
2. splitが「消える」と述べた競合辺が、後継planに実際に無いこと。後継treeに変換が載って
   いなければ両TODOは同じfileを書き続けるので、この辺は消えない。
3. splitが新たに所有すると述べた資源が、後継requestで**creationとして宣言されていない**こと。
   seam splitは既存codeを移す操作であり、変換が既にfileを作っている。

**carry-over側のrebind packetは触らない。** rebindはcontent不変が要件であり、継続する作業は
自分のworktreeで走り続けている。baseを付け替える対象ではない。

### 3. 確定できないなら採用しない

実行時の処置決定は、確定する手段が渡されていない場合と、確定に失敗した場合を意図的直列へ送る。
「変換した」と言いながら再開できない状態を作らない。

### 4. 変換へ行く道を製品の表面に出す

確定と検証が揃っても、**実運転からそこへ行く入口が無ければ何も起きない。** 実運転側は
`routeConflictTreatment`を使い、これは事前宣言済みtreatmentがpathを覆う時だけ`seam_transform`を
返すので、予期しなかった競合は変換にかからず直列へ退化していた。

`lattice run seam resolve --run <ref> --finding <digest> --input <request.json>`を入口とする。
入力（`lattice.runtime_seam_request.v1`）へ書くのは、係争fileの中で各TODOが触るsymbol、
新しい面の名前、後継planへ渡すtask migrationのdigestだけである。どれもAIが既に持っている情報で
あり、Latticeはそれを推定しない（AGENTS.md「装置の境界にAIを含める」）。

## Consequences

再開したworkerは、所有すると宣言されたfileが実在するworktreeで作業を始める。実測では、確定した
baseへworktreeを張ると`src/page-left.mjs`／`src/page-style.mjs`が存在し、旧baseには存在しない。
実CLI・実sensor・実repositoryで、事前宣言のない競合が変換され再開baseが返るところまで通る。

`refs/lattice/seam/*`が増える。branch一覧には出ないが、`for-each-ref`には出るので、
本repositoryのfingerprint（ADR 0140）は変換の確定を「変化」として観測する。確定は隔離実行の
**外側**で行うため、隔離runner自身の不変検査には当たらない。

## Open questions

1. **確定したseam commitの寿命。** `refs/lattice/seam/*`をいつ掃除するかを決めていない。
   runが閉じた後も残り続ける。
2. **複数の変換が連続した場合の連鎖。** 2回目の変換は1回目のcommitをbaseにすべきだが、
   現在は呼び出し側が`baseSha`を渡す形なので、連鎖の管理は呼び出し側にある。
