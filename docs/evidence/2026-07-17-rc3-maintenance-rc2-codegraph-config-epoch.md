# RC3 maintenance — RC2 codegraph config epochの追随裁定

- 日付: 2026-07-17
- 分類: Phase開始baseline修理（RC3-D着手前、P1: baseline redがPhase受入を塞ぐ）
- 関連Decision: ADR 0040（execution identityへのconfig bytes bind）、ADR 0044 Decision 10.3（`research/runs/` tracked exclusion）

## 症状

RC3-D Phase開始のfull baseline（`npm test`）で6 test red。

1. `test/rc2-campaign.test.mjs` 5件 — `captureExecutionIdentity`が「Codegraph project config bytesがRC2 v2 contractと一致しない」でreject。
2. `test/integration/rc2-codegraph-artifact-scope.integration.mjs` 1件 — `codegraph affected src/rc2-delivery-policy-oracle.mjs`のaffectedTestsに`test/rc3-compatibility.test.mjs`が増え、期待リスト4件と不一致。

## 原因

RC3-B（commit `abb7859`）が`codegraph.json`へ`research/runs/`除外を加算した（ADR 0044 Decision 10.3で裁定済み）が、
次の3箇所が旧config bytesのままだった。RC3-B/Cはfocused test運用のためlive campaign系testが走らず、破れが検出されなかった。

- `src/rc2-campaign.mjs` `CODEGRAPH_CONFIG_BYTES`（live実行のconfig一致検査）
- `test/rc2-campaign.test.mjs:351` の期待exclude deepEqual
- `test/integration/rc2-codegraph-artifact-scope.integration.mjs` `ORACLE_TESTS`（affected set期待、前例`dc14a47`と同種）

## 裁定 — ratified config epoch allowlist

**live実行**（`src/rc2-campaign.mjs`）は「現在ratifiedなconfig」＝ADR 0044 epoch bytesとの完全一致だけを受理する。
旧bytesはcheckout drift・改竄としてreject継続。

**保存artifact検証**（`src/rc2-artifact-set.mjs` `verifyCodegraphConfig`）は、ratified config epochの列挙allowlistへ変更する。

- ADR 0040 epoch: `{"exclude":["research/campaigns/**/artifacts/**/identity/"]}` — RC2 canonical artifact v2〜v4が保存する当時のratified config。
- ADR 0044 epoch: `{"exclude":["research/campaigns/**/artifacts/**/identity/","research/runs/"]}` — RC3-B以降のfresh実行。
- 上記以外のbytesは従来どおりfail closedでreject。`identity.json`の`project_config_digest`との自己整合要求も不変。

この変更により、artifact versionからconfig bytesへの対応は単一値でなく「ratified epoch集合のいずれか」になる
（canonical v4=旧epoch、fresh v4=新epochの両方がvalid）。改竄検出はdigest binding＋allowlistで維持される。
ADR 0044は「config bytesを既存契約どおりexecution identityへbindする」とのみ裁定しており、verifier側の
2-epoch受理はここで裁定を明文化する（ADR 0044本文へは追記しない）。

## 反証記録

契約クリティカル（検証規則の変更）のため、実装前にrefuter（read-only、主モデル継承）へ設計を渡して反証させた。

- 指摘1（採用）: `test/rc2-campaign.test.mjs:351-353`の旧exclude deepEqualが第4の必須修正。これなしでは5 test赤のまま。
- 指摘2（採用）: allowlistはADR参照付きepoch定数とし、2-epoch受理の裁定を証拠文書へ残す（本文書）。
- 確認済み: fresh campaignの生成物とcanonical保存値の等値比較assertは存在しない（test全706行実読）。旧config文字列のpinは
  src/test全体で3箇所のみ。RC1 v6系・rc3-runtime系testへの波及経路なし。`codegraph affected`実測でaffected test増分は
  `test/rc3-compatibility.test.mjs`ちょうど1件。
- RC2 canonical artifact v1〜v4のbytesは無変更（ADR 0044 Decision 10.2充足）。

## 変更ファイル

- `src/rc2-campaign.mjs` — live pinをADR 0044 epochへ更新（コメントで裁定参照）。
- `src/rc2-artifact-set.mjs` — `CODEGRAPH_CONFIG_EPOCHS` allowlist化。
- `test/rc2-campaign.test.mjs` — 期待excludeへ`research/runs/`追加。
- `test/integration/rc2-codegraph-artifact-scope.integration.mjs` — `ORACLE_TESTS`へ`test/rc3-compatibility.test.mjs`追加。

## 検証

- focused: `node --test test/rc2-campaign.test.mjs test/rc2-artifact-version-witness.test.mjs test/rc3-compatibility.test.mjs`
- integration: `node --test test/integration/rc2-codegraph-artifact-scope.integration.mjs`
- full baseline: `npm test`（Phase開始baselineを兼ねる）、`npm run check`
