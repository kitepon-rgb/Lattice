# RC4 Stage 0 — witness実測とCodegraph判定品質（batch b1・中間記録）

- Date: 2026-07-17
- batch定義: [2026-07-17-rc4-stage0-batch.md](2026-07-17-rc4-stage0-batch.md)（T1〜T6）
- target: dotagents clone（`73947b3`）on macOS ext4。正規repoへの書込ゼロ、`codegraph init`はclone上のみ
- 検証規律: 実測値のみ。丸め・事後推定なし。未達は未達と書く

## 1. witness作成コストの実測

| TODO | 系 | 作成時間 | 書けなかった項目 |
|---|---|---|---|
| T1 | control-record | 18秒 | 裁定依存のwrites（不変Decision上書き時のADR新設先）／正典↔実装の意味的結合 |
| T2 | control-record | 17秒 | 設計依存のwrites（bin整形で済むかlib shape変更まで要るか） |
| T3 | adapter（cross-repo） | 36秒 | **主要writesの全部**（ServerManager repo＝本repo境界の外） |
| T4 | adapter | 19秒 | H gate依存のdispatch可否／registry経由の間接結合 |
| T5+T6 | docs | 25秒（2件計） | **還流先の実体**（OpenCClaw repo）。call graph証拠ゼロ |
| — | drift調査＋import経路の実在検証 | **60秒** | — |

合計: 約3分（6 TODO）＋修正1周60秒。**初稿の作成自体は安価**（1件あたり17〜36秒）。
高いのは「初稿が通らなかった後の照合」であり、RC3の「witness作成が最重量」とは異なる内訳が出た。
ただしこれは**親が対象repoの実装を熟知している条件**での測定であり、一般化しない。

## 2. plan compileの結果（実測）

初回: `INVALID_RUN_REQUEST` — witnessのtyped形式違反（`resources`はidentifier列、`unknowns`は
`{kind, ref}`のexact record）。schema実読で修正。**契約は正しくfail closedした**。

2回目: `AFFECTED_TEST_DRIFT` — 非dispatchable。

## 3. 中核の発見: Codegraph `affected` の既定depthが過剰報告する

`lattice.run_request.v1`の`witness.affected_tests`は、Codegraph観測の`affectedTests`と
**exact一致**を要求する（[runtime-front-end.mjs:455-469](../../src/runtime-front-end.mjs)）。
そこで観測側の正しさを実測した。

### T1: `lib/orchestrate/control-record.mjs`

| 情報源 | 件数 | 内訳 |
|---|---|---|
| 親（私）の初稿宣言 | 1 | control-record.test.mjs のみ |
| **import経路の実在検証**（grep実測＝真値） | **4** | control-record / executor-contracts / placement-policy / worker-report-skeleton |
| Codegraph `depth=1` | 3 | 真陽性のみ。ただし**worker-report-skeletonを落とす＝偽陰性1** |
| Codegraph `depth=2` | 7 | |
| Codegraph `depth=3` | 11 | |
| **Codegraph `depth=5`（既定・Latticeが使う値）** | **12** | 真陽性4＋**偽陽性8** |

**どのdepthも真値4件を返さない。** depth=1は過少（偽陰性1）、depth=5は過剰（偽陽性8）。
ダイヤルに正解の位置が存在しない。

偽陽性8件の内訳と根拠:

- `tests/factory-scan/{v2,factory-scan,servermanager-adapter,runtime-errors,bughub-external-probe}.test.mjs`、
  `tests/factory-reporter/v2-contract.test.mjs`（6件）
  → **`lib/factory/`から`lib/orchestrate/`への参照は grep実測で0件**。import経路が存在しない。
  `lib/factory/v2.mjs`・`contract.mjs`のimportは`toolchain-contract.mjs`・`command.mjs`・`scan.mjs`と
  node標準のみ。
- `tests/orchestrate/{quota-adapter,quota-snapshot}.test.mjs`（2件）
  → `control-record`をimportしていない。

Codegraphの`affected`は README で「Traces import dependencies **transitively**」と定義されており、
co-change heuristicではない。したがってこれは意味論の相違ではなく**精度の欠損**である。
既定`--depth 5`のfan-out（`totalDependentsTraversed: 30`）が無関係testを巻き込む。

### depthでは直らない（2026-07-17訂正）

本文書の初版はここで「`depth=1`は真陽性のみ3件を返す＝改良の方向は既定depthの過剰を抑える／
depthを表現可能にすること」と結論した。**この結論は誤りであり撤回する**（オーナー指摘を受けて再測定）。

