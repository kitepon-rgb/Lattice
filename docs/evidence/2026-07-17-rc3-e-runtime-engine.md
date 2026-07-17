# RC3-E — ready-frontier runtime engineとscripted executor

- 日付: 2026-07-17
- plan: [plan_lattice_rc3_runtime_vertical_slice.md](../archive/plan_lattice_rc3_runtime_vertical_slice.md) RC3-E節
- 契約: ADR 0044 Decision 3（event store／projection）・4（frontier分離）・7.4（receipt帰属）・9（adapter境界）
- Control: `lattice-rc3-runtime-v1`（task `RC3-E-ready-frontier-runtime-v1`、review run `RC3-E-implementation-review-run-01-v1`）

## 実装

### `src/runtime-engine.mjs` — event chainを生成するproducer

- **二重実装の設計**: dispatch選択（`selectDispatchable`）とreceipt裁定（`adjudicatePendingReceipts`）を
  `runtime-decision-verifier.mjs`と独立のコードで実装する。focused testが全`dispatch_decided` prefixに対して
  verifierの`computeReadyFrontier`再計算とのexact一致を要求し、意味論divergenceを検出する構造。
- **ready frontier**: hard predecessor充足・running conflict・実capacityだけを根拠に辞書順貪欲選択。
  minimum waveを同期barrierにしない（focused testはTA稼働中のTC dispatchをsequenceで直接証明）。
  terminal・dispatched済みTODOはplain frontierへ戻さない（redispatchはRC3-Gの新context契約所有）。
- **chain構築**（`buildNextRunEvent`）: genesisは`run_initialized`限定、別run prefixへの追記拒否、
  prefix末尾eventの自己digest再検査、subject/payloadのclone（aliasing破壊防止）。
- **packet帰属**: dispatchはactive planへのpacket帰属（plan_ref/epoch/base_sha/packet_id/task_ref/
  scope=manifest writes）を要求し、自己整合しただけの別plan packetをreject。
- **部分dispatch失敗**: adapter失敗時は成功済みdispatchのeventを保持したtyped failureを返し、
  起動済みexecutorをevent store外へ孤立させない。
- **hold request**: `conflict_found`＋即時`intake_frozen`（frozen_prefix_digest付き）。競合発見後の
  fail-open dispatch継続を塞ぐ。closure計算・hold裁定・resumeはRC3-G所有。
- **receipt裁定**: Decision 7.4完全鏡映（binding 5 field必須→dispatch記録cross-bind→base/epoch→
  freeze境界: post_freeze reject／frozen prefix内はwitness binding必須）。receipt_id再利用はreject。

### `src/runtime-scripted-executor.mjs` — 決定論的scripted executor

provider非依存adapter契約（dispatch/observe: running・unknown・checkpoint_ready・hold_requested・terminal）の
primary実装。挙動はscript（step列: checkpoint／stall／hold_request／terminal）だけで決まる。
`stall`はtimeout=unknownの決定論的再現で、同一handleの再観測だけが回収経路。重複dispatchはtodo_id単位で
reject（task_ref付け替え・decision論的handle衝突を塞ぐ）。receipt_overridesで帰属破壊・stale epoch等の
敵対条件を注入できる（RC3-H campaignの注入基盤）。

### `src/runtime-decision-verifier.mjs`への意味論補完（review P0採用）

- `computeReadyFrontier`: terminal済み・dispatched済みTODOをfrontierから除外（engineと同義。
  receipt rejected後の再実行は新context packetを伴うRC3-G redispatchだけが所有）。
- `recomputeReceiptDecisions`: receipt_id再利用を`duplicate_receipt_id`でreject（先着のみ裁定）。
- RC3-B/C characterizationは全green維持（既存expected setはこの範囲をpinしていない）。

## 異provider review（commit前）

codex-sidecar `codex_review`（gpt-5.6-sol×high、read-only）が9 finding（P0×1・P1×7・P2×1）を返した。裁定:

- **P0採用**: terminal/dispatched集合のproducer/verifier divergence → verifier側の意味論補完で一致化。
- **P1全採用**: freeze下裁定の不一致（engine側をDecision 7.4完全鏡映へ）、同一receipt二重受理
  （terminal再観測拒否＋duplicate_receipt_id reject）、plan外packet dispatch（帰属検査）、
  task_ref差替え重複dispatch（todo_id dedupe）、不正prefix/genesis追記（chain guard）、
  部分dispatch失敗の孤立（typed failure＋証拠保持）、hold_request後のfail-open（即時freeze）。
- **P2条件付き**: unknown観測の保存証拠化はrun_event.v1のclosed kind set変更を要するため、
  RC3-J最終ADRの裁定事項として保存（本実装ではunknownは無event・同一handle再観測のみ）。
- **評価残として記録**: projectionのreceipt_accepted↔receipt対応付けはpayload.receipt_idでなく
  「同一TODOの最後のpending」に依る（engine側guardで二重受理は塞いだが、projection自体の改善は
  RC3-Gのreceipt lineage整備で扱う）。receipt.checkpoint_digestと保存checkpoint evidenceの照合は
  RC3-F（diff observer）所有。

比較単位の固定: verifierは全receiptの歴史的裁定を返し、engineはpending receiptだけを裁定する。
独立検証の比較は「engine裁定**前**のprefixに対するverifier結論」と「engineの裁定」の一致で行う
（裁定後prefixへのverifier結論は`recorded_rejection`が正）。focused testでこの単位を固定した。

## 検証

- focused: `test/rc3-runtime-engine.test.mjs` 13 green（barrier不在のsequence証明、全prefix replay一致、
  freeze/stale/duplicate/foreign packet/partial failure/genesis guardの敵対ケース含む）。
- related gate（source収束後1回）: RC3対象＋bootstrap＝73 test green、`npm run check` pass（module 2件追加）。

## 未検証・持ち越し

- run start／observe／status・event verify CLIとdisk上のrun store（research/runs/rc3/）はRC3-F所有。
- freeze解除（intake_resumed）・hold裁定・carry-over・redispatchはRC3-G所有。
- unknown観測の証拠化kind追加はRC3-J ADR裁定事項。
