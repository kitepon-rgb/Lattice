# RC3-J — Phase gate（反証・correction・support裁定）

- 日付: 2026-07-17
- plan: [plan_lattice_rc3_runtime_vertical_slice.md](../archive/plan_lattice_rc3_runtime_vertical_slice.md) RC3-J節
- 裁定: [ADR 0045](../adr/0045-rc3-phase-gate-support.md)
- Control: `lattice-rc3-runtime-v1`（task `RC3-J-phase-gate-v1`、refutation run）

## maintenance dedup

各Phase evidenceの評価残を集約した（9項目）。再現するP0/P1欠陥は0件で、全てADR 0045の
Decision 3（claim境界）／Decision 4（持ち越し所有・評価残）へ裁定した。

## Phase反証（Fable read-only）

内部refuter agent（Fable、read-only、Lattice codeを一切importしない独立digest再計算実装）で
H1-RC3・全成功条件・H0反対仮説を一回反証した。

- **再計算一致**: artifact v2全9 document digest・v1全8 record digest・v1/v2全event chain・
  v1 late conflictのhold集合・v2全receipt裁定。
- **H0棄却**: fixture特判（a）、diffのdeclared scope非bind（b）、stale受理（c）、wave barrier（d）、
  event store混入（f）、fail-open（g）——全て実コード・実bytesで死亡。
- **P1採用×2 → gate内correction**:
  1. ADR 0044 Decision 8のCLI 6面のうち4面とrun store rootがPhase間の所有移動
     （RC3-D→E→F）の過程で黙って消失 → `run start`／`run observe`／`run status`／
     `event verify`とrun store（`research/runs/rc3/<run-id>/`）を実装。
     integration 6 test（store生成・観測再構成・typed検証・UNKNOWN_ADAPTER・RUN_EXISTS・
     改竄検出）で固定。
  2. `recomputeReceiptDecisions`のdispatch帰属が全投影の最後勝ちで、redispatch後に過去
     receiptの帰属が書き換わりproducer裁定とdiverge（v2 seq25で実証）→ per-receipt prefix
     意味論へ修正し、v2 verifierを裁定時active planでの双方向・detail込み比較へ強化。
- **P2×8**: 実timeout未観測のclaim境界、unknown無event設計、recorded_at定数、provider ledger
  時刻欠陥、Control記録粒度、rebind driver逸脱、event_chain_validのskipped意味論、
  条件30の相互bind——全てADR 0045 Decision 3/4へ裁定（棄却0）。

## correction後の検証

- full `npm run ci`: **290 test green**＋check pass。
- 正典artifact再検証: v1 54 check green・v2 16 check green（強化後verifier）。
- RC3-I driverの独立反証は本Phase反証へ集約した（RC3-I evidenceの宣言どおり）。

## 還流

- 検証規則・意味論の全裁定はADR 0044/0045とevidence 7本に還流済み。
- 本plan完了により、planはdocs/archive/へ退避し、Controlはfinalize→archiveする。
