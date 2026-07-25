# ADR 0123 — runtime契約を配布物へ載せ、拒否理由を返す

- Status: Accepted
- Date: 2026-07-25
- Corrects: [ADR 0044 Decision 2](0044-rc3-runtime-contract.md)（schema表の`run_request.v1`
  field列とtodos entry形が実装と食い違っていた）
- Confirms: [ADR 0052](0052-cli-error-v2-and-doctor-retirement.md)（typed失敗envelopeの
  optional `detail`）

## Context

第三者hostがLatticeのruntime面（`plan compile` / `run start`）を使えるかを、公開CLIと配布物だけで
実測した。使えなかった。原因は3つある。

1. **契約が配布物に無い。** 公開npm packageが同梱するschemaは`lattice.plan_create_input` v1〜v3と
   `bridge-setup.md`だけだった。`run_request.v1`・`executor_packet.v1`・`executor_receipt.v1`の
   field列はGitHub repoのADR Markdownにしか存在せず、`npm install`した利用者の手元には届かない。
   runtime面には`--schema`取得口も無かった。
2. **拒否が理由を返さない。** 不正なrequestは`INVALID_RUN_REQUEST`／
   「run_request.v1 contractを満たさない」だけを返し、`detail`を持たなかった。形の異なる4通りの
   requestが同一のbytesを返す。schemaが手元に無く、errorも何も言わない以上、hostがrequestへ
   到達する経路は存在しない。同じ製品のTODO面は`INPUT_INVALID`・`REVISION_INVALID`・
   `INVALID_EVIDENCE`のいずれも`detail.reason`を返しており、diagnosabilityが面ごとに非対称だった。
3. **契約が分裂している。** `run_request.v1`のvalidatorは`sensor_query_set`・
   `executor_capability`・`manual_witness[].sensor_provenance`を`plainObject`としか検査せず、
   runtime front-endはそれぞれにexact shapeを要求していた。schemaを満たしたrequestが後段の
   `CONTRACT_VIOLATION`（`detail`なし）で落ちる。schemaが受理したものを実行系が拒む構造そのものが欠陥である。

ADR 0044 Decision 2の表は`codegraph_query_set`と、`task_ref`／`scope`を持つtodos entryを載せている。
実装はCodegraph吸収（[ADR 0047](0047-codegraph-absorption-and-sensor-ownership.md)）以後
`sensor_query_set`を要求し、todos entryは`todo_id`だけを受理する。**公開表どおりに書いたhostは必ず失敗する。**

## Decision

1. `lattice.run_request.v1`・`lattice.executor_packet.v1`・`lattice.executor_receipt.v1`の
   JSON Schemaを`docs/schemas/`へ置き、`package.json`の`files`へ載せて配布する。
   契約を公開したと言えるのは配布物に載っている時だけとする。
2. `plan compile --schema --json`と`run start --schema --json`で`run_request.v1`のschemaを返す。
   公開面の数は増やさず、既存2面のオプションとして提供する。
3. `run_request.v1`の判定正本を`explainRunRequest`ひとつにする。受理は`{ valid: true }`、
   拒否は最初の違反の`reason`と`path`を返す。`validateRunRequest`は本関数へ委譲するため、
   boolean判定と診断が乖離しない。CLIは`INVALID_RUN_REQUEST`の`detail`へ`{ reason, path }`を載せる。
4. `run_request.v1`のvalidatorは、runtime front-endと`run start`が実際に要求するnested shapeまで
   検査する。`sensor_query_set`は`{queries: [{id, operation, target?}]}`、`executor_capability`は
   `{adapters: [identifier]}`、`sensor_provenance`は`{queries: [{query_id, expect}]}`を要求する。
   schema段で受理してから後段で落とす分裂を残さない。
5. closed setの所有をruntime contractsへ一本化する。`SENSOR_QUERY_OPERATIONS`と
   `SENSOR_EXPECT_KINDS`はruntime contractsが所有し、front-endは輸入して使う。
   同じ閉集合を二箇所へ持たない。
6. ADR 0044 Decision 2の表のうち`run_request.v1`のfield列とtodos entry形は本ADRが訂正する。
   以後、これら3 schemaの正本は`docs/schemas/`の配布ファイルとする。

## 非目標

- schema versionは上げない。本ADRは`run_request.v1`の**表現されていなかった要求を明文化**するだけで、
  受理される正当なrequestの集合を変えない。従来receiptを得られたrequestは引き続き受理される。
- `executor_receipt.v1`へTODO store identity（project／plan／revision）を足さない。
  receiptが単独ではTODO正本へ帰属しないという事実は本ADRの範囲外であり、別途裁定する。
- `sensor_query_set`に`status` queryをちょうど1件要求する規則はfront-endの意味論的検査として残す。
  これは既に`QUERY_DRIFT`のtyped detailで報告されており、schemaの構造制約ではない。

## Consequences

- `npm install @quolu/lattice`だけでruntime契約が手元に揃う。hostはADR Markdownを読まずにrequestを組める。
- 不正なrequestは違反pathを名指しして拒否する。`{}`から出発して`detail`に従うだけで
  schema-validなrequestへ到達でき、それ以後の拒否はすべて`references`や`guidance`を持つ意味論的判定になる。
- `test/runtime-schema-distribution.test.mjs`が、配布物への同梱・schemaのkey集合とvalidatorの
  exact key集合の一致・閉集合の一致・拒否理由とpathを機械検査する。契約とschemaのdriftは
  テストが落ちる形で表面化する。
