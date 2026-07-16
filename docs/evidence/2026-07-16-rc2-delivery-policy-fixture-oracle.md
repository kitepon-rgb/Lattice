# RC2 delivery policy fixture／black-box oracle

- 日付: 2026-07-16
- Control: `lattice-rc2-bounded-graph-v1` revisions 53〜58
- Task: `RC2-E2-delivery-policy-fixture-oracle-implementation-v1`
- Worker Run: `RC2-E2-fixture-oracle-run-01-v1`（implementer、accepted）
- characterization commit: `e9820a9c2a0b5be3ae88fe6345f8455572495804`
- Codegraph preflight commit: `cc75998`
- source commit: `030d33c`
- governing Decision: ADR 0035

## Implemented behavior envelope

`research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs`はmonolithic public entry
`resolveDeliveryPolicy({ channel, urgency })`を追加した。

- prototypeが`Object.prototype`のexact 2-key inputだけを受理する。
- shape／missing／extra keyを`TypeError`、unknown channel／urgencyを`RangeError`にする。
- email／sms／push × routine／urgentの6 exact outputをADR 0035どおり返す。

`src/rc2-delivery-policy-oracle.mjs`は指定`repoRoot`のpublic entryを`process.execPath`によるfresh subprocessへ読み込ませる。
親processはfixtureをimportせず、childへ入力6 caseだけを渡す。期待output、candidate ID、conflict、expected wavesはchild inputへ渡さない。
child failure、stderr、不正JSON、receipt shape、ID／digest不一致、behavior mismatchはthrowし、fallbackで成功へ丸めない。

成功receiptは`schema: lattice.rc2.delivery_policy_oracle_receipt.v1`、`outcome: passed`と入力順6件の
`{ id, outcome: passed, output_digest }`だけを持つ。scheduler期待値3 fieldが無いことをcharacterizationで確認した。

## Source identity

| path | SHA-256 |
|---|---|
| `research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs` | `39bf74ee887a55186fa96a49e47b95a4b2480493dfd68d85eb0ec4ba56ad6005` |
| `src/rc2-delivery-policy-oracle.mjs` | `c4012dfc00cc5b0194bd1a87be4a4e0b20d45e784d49a987768eea1b9932fafe` |

固定順combined result digestは`fa239a22bad5806624fe6abb4bdf529ee365ec02fa678b5c5df57cef57cf0779`。

## Codegraph boundary

source前は2 planned path／exportが不在であり、空結果を依存なしへ丸めずunknownとして固定した。source後の明示syncは、
sync前statusがadded 1と表示した一方、実際には2 files／23 nodesを追加した。post-syncは次のとおり。

```text
files: 69
nodes: 1594
edges: 6094
pending changes: 0
```

| exact symbol | owned path | caller | callee | impact | affected test |
|---|---|---|---|---|---|
| `resolveDeliveryPolicy:33` | monolithic fixture | fixture characterization | `hasExactInputKeys`、`POLICIES` | 2 nodes／1 edge | fixture characterization |
| `runRc2DeliveryPolicyOracle:88` | oracle source | fixture characterization | 5 functions＋2 constants | 2 nodes／1 edge | fixture characterization |

両lookupはrequested name／pathへexact一致し、fuzzy mismatch 0。affected testは
`test/rc2-delivery-policy-fixture.test.mjs` 1件、traversed 1、post-source unknown 0。

## Verification and Control hygiene

```text
node --test test/rc2-delivery-policy-fixture.test.mjs: 10 pass / 0 fail / 0 skip
git diff --check -- <assigned 2 source files>: pass
```

- `focused`: 10 pass／0 fail／0 skip。6 behavior、3 fail-loud input groups、fresh-process oracleを含む。
- `related`: Codegraph affected testはfocusedと同じ1 fileなので上記greenを再利用した。
- `full`: 未実行。RC2 Phase gateへ集約する。
- 初回Worker ReportはE1のvalidation refを誤って持ったため未importとし、E2 exact refへ修正した。
- 親がadmission時にworktreeへ置いた3 Control入力を途中削除したため、最初のreport importは`WORKSPACE_DRIFT`で拒否された。
  Controlに保存されたbaseline digestどおり3 fileを一時復元し、revision 56でimport、revision 57でaccept後に全て削除した。
- source commitはassigned 2 filesだけ。dotagents／Observer関連repo write、remote、push、publishは0。
