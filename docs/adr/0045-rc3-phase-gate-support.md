# ADR 0045: RC3 runtime閉ループのsupportとclaim境界を固定する

- Status: Accepted（不変Decision。変更は新ADRで行う）
- Date: 2026-07-17
- Scope: RC3-J Phase gate Decision（plan `lattice-rc3-runtime-v1`の完了裁定）
- Control: `lattice-rc3-runtime-v1`
- 前提Decision: [ADR 0044](0044-rc3-runtime-contract.md)（digest `db914b01…`）

## Decision 1 — H1-RC3をcorrection適用後supportとする

H1-RC3「plan graphは一度発行して終わらず、実行時の実観測でconflictを検出し、影響範囲だけを
holdして残りを走らせ、新planへ再コンパイルして続行できる」を、以下の実証に基づき**support**する。

- **scripted campaign（正典artifact v1）**: 正解集合が既知の8条件が全て期待とexact一致
  （clean並列、後発path conflictのexact hold {TA,TB}＋無関係TODO継続、scope violation、
  semantic unknownの非発行、stale receipt reject、実行中発見→intentional serial再compile、
  predeclared seamのaccept→conflict/wave減少→epoch 2 plan、event corruptionのtyped reject）。
- **actual dogfood（正典artifact v2）**: 実external executor（Claude implementer agent）
  5 dispatchで同じ閉ループを一度完遂（known注入の実diff検出→hold→witness付きcarry-over→
  vN+1→serial redispatch→全受理→close）。
- **Phase反証（Fable read-only）**: Lattice codeをimportしない独立実装によるdigest・chain・
  hold・receipt裁定の再計算が全一致し、反対仮説H0-a〜d／f／gは実コード・実bytesで棄却された。
  反証が立てたP1×2は本gate内で修理し（Decision 2）、修理後にfull CI 290 test greenを確認した。

## Decision 2 — gate内correction（反証P1の修理）

1. **CLI surfaceの完全実装**: ADR 0044 Decision 8の6 commandのうちRC3-D以降Phase間で所有が
   たらい回しになっていた`run start`／`run observe`／`run status`／`event verify`を実装し、
   Decision 10.1のrun event store root（`research/runs/rc3/<run-id>/`）を実体化した
   （exclusive作成・typed reject・adapter暗黙fallbackなし。gitへはcommitしないruntime state
   としてgitignore、Codegraph exclusionはRC3-B設定済み）。
2. **receipt裁定replayのprefix意味論**: `recomputeReceiptDecisions`のdispatch帰属を
   「receipt記録時点までの最後のdispatch」へ修正（全投影の最後勝ちでは後続redispatchが
   過去receiptの帰属を書き換えproducerとdivergeする）。artifact v2 verifierのreceipt replayを
   片側包含から「裁定時active plan（outcome eventのepoch）での双方向・reason/detail込み比較」へ
   強化した。正典artifact v1/v2は本修正後のverifierでもgreen（v1: 54 check、v2: 16 check）。

## Decision 3 — claim境界（丸めの禁止を明文化する）

1. actual dogfoodのtimeout回収実証は「dispatch直後のin-flight unknown観測＋同一provider handle
   での回収」である。実timeout・中断の実観測は未発生であり、timeout=unknown→同一handle回収の
   機構自体はscripted／unit testで実証した。actualでの実timeout観測は将来のdogfoodへ持ち越す。
2. unknown観測はevent無追記の設計であり、unknown発生自体の保存bytesからの再計算はclaimに
   含めない。証拠化が必要になった場合は`run_event.v1`のkind集合をversion＋新Decisionで拡張する。
3. core run eventの`recorded_at`は決定論的固定値である。実時刻はprovider ledger側が持つ。
4. artifact v2のprovider ledger先頭4 entryの`observed_at`はformat不正（shell date `%3N`未展開）で
   観測時刻として無効。`duration_ms`／`tool_uses`は正当な実測。artifactは不変のまま、
   本Decisionで欠陥を記録する（成功条件26の観測時刻部分はこの4 entryに限り不成立）。
5. RC3-Hの「同一request」は「同一base・同一request template・条件注入のみ可変」の運用解釈で
   実施した（条件表の注入定義と字義的単一request bytesは両立しないため）。
6. RC3-IのControl記録はH task（approval snapshot付き）とartifact v2への代表束縛であり、
   5 dispatchの粒度の一次記録はartifact v2のprovider ledgerである。
7. actual dogfood driverのrebindはstate内packetのepoch更新で実装され、正規のepoch rebind
   packet（保存済み）を執行系へ直接渡していない。core eventのepoch_rebound＋dispatch記録bindで
   整合は保たれているが、driver実装のDecision 7.3字義からの逸脱として記録する。
8. artifact v1の`semantic_unknown`（event 0件条件）のrecordにある`event_chain_valid: true`は
   「検査対象なし」の意味である（skipped意味論。verifierはevent_count 0を別checkで固定）。

## Decision 4 — 持ち越し所有の裁定

- **CLI envelope schema**（`lattice.plan_compile_result.v1`／`plan_verify_result.v1`／`cli_error.v1`／
  `run_start_result.v1`／`run_observation.v1`／`run_status.v1`／`event_verification.v1`／
  `run_meta.v1`）を本DecisionでLattice所有の公開契約として裁定する（RC3-D持ち越しの解消）。
- **genesis sentinel**: checkpoint無しcarry-overの`authorized_checkpoint_digest`は64桁ゼロを
  正規sentinelとする（RC3-G持ち越しの解消）。
- **評価残（非blocker、将来Phaseの候補）**: artifact発行のfsync耐久性・並行発行競合test、
  seam条件のCodegraph coverage完全replay、projectionのreceipt lineage改善、非UTF-8 filenameの
  byte-exact観測、RC1/RC2系9 moduleの`npm run check`列挙追加、run store CLIの多epoch replay
  （現状は保存planのepochのみ）。いずれも再現するP0/P1欠陥ではない。

## Decision 5 — 相互digest binding（成功条件30）

- scripted campaign artifact v1: `campaign-manifest.json` digest `36373c9bdc77c577b8e5e2c2efd84ce95abcd05a199dbe9aa871ceb49e2b3273`
- actual dogfood artifact v2: `dogfood-manifest.json` digest `7f4dd3363193376b7b863170622cf4d431a4fc070d7a76321b084a5174c0c4a4`
- 実装commit系譜: `13a0e66`（RC3-D）→`bad99c5`（RC3-E）→`70ade50`（RC3-F）→`f167ed3`（RC3-G）→
  `c40596a`（RC3-H）→`33591d3`（RC3-I）→本gate correction commit（Decision 2の変更を含む）。
- evidence: `docs/evidence/2026-07-17-rc3-*.md`（D〜J各1本＋maintenance 1本）。
- 検証state: full `npm run ci` 290 test green（gate correction適用後）。

## 反証記録

Phase反証はFable（read-only、内部refuter agent、独立digest再計算実装）で一回実施した。
P1×2（CLI surface消失・receipt replay divergence）は採用・本gate内修理、P2×8は
Decision 3/4へ裁定として反映（棄却0件）。反証の生存findingでsupportを覆すものは残っていない。

## Consequences

- Latticeは「compile済みplanのread-only推薦器」ではなく、実行時観測→selective hold→
  epoch rebind→plan vN+1 recompileの閉ループを、CLI・artifact・独立再計算つきで所有する。
- 本ADRはRC3の完了裁定であり、RC4以降のscope（多repo、実CI統合、provider多様化、
  自動dispatch常駐化）は新しいplanとADRで扱う。
