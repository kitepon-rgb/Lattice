# ADR 0028: RC1 v5のPhase supportをoracle・snapshot・predecessor非識別でrejectする

- 状態: Accepted
- 日付: 2026-07-16
- 対象plan: `lattice-research-campaign-1-v5` / RC1-R
- 対象Control: `lattice-rc1-closed-loop-v3`
- supersedes: ADR 0027のPhase受入候補と`hypothesis_evaluation.supported=true`の研究結論
- retains: ADR 0023〜0027で受理したfull receipt、behavior envelope、accepted seam、2+2 reindex、single compiler、
  negative control、source invariant、immutable artifactのmechanism evidence
- evidence: [RC1 v5 Phase gate](../evidence/2026-07-16-rc1-v5-phase-gate.md)

## Context

ADR 0027は、固定Lattice baseに対してcontrol／treatment各2 fresh Codegraph run、accepted production＋test seam、
pre／post oracle、normal／negative compile、v5 plan diff、32 payloadのimmutable artifactを発行した。full verifierは保存rawを
同じcompilerへ8回replayし、12 checkと15 hypothesis conditionを通した。

RC1-Rはこの結果をPhase-level supportへ昇格する前に、full CI、独立refuter、Critic、親の依存digest再封印実験を実施した。
その結果、v5 verifierが保存artifactの内部整合は検査しても、主張対象の実体へ一意に帰属できない経路が再現した。

## Decision

### 1. v5のPhase-level machine supportをrejectする

`research/campaigns/rc1/artifacts/v5/hypothesis-evaluation.json`の`supported=true`をRC1の研究結論として採用しない。
理由は次の3件のP1である。

1. **oracle semantics非識別:** `input_identity`は保存oracleを検証するが、behavior receiptの`oracle_digest`をその保存oracleの
   digestへ比較しない。case validatorもID、kind、digest形式、outcome flagだけを検査し、保存oracleのcase集合、順序、expected kind／
   digest、`expected_digest === observed_digest`を再計算しない。親がpre／post両receiptを別oracle digestへ変え、またはpassed caseの
   observed digestをexpectedと異なる値へ変え、receiptからmanifestまで全依存digestを再封印してもfull verifierは全checkを通した。
2. **Codegraph snapshot非識別:** execution runは64桁の`code_snapshot_digest`を保持するが、そのtyped preimageをartifactへ保存せず、
   verifierは自己申告digestをcompilerへ再注入する。raw Codegraph evidence、snapshot、base／transform outputは同一bundleでcross-bind
   されないため、別snapshot由来のraw evidenceと任意snapshot digestを組み合わせた世界をartifact-onlyに排除できない。
3. **plan predecessor非識別:** v5 planの成功条件13はaccepted transform、behavior envelope、evidence bundleをnew plan predecessorに
   要求するが、保存`plan-diff.json`のcausal predecessorはv4 plan version、Decision ref、statusの固定文字列だけである。
   transformは別blockにあるが、behavior envelope、4 evidence bundle、v4 archive／失効contextの実bytes digestはpredecessor集合にない。

これらは実runnerが別oracleを使った、Codegraphを実行しなかった、またはseamを適用しなかったという主張ではない。
「正しい実体を観測した世界」と「別実体の自己整合chain」を保存artifactだけで区別できず、H0-b／H0-c／H0-dを排除できないという
実験設計上の非識別である。

### 2. Codegraph identityとoracle runtime identityをv6の固定条件へ昇格する

canonical v5の4 runは全てCodegraph 1.4.1であり、この事実単体は反証されない。しかしversion／executable identityはfixed inputと
cross-condition predicateへ含まれず、条件間driftを将来artifactでrejectできない。v6はCodegraph versionと実行identityを全run、
evidence、comparison、executionへ固定する。

またv5のfresh Workerは親の`execArgv`を暗黙継承し、実際に`--input-type`継承で初回canonical runがoracle実行前にrejectされた。
成功runの挙動を直接反証しないが、Node version、runtime flags、oracle executor source digestがreceiptにないためexact observation identityを
再現できない。v6はWorker flags／必要envを明示固定し、runtime identityを保存する。

### 3. full CIの3 failureを製品findingから分離してtest harnessを修正する

full `npm run ci`は`90 tests / 87 pass / 3 fail / 0 skip`だった。単独再実行ではcontrol portabilityとtreatment recompileがgreen、
v4 campaign integrationだけがimmutable artifact rootの既存在でredになった。

前2件は並列testがcanonical repo全体のworktree集合をexact比較し、別testが正当に所有するtemporary worktreeを漏れと誤認する。
後1件はwriterの上書き拒否が正しくなった後もcanonical v4 rootへ再発行している。製品sourceを緩めず、各integrationを専用cloneへ
隔離し、canonical repoはHEAD／tracked status不変だけを検査する。full gateはv6 source収束後に一回だけ再実行する。

### 4. v5 mechanism evidenceを保持し、immutable v6へ再発行する

次は本Decisionで反証されないため、v5 source、artifact、ADRを削除・上書きしない。

- controlのproduction＋test shared writes、treatmentの0 shared writes、negative state serialは保存compiled artifactから再計算できる。
- accepted transformは隔離worktreeでproduction＋test seamを作り、scope外oracleをpre／postに実行した。
- control／treatment各2 runのraw／portable evidence、sanitized diagnostic、source invariant、cleanupは保存されている。
- same compiler replay、patch、transform output、manifest byte hashの機構は成立する。

active planを`lattice-research-campaign-1-v6`へ全再compileする。v6はoracle exact case、runtime identity、snapshot preimage、
Codegraph identity、raw evidence、accepted transform output、digest付きplan predecessorを一つのartifact chainへ結ぶ。v5 rootは上書きせず、
全conditionを`artifacts/v6`へ新規発行する。

## Rejected alternatives

- **canonical runが実際にgreenなのでv5をacceptする:** 実行経路の目視はartifact-only識別性の代わりにならない。
- **receiptと保存oracleに同じdigest fieldがあるので十分とする:** 両者を比較するpredicateがなく、別digestへchain全体を再封印できる。
- **case outcome flagを信頼する:** expected／observed不一致でもpassedを保持でき、behavior failureをgreenへ丸める。
- **snapshot digestだけを追加検査する:** preimageとbase／transform projectionがなければ任意digestの形式検査に留まる。
- **predecessorを文字列refで表す:** ref先bytesの差替えと実behavior／evidence predecessorの欠落を検出できない。
- **full CIのworktree assertionを削除する:** leak検査を失う。専用clone内の所有worktree集合をexact比較する。
- **immutable writerの上書き拒否を緩める:** evidence identityを破壊する。空のclone artifact rootを使う。
- **Observer dogfoodへ進む:** 内的妥当性の欠落を外部fixtureで埋めると交絡を増やす。

## Consequences

- v5 planをPhase-rejected archiveへ移し、active planをv6へ更新する。
- ADR 0027はRC1-Q時点のimmutable mechanism受入記録として残るが、Phase-level supportは本ADRが上書きする。
- v6はtest harness correction、causal-binding characterization、oracle／runtime、snapshot／Codegraph identity、artifact chain、
  immutable reissue、Phase gateの順で進める。
- full CIは既に一回失敗を記録したため、failure scopeのfocused testだけを使い、次のfull runは全v6 source収束後のPhase gateに限る。
- Latticeだけをwriter scopeとし、dotagents／Observer関連repoはread-only、remote作成・push・publishは禁止を維持する。
