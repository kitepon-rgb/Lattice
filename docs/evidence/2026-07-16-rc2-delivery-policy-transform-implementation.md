# RC2 delivery policy transform implementation evidence

- 日付: 2026-07-16
- Decision: [ADR 0037](../adr/0037-rc2-delivery-policy-transform-transaction.md)
- Characterization commit: `552a5d0424e7f62d4f5ac14e2f5a0ec006dfab21`
- Test helper correction commit: `6dbfd08`
- Implementation commit: `9a8e357`

## 実装範囲

- `test/rc2-delivery-policy-transform.test.mjs`
  - SHA-256: `0df484c8c573adeb45deeb2be9c3c3f7e071390122bdaab502f56cf8863a5490`
- `src/rc2-delivery-policy-transform.mjs`
  - SHA-256: `2aba4096dcb067a82a1aa0f579d329a4156a28da974cc4c2f5f60e5dc294a32d`

production moduleはexact 3 exports、lexical 8-path allowlist、idempotent writer、既存`runIsolatedTransform`を使うtransactionを実装した。
transactionはclean `HEAD === baseRef`、accepted candidate digest、actual 9-path control snapshot、adapter source、fixed oracle source／pre receiptを
transform前に確定する。accepted pathでは3 resolver、composition entry、3 dedicated tests、composition-only shared testを作り、4 focused
verifier、pre／post oracle、9-path output snapshot、6 cases × 4 tests mutation matrix、exact restore、source invariant、cleanupを通す。

accepted artifact／receiptはcandidate、adapter、base SHA、control／output snapshot、oracle、patch、behavior、mutation、verification、cleanupを
full objectとdigestでcross-bindする。binary patchはJSON artifact外のBufferとして返す。incomplete transform、scope violation、oracle divergence、
mutation／restore／cleanup failureはtyped rejected resultになり、accepted outputまたはplanを持たない。

## Characterizationと修正

production source追加前のfocused runは5件すべて`ERR_MODULE_NOT_FOUND`でexpected-redだった。初回production runは4 pass／1 failとなり、
原因はtest helperが`git status --porcelain`を`.trim()`し、先頭のstatus空白をpathの一部として失っていたことだった。productionへfallbackを
加えず、helperをdirect spawn＋`trimEnd()`へ修正し、先頭空白を保持した。

最終focused gate:

```text
node --test --test-reporter=spec test/rc2-delivery-policy-transform.test.mjs
5 pass / 0 fail / 0 skip
```

characterizationは、default writerのexact 8-path bytesとidempotence、shared testから6 case IDs／exact outputsの除外、実Control snapshot、
binary patchの第二fixture replay、fixed oracle source bytes、pre／post equality、6×4 owner-only mutation sensitivity、mutation restore、
incomplete／scope rejection、candidate／HEAD／dirty-source preflightを固定した。

## Codegraph境界

source前preflightでは予定module／exportsはabsentであり、既存isolation／oracle／fixture影響をunknownとして保持した。実装後のfinal syncは
73 files、1775 nodes、6875 edges、pending 0、worktree mismatch `null`、index state `complete`だった。

- `runRc2DeliveryPolicySeamTransform`: callerはexact characterization test、calleeは既存isolation／oracle／compiler helperを含む20件。
- `applyRc2DeliveryPolicyTransform`: callerはexact characterization test、calleeは4件。
- 両symbolのimpactは2 nodes／1 edge、affected testは`test/rc2-delivery-policy-transform.test.mjs`一件。

この構造結果をbehavior preservationまたはmutation sensitivityの単独証明には使っていない。前者はfixed oracle、後者は6×4 matrixが担う。

## TODO gate監査

- scope外source／test変更: 0。
- canonical repo mutation／worktree leak: 0（focused transactionでsource invariant／cleanup passed）。
- 標準経路外の手補正: porcelain parser correctionを独立commitに記録済み。artifact再構成や成功への丸め込みはない。
- full `npm run ci`: RC2-Hの一回へ集約するため未実行。
- RC2-G未実施: fresh primary／RC1 transfer run、new plan version、immutable artifact、disk-only verifierは本evidenceの主張外。