`depth=1`の3件は「真陽性のみ」だが「真陽性の全部」ではない——`worker-report-skeleton.test.mjs`
（`loadControl()`＝helpers経由の`import(CONTROL_LIB)`で実際にcontrol-recordを使う）を落とす。
すなわち**真値4件を返すdepthは存在しない**（1→3件で偽陰性、5→12件で偽陽性8）。

理由: グラフが**両方向に壊れている**。
- **余計な辺**: factory-scan系がcontrol-recordからdepth≤5で到達可能。import経路は実在しない＝
  存在してはならない辺がグラフにある。
- **欠けた辺**: `import(CONTROL_LIB)`（`join()`で計算されるパスの動的import）を解決しきれていない。

depthは大域的な閾値であり、**辺ごとの誤りを閾値で補正することは原理的にできない**。上げれば偽陽性、
下げれば偽陰性が出る。したがってLattice側にdepth表現を足す案（初版の含意）は回避策ですらなく
**機能しない**——depth=1を渡せば、正しい4件のwitnessに対して逆方向のdriftが出るだけである。

**結論: 改良対象はパラメータではなくグラフ構築そのもの（余計な辺の除去＋動的import解決）。
sensorをLattice内へ吸収して自前で直す以外に成立する道がない。**

### T4: `lib/orchestrate/executor-adapters.mjs`

| 情報源 | 結果 |
|---|---|
| 親の宣言 | executor-adapters のみ（1件） |
| Codegraph（depth 1も5も同じ） | executor-adapters, placement-policy（2件） |
| import実在 | control-record, executor-adapters, placement-policy（3件） |

**Codegraphと親の両方が`control-record.test.mjs`を落とした**（helpers.mjs経由の間接import）。
Codegraph側の**偽陰性**であり、depth調整では解決しない。

### T2: `bin/orchestrate-run.mjs`

Codegraph観測: **0件**。binはどのtestからもimportされず、`spawnOrchestrate()`（子プロセス起動）で
テストされるため。**call graphに写らない結合**の実例（RC4 planの既知の罠の実証）。

## 4. Latticeが被る構造的帰結

- `codegraph-adapter.mjs:306`は`['affected', targetPath, '--path', '.', '--json']`を渡す＝
  **`--depth`を指定しない＝既定5**。`lattice.run_request.v1`のquery schemaにdepth概念が無い。
  ただし上記のとおり**depthを表現できても解決しない**ため、これは欠陥の主因ではない。
- exact一致契約と組み合わさると、**dispatchable planを得るには親がCodegraphの誤答（偽陽性8件）を
  witnessへ書き写す**しかない。witnessは「観測の写経」になり、親の判断を記録する意味を失う。
  本測定ではそれを行わず、未達のまま記録した。
- 一方でexact一致契約そのものは正しい（drift検出の要）。**壊れているのはsensorであって契約ではない。**

## 5. 親plan（dotagents）へ返す判断材料

- 親plan Phase L2「Codegraph fork＋改良」の対象は、当初想定の「call graph外結合の索引化」
  （=偽陰性側）**だけではない**。実測ではグラフ構築そのものが**両方向に壊れている**:
  (a) 存在しないimport経路の辺（偽陽性）、(b) 計算パスの動的importの未解決（偽陰性）、
  (c) spawn駆動の結合が構造的に不可視（`bin/orchestrate-run.mjs`のaffected 0件）。
  改良の対象はパラメータ調整ではなく**グラフ構築のcorrectness**である。
- fork判断の根拠データとして、本測定は「Codegraphの情報は不足しているだけでなく、
  **誤っており、かつ設定では直せない**」を示す。オーナー仮説（Codegraph自身の改良が要る）を
  実測で支持し、L2 forkが**唯一成立する道**であることを示す（回避策は機能しないか、
  Latticeの中核主張=drift検出を殺す）。

## 6. 未達（正直な記録）

- **dispatchable planはまだ発行できていない**（`AFFECTED_TEST_DRIFT`で停止中）。
  witnessをCodegraphの誤答へ合わせれば通るが、それは測定の意味を壊すため行っていない。
  対処方針（depth表現の追加 or 契約の見直し）はStage 1 gate裁定の材料とする。
- conflict/wave判定・unknown率・見逃し0件確認は、plan発行後にしか測れないため**未実施**。
- 本測定は親が対象repoを熟知する条件下・単一batch・macOS ext4での結果であり、一般化しない。
