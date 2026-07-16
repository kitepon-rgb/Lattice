# RC3 runtime contract実装（RC3-C）

- 日付: 2026-07-17
- Control: `lattice-rc3-runtime-v1`（Task `RC3-C-runtime-contract-and-event-verifier-v1` revision 17、
  review Task `RC3-C-implementation-review-v1` revision 18、review run受入 revision 24）
- 対象plan: [RC3 runtime vertical slice計画](../plan_lattice_rc3_runtime_vertical_slice.md) RC3-C
- 契約: [ADR 0044](../adr/0044-rc3-runtime-contract.md)
- RC1／RC2 source・test・fixture・canonical artifact変更: 0。RC2公開済みschema変更: 0。

## 加算production module

| module | 役割 |
|---|---|
| `src/runtime-contracts.mjs` | ADR 0044 Decision 2の10 schema validator（exact key・bounded collection・repo相対path・自己digest）、closed event kind set、`computeContextContentDigest`（Decision 7.1 content projection）、`verifyRuntimePlanBinding`（plan↔request cross-bind） |
| `src/runtime-event-store.mjs` | canonical event serialization、自己digest（`digestRunEvent`）、digest chain検証（`verifyRunEventChain`: gap／重複／fork／digest不一致／未知kind／storage order／redactionのtyped reject）、redaction契約（語幹部分一致＋secret形式value pattern） |
| `src/runtime-projection.mjs` | event prefixからのruntime state再構成（dispatch記録・receipt・conflict・freeze履歴・witness・rebind。sequence非昇順はfail loud） |
| `src/runtime-decision-verifier.mjs` | producer非依存のdecision再計算: `computeReadyFrontier`（frontier内非交差の貪欲選択）、`classifyObservedDiff`（closed conflict分類＋unknown非丸め）、`recomputeHoldDecision`（affected closure＋witness実証）、`recomputeReceiptDecisions`（dispatch記録へのbinding照合＋freeze恒久境界）、`verifyCarryOverWitness`（invariant digest再計算） |

`digestArtifact`／`canonicalizeArtifact`はRC2共有基盤（`src/artifact-contracts.mjs`）を無改変で再利用した。
`npm run check`の列挙へ4 moduleを追加した（成功条件28）。

## RC3-B expected-redの解消

RC3-Bで固定したexpected-red 17件は、**test期待を変更せずに**全件greenへ変わった（安全網の反転による実装検収）。

## 異provider review（契約クリティカルF範囲の1回監査）

- 実行: codex-sidecar `review`（read-only）、`gpt-5.6-sol`×high、
  実行ログdigest `f0283608bed520ca3e7bde4d541af74f6469dc851a7c7f6091fbfa7f893c8bfb`。
- finding 10件（P0×3・P1×6・P2×1）を親が実コード・ADR明文と突き合わせ、**全件採用**（棄却0件）。
  commitはreview裁定後まで保留した。採用と修正の対応:

| # | finding | 修正 |
|---|---|---|
| P0-1 | receipt帰属照合の欠落（Decision 7.4違反） | receiptへbinding 5 field必須化＋dispatch記録（`executor_dispatched` payload）とのcross-bind。欠落・不一致はtyped reject |
| P0-2 | `intake_resumed`でstale receiptが受理へ反転 | freezeをresumeで消えない恒久境界とし、最初のfreeze境界に対してstale判定 |
| P0-3 | witness event存在だけでcontinue許可 | payloadへ`carry_over_witness.v1`完全document埋め込みを要求し、schema・自己digest・todo帰属を実証できないwitnessを不成立扱い |
| P1-4 | frontier内conflict pairの同時dispatch | running集合に加え選択済みfrontierとの非交差を要求する貪欲選択 |
| P1-5 | 配列順とsequence順の不一致許容 | `storage_order`条件を追加、projectionは非昇順でfail loud |
| P1-6 | unknownの独立性への丸め | unknownを持つpairへ`semantic_conflict_unknown` findingを発行 |
| P1-7 | affected closureのresource witness到達欠落 | manifests付き到達計算を追加（Decision 6.3第三要素） |
| P1-8 | validatorの未知nested field・不正path受理 | repo相対path検査、todo exact key、manual witness完備（TODOごと8 field） |
| P1-9 | plan↔request cross-bind不在 | `verifyRuntimePlanBinding`を追加（再包装のtyped reject） |
| P2-10 | redactionのalias key迂回 | 語幹部分一致＋`Bearer`／PEM／JWT value pattern |

採用findingごとに敵対test 10件を加算した（receipt binding欠落、resume後stale恒久、witness document実証、
frontier非交差、storage order、unknown pair、manifests付きclosure、不正path、plan再包装、redaction alias）。

### fixture加算の記録

P0-1／P0-3の修正はfail-closed方向のため、RC3-B fixtureのevent payloadへdispatch binding／witness documentを
**加算**した。RC3-Bで固定したsemantic assertion（stale reject、witness bind受理、hold／continue集合、
frontier unlock、event corruption reject）は不変である。

### 評価残（所有Phaseを明示）

- carry-over invariant digestと保存sources（packet・manifest・validator bytes）の完全再照合の配線、および
  post-rebind checkpoint lineage検査は、hold／rebind eventの実producerと保存artifactが揃うRC3-Gで統合する
  （`verifyCarryOverWitness`のsources再計算自体は実装・test済み）。
- redactionは防波堤であり秘匿性の証明ではない（key語幹＋既知value patternの検出）。RC3-Hのcampaign
  artifactでredaction testを再度固定する（成功条件31）。

## Verification classification

- `focused`／`related`: RC3対象6 test file、41 tests、41 pass／0 fail／0 skip
  （compatibility 2、CLI 4、contracts 10、runtime characterization 15、event chain 9、integration 1）。
- `npm run check`: pass（新module 4件を含む列挙）。`git diff --check`: pass。
- Codegraph coverage: 87 files（新src 4＋新test 1収載、pending 0）。
- `full`: 未実行。RC3-J Phase gateへ集約する。
- remote、push、publish、Lattice外write: 0。手補正: 0（期待の書換えなし、fixtureは上記の加算のみ）。
