# RC1-I single boundary compiler acceptance evidence

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v4` / RC1-I
- Control: `lattice-rc1-closed-loop-v3` / `RC1-I-single-boundary-compiler-v4`
- predecessor: [ADR 0017](../adr/0017-rc1-v4-identifiability-safety-net.md)
- Decision: [ADR 0018](../adr/0018-rc1-v4-single-compiler-accepted.md)
- classification: F。boundary semantics、測定器identity、success predicateを親が直轄した。

## Accepted result

`compileBoundaryCondition`をcontrol／treatment共通の唯一のRC1 v4測定入口として実装した。入力にcondition selectorを
持たず、同じplan input、candidate spec v2、query set v2、manual evidence、capacityから、snapshotごとのexact graph
outcomeだけでcurrent／proposed surfaceを選ぶ。query receiptはID、operation、順序に加えてtargetまたはaffected target列まで
query setへ拘束し、別targetのreceiptを付け替えた入力をrejectする。

固定unit evidenceで得た導出は次のとおり。

| condition | production／test write conflict | manual conflict | unknown | verdict | minimum waves |
|---|---:|---:|---:|---|---:|
| control normal | 3（shared source path、shared test path、shared symbol） | 0 | 0 | `seam_candidate` | 2 |
| treatment normal | 0 | 0 | 0 | `parallel_ready` | 1 |
| treatment negative | 0 | 1 state | 0 | `intentional_serial` | 2 |
| partial／fuzzy proposed resolution | currentの3に加えdynamic unknown | 0 | 1 | `unknown_requires_evidence` | 2 |

この数値はcompiler inputやcondition branchに期待値として与えていない。各TODOのproduction symbol／pathとfuture test
symbol／pathをwrite resourceへ展開し、pairwise intersectionからconflictを生成した結果である。manual state、effect、unknownは
別provenanceのまま同じmanifest／verdict／planへ合成する。

`evaluateRc1Hypothesis`はcomparison artifactの自己申告resultを参照せず、schema、compiler identity、fixed inputs、control
conflict、future test-write、treatment parallelism、unknown、hard precedence、negative state、black-box behavior、portable
preimage、sanitized diagnostic、predecessor、version barrier、source invariantの15条件を明示的なtruth tableへする。旧v3の
`supported_in_fixture` artifactは、v4必須fieldが欠けるためfail closedになる。

## Codegraph before／after

source編集前のplanned symbolは[RC1 v4 correction preflight](2026-07-15-rc1-v4-correction-preflight.md)で
`new_surface_unknown`だった。実装後のindexはCodegraph 1.4.1、30 files、539 nodes、2,187 edges、pending changes／refs 0、
worktree mismatchなし、reindex recommendationなし。

| exported symbol | exact owner | callers | callees | impact nodes | affected tests |
|---|---|---:|---:|---:|---|
| `compileBoundaryCondition` | `src/boundary-compiler.mjs` | 3 | 20 | 6 | `test/boundary-compiler.test.mjs`、`test/rc1-v4-characterization.test.mjs` |
| `evaluateRc1Hypothesis` | `src/rc1-comparison.mjs` | 2 | 6 | 3 | `test/rc1-comparison.test.mjs`、`test/rc1-v4-characterization.test.mjs` |

private `repoPath`と`assertCodegraphEvidence`は旧compilerにも同名symbolがあるため、名前だけの`callers`／`callees`／`impact`は
複数ownerを混ぜる。空結果や依存なしへ丸めず、exact queryの`filePath`、exported entryからのcall trail、path指定affectedを
併用した。`compileBoundaryCondition`のimpactには共有contract経由のlegacy control／portability testも現れた一方、path指定
affectedは上表の2件だった。この差もunknownを消さず、RC1-Lのfresh integrationで再観測する。

## Gates

- H characterization: single compiler、shared future test write、complete predicateの4対象testが実装前にred。
- focused: compiler／comparison unit 8 pass / 0 fail / 0 skip。
- focused correction: query receipt target付替え／affected target並替えのreject 1 pass / 0 fail / 0 skip。
- related final: compiler、comparison、HのI-owned characterization 13 pass / 0 fail / 0 skip。
- `git diff --check`: pass。
- full `npm run ci`: source収束後のRC1-Mへ集約したため未実行。

## Accepted identity

| path | SHA-256 |
|---|---|
| `src/boundary-compiler.mjs` | `5b4f4272e396b6e257ab0bfd4997382dddae9eb38cc19a0bf707d7ae8017e733` |
| `src/rc1-comparison.mjs` | `dcc7a37f2d817449ac2b09a13cdd444d71b80fdd8286c79d00ff068eef7be3ed` |
| `test/boundary-compiler.test.mjs` | `fda1877d7164086fb03a918065704d035bab5db932320487c53dacfc1dc81da3` |
| `test/rc1-comparison.test.mjs` | `673b7efc5db743ebdf1bd91f1731b52f8be1c48bbdd4e61ebdeded7766530d12` |

## Parent audit and residual boundary

- condition selector、expected conflict count、self-reported supportを測定入口から排除した。
- exact／absent以外のsurface resolutionはtyped dynamic unknownへ落ち、parallel-readyへ進まない。
- test writeは実行対象だけでなくowned write resourceとしてmanifestへ入る。
- query receiptのtarget binding欠落を軽量監査で発見し、関連gate前に修正した。NUL path検証については出力escapeを
  二重文字列と誤読したが、実バイト確認で正しいJSのNUL escape（backslash＋`0`）と判明し、source変更は行っていない。
- ここでacceptしたのは測定器機構であり、実fixtureのfresh control／treatment、挙動不変transform、portable preimage、
  source invariant、H1-v4の支持はまだacceptしていない。これらはRC1-J／K／L／Mのgateに残る。
- dotagents／Observer関連repoはread-onlyのまま、remote作成、push、publishは行っていない。
