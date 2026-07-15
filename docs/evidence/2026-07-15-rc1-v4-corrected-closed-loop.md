# RC1-L corrected closed loop acceptance evidence

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v4` / RC1-L
- Control: `lattice-rc1-closed-loop-v3` / `RC1-L-corrected-closed-loop-v4`
- predecessor: [ADR 0016](../adr/0016-rc1-v3-phase-gate-rejection.md)、[ADR 0017](../adr/0017-rc1-v4-identifiability-safety-net.md)、
  [ADR 0018](../adr/0018-rc1-v4-single-compiler-accepted.md)、[ADR 0019](../adr/0019-rc1-v4-production-test-seam-accepted.md)、
  [ADR 0020](../adr/0020-rc1-v4-evidence-preimage-accepted.md)
- Decision: [ADR 0021](../adr/0021-rc1-v4-corrected-closed-loop.md)
- classification: F。experiment identity、accepted predecessor、version barrier、machine predicate、causal comparisonを同時に固定する
  契約境界なので親が直轄した。

## Issued campaign

base SHA `44f9b1aa0d6b15938a3c6c934097d4f75a1744b2`から、次の順序でcorrected closed loopを一度発行した。

1. 別々のdetached disposable worktreeでcontrolを2回fresh `codegraph init .`し、fixed query set v2を全件収集した。
2. 2 runのportable preimage再現を確認し、同じ`compileBoundaryCondition`へnormal／shared-state negativeを入力した。
3. fixed production＋test 6 pathsだけを変更するtransformを一度発行し、black-box oracleのpre／post同値とsource invariantを通した。
4. accepted binary patchの同一byte列を、別々のtreatment worktreeへ各1回replayした。各worktreeをfresh indexし、controlと同じquery setを収集した。
5. treatment 2 runのportable preimage再現を確認し、同じcompilerへnormal／negativeを入力した。
6. comparison v2、15条件のhypothesis evaluation、v3→v4 plan diff、execution evidenceをcompileし、immutable artifact rootへ書いた。

campaign runnerはcondition selectorを受け取らず、control／treatmentともexport
`compileBoundaryCondition`、source digest
`5b4f4272e396b6e257ab0bfd4997382dddae9eb38cc19a0bf707d7ae8017e733`を使った。plan input、candidate spec、normal／negative
manual evidence、query set、capacity 2、behavior oracleのdigestは条件間で全て一致した。独立変数はaccepted production＋test seam patchの有無だけである。

## Actual Codegraph evidence

| run | fresh index files／nodes／edges | raw bytes | raw digest | portable digest |
|---|---:|---:|---|---|
| control-1 | 39／752／2,890 | 16,929 | `2ead116fd9edc8ecfb226b6fee88609d42eae91dab6a67c859309a60898f6df3` | `a887e8b9a29274f72278d360d3ea31af6aeda4ba249423df168f3fb82afafdb8` |
| control-2 | 39／752／2,890 | 16,929 | `187d0474e74ea5e2ca7cd46a257085d3003698e6c212cebfec5a5606318fac71` | `a887e8b9a29274f72278d360d3ea31af6aeda4ba249423df168f3fb82afafdb8` |
| treatment-1 | 43／766／2,908 | 27,019 | `f0deebdc649e89dc8c72bf80d7ef85a2963b4defc07fbd7317e48244539a7815` | `285b3ed13d1b0ba750d20fbcc39fd571f3322f812b49637d3534e52521d4cda4` |
| treatment-2 | 43／766／2,908 | 27,019 | `f7bb9e2dc07c8fca8e4fc93ff3234a9bc897181d3662272d3f7edbd8ab4c584d` | `285b3ed13d1b0ba750d20fbcc39fd571f3322f812b49637d3534e52521d4cda4` |

raw receiptはtemp pathとindex telemetryを含むadapter evidenceのopaque preimageなので、fresh run間で違う。sanitized diagnostic digestと
portable digestは各condition内で一致した。validatorはraw base64をdecodeしてdiagnostic、full portable outcomes、per-query digest、aggregate
digestを再生成しているため、digest文字列だけの一致ではない。controlとtreatmentのportable digest差はaccepted patch後のgraph差を表す。

## Measured comparison

| metric | control normal | treatment normal | treatment negative |
|---|---:|---:|---:|
| verdict | `seam_candidate` | `parallel_ready` | `intentional_serial` |
| write conflicts | 3 | 0 | 0 |
| test-write conflicts | 1 | 0 | 0 |
| state conflicts | 0 | 0 | 1 |
| hard precedence | 0 | 0 | 0 |
| unknowns | 0 | 0 | 0 |
| minimum feasible waves | 2 | 1 | 2 |

seamはproductionとfuture TODO-owned testの共有writeを除いたが、negative controlのshared `dispatch-registry` state writeは除かなかった。
したがって「seamなら常に並列化する」測定器ではない。behavior oracleはcontrol／treatmentとも同じdigestでpassedし、transform receiptは
pre／post equivalentを記録した。

machine hypothesis predicateは次の15条件を全てtrueにした: schema、compiler identity、fixed inputs、control conflict、test-write
conflict、treatment parallel、unknown、hard precedence、negative state、behavior、portable preimage、sanitized diagnostic、accepted
predecessor、version barrier、source invariant。`supported=true`、failed conditionsは0である。この値はRC1-Mの独立反証前なので、
Phase-level final Decisionを先取りしない。

## Transform、version barrier、source invariant

- transform artifact digest: `cfe9898bbd72ea43dd314a9a69005de3957a4273a5a07600fe820caba15a685f`
- transform receipt digest: `722607c3ea92019116a4ed7f740df007f9e4429801779ca1fedee8d65b9fb000`
- accepted binary patch digest: `016e2e40a758b1588d9fe0daf8bb97027c5ae6c509ce9a77951a8ff3ccf1a307`
- control plan digest: `b96588d1687eba5da2576d98a71622b68f7f489d29ad46140114c38aff70a9b4`
- treatment plan digest: `304ba5780248b068d4afe9a16c0681c024d65b781e1e0c8fc02910eb94ef2453`
- plan diff digest: `96424c044713408b0d4a28de812a1e1e441b738c219fb7bea61330aa01a9df7a`

plan diffは`write-overlap-001`〜`003`を除去し、`channel-policy`と`label-policy`を変更nodeとして記録した。v3のold plan、agent
context、partial patch、`shared-test-is-run-only` interface assumptionを4種類のinvalidated contextへ固定し、v3 active topologyへ追記していない。

transform発行と4 index runは全て同じtyped source invariant digest
`c38c1c9cf0f6ddbbb6f9c12cadafde4c8eddcf6a8c0a82de071a6965e0a0cc19`を返した。HEAD、git-visible status、ignored path status、
`src/`／`test/` protected contentが開始／終了で一致した。canonical sourceへaccepted patchは適用していない。

## Fail-loud correction history

最初の実Lattice integration runはartifactを書き出す前に
`change outside allowed paths: .codegraph/.gitignore`で失敗した。実repoでは`.codegraph/.gitignore`が追跡済みbootstrapだが、temp fixtureには
存在せず、fresh index後のsensor cleanupが同fileまで削除していたためである。空結果やcleanup成功へ丸めず、artifact rootが未作成であることと
canonical worktree不変を確認した。

実repoと同じtracked bootstrapをfixtureへ追加したcharacterizationは0 pass / 1 failで同経路を再現した。source edit前Codegraphでは
`observeFreshIndex`のowner、caller、8 callees、impact 4 nodes、affected campaign testを確認し、新設helperはplanned unknownとした。
各disposable worktreeでbootstrap bytesをindex前に捕捉し、generated sensor state削除後に同じbytesだけを復元する修正後、focused testは
1 pass / 0 failになった。

post-indexは39 files、752 nodes、2,890 edges、pending 0、worktree mismatchなし。`captureCodegraphBootstrap`と
`restoreCodegraphBootstrap`はともにexact owner 1、caller `observeFreshIndex`、callee 0、impact 3 nodes、affected campaign test 1件だった。
修正はcommit `44f9b1a`としてrunner implementation commit `63c020c`から分離した。

## Artifact integrity and gates

artifact rootは`research/campaigns/rc1/artifacts/v4/`。manifest対象23 payloadとmanifest自身の計24 files、約584 KiBを保存した。
独立readbackでmanifest path集合と実payload集合が一致し、23件全てのbyte length／SHA-256一致、余剰payload 0を確認した。writerは既存rootを
上書きせず、unsafe run IDによるpath escapeもrejectする。

staged `git diff --check`は`transform/seam.patch`内の4行をtrailing whitespaceとして報告する。4行はいずれもunified diffが
「変更されない空行」を表す必須の先頭context marker 1 byteであり、sourceの空白混入ではない。artifact byte列を整形するとpatch digestと
exact replay契約を壊すため保持した。`seam.patch`を除くstaged全pathの`git diff --check`はpassし、同patchはtreatment 2 runでそれぞれ
`git apply --check`後にexact byte replay済みである。

- test-first combined: 3 pass / 2 fail。campaign module不在とfinal transform receiptのsource invariant不在を確認した。
- implementation focused: 実Codegraph未初期化worktreeへの`index`、large raw preimageのdigest descriptor境界をfail-loudに修正した。
- actual integration first attempt: tracked Codegraph bootstrap削除を検出して失敗。artifact 0件。
- bootstrap characterization red: 0 pass / 1 fail。
- bootstrap correction focused: 1 pass / 0 fail / 0 skip。
- actual corrected integration: 1 run success、15／15 checks、23 manifest payload、elapsed 16,858.173 ms。
- RC1-L related final: 27 pass / 0 fail / 0 skip。
- syntax: campaign runnerとactual integration entryの`node --check` pass。
- full `npm run ci`: RC1-Mのsource収束後Phase gateへ集約したため未実行。

## Accepted source identity and residual boundary

| path | SHA-256 |
|---|---|
| `src/rc1-v4-campaign.mjs` | `cb7575b9638c17cacea7f569a49ad78abbbfcc689ee3bd50a892216033076cf9` |
| `src/rc1-v4-transform.mjs` | `fb29b69ac81b1425105fcd3514e7f1ffc19f5da6fb641782af8041c6412c1f10` |
| `test/rc1-v4-campaign.test.mjs` | `8696e03463cad4384933e1c55f978aafce0e41acb42a4cf3050222091d69dfda` |
| `test/rc1-v4-transform.test.mjs` | `4ebf6dc16e7cc6ccf98212e7ab069139855bd1bd1f1ab9de617b72862a91ac3d` |
| `test/integration/rc1-v4-campaign.integration.mjs` | `dca936403e53e9d9d31565195b9befdfd2a08be16186ca0f0af0ec604828353e` |

- 実証はLattice内の固定1 fixture、capacity 2であり、任意repoの成功率や速度改善率を示さない。
- elapsedは1 machine上の1 campaign timingであり、scheduler性能比較には使わない。
- source invariantのrecursive content scopeは`src/`／`test/`で、全repo content invariantではない。
- actual multi-agent dispatch、Observer dogfood、dotagents統合は未実施である。
- RC1-MのP1 correction独立反証とfull CIが残る。machine `supported=true`を最終Phase acceptanceへ昇格していない。
- canonical worktreeと既存detached 2 worktreeだけを維持した。dotagents／Observer関連repoはread-only、remote作成、push、publishは行っていない。
