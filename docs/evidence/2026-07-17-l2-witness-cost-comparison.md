# L2 — witnessコストのL1実測比較（sensor改良(a)(b)(c1)後）

- Date: 2026-07-17
- baseline: [2026-07-17-rc4-stage0-witness-cost.md](2026-07-17-rc4-stage0-witness-cost.md)（Stage 0・改良前Codegraph v1.4.1相当）
- 測定対象sensor: Lattice `6c82461`（(c1) spawn索引化＋FP修理）＋`ae1f9dd`ビルド
- 対象repo: dotagents clone `70e834e`（Stage 0は`73947b3`。対象ファイルのimport構造は不変で、
  真値は本測定時点のcloneに対し全件grepで再検証した）
- 検証規律: 実測値のみ。丸め・事後推定なし。未測は未測と書く

## 1. affected観測品質の再測定（Stage 0と同一ターゲット）

| ターゲット | 真値（grep実在検証） | Stage 0観測 | 改良後観測 | 判定 |
|---|---|---|---|---|
| T1系 `lib/orchestrate/control-record.mjs` | 7件（ADR 0048訂正後） | depth=5: 12件（FP8相当）／どのdepthも真値なし | **7件 exact（FP0/FN0）** | 一致 |
| T2系 `bin/orchestrate-run.mjs` | 6件（spawn経由） | **0件**（spawn不可視） | **6件 exact（FP0/FN0）** | 一致 |
| T4系 `lib/orchestrate/executor-adapters.mjs` | 3件（静的2＋literal動的import1） | 2件（FN1。親の初稿も同じ見落とし） | **3件 exact（FP0/FN0）**・0.6秒 | 一致 |

T4の真値: `executor-adapters.test.mjs`（静的）・`placement-policy.test.mjs`（静的）・
`control-record.test.mjs`（top-level `await import("../../lib/orchestrate/executor-adapters.mjs")`）。
`tests/skills/smoke.sh`はshell経由の結合で(c2)クラス（後述）。

## 2. witnessコスト構造の比較

Stage 0の実測は「初稿は安価（17〜36秒/件）、高いのは初稿が通らなかった後の照合」だった:

| コスト項目 | Stage 0（改良前） | 改良後 |
|---|---|---|
| 初稿作成 | 17〜36秒/件 | 不変（witnessの本体は親の判断であり、sensorの守備範囲外） |
| drift調査＋import経路の実在検証 | **60秒/周**（T1で1周発生） | **発生せず**——T1/T2/T4系で観測＝真値のため、witnessの`affected_tests`は正しい観測の転記で済み、照合の引き金がない |
| exact一致契約の帰結 | **非dispatchable行き止まり**（通すには偽陽性8件の写経が必要＝witnessが「観測の写経」になり測定を放棄） | **写経のジレンマ消滅**——正しい観測に対するexact一致は、親の判断とdrift検出契約が両立する本来の姿で成立する |
| 表現不能だったwitness | T2系: affected 0件で結合を表現できない | 6件を直接記載可能 |
| affected取得の機械コスト | （baseline記録なし） | 0.6秒/ターゲット（実測・59ファイルrepo） |

**判定: L2受入基準の後半「witnessコストがL1実測比で有意に下がる」は、import／動的import／spawn
結合クラスについて成立。** 低減の実体は時間短縮（60秒/周の照合の消滅）に加え、Stage 0で
「AFFECTED_TEST_DRIFTで停止・写経以外に通す道がない」だったdispatch経路の構造的行き止まりの解消である。

## 3. 未測・残る限界（正直な記録）

- **typed witnessでの`lattice plan compile`再走は本測定では行っていない**。Stage 0のwitness実体は
  使い捨てで残っておらず、再作成コストは比較に新情報を足さない（観測側の正しさが本測定の対象）。
  compile閉ループでの実証はStage 1（L4）のdogfoodが正規の場。
- **(c2)クラス（shell・markdown・設定）は依然不可視**。真値実例採取済み:
  `tests/install/clean-home.sh`・`tests/hooks/smoke.sh`（→`bin/orchestrate-run.mjs`）、
  `tests/skills/smoke.sh`（→`lib/orchestrate/executor-adapters.mjs`）。T5/T6（markdown還流）も同クラス。
  要否・設計はwitness実測データに基づき親planの(c2)項で裁定する。
- T3（cross-repo）の表現力限界はsensorと無関係で、改良の対象外のまま（Stage 0の記録どおり）。
