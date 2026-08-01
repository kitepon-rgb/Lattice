# sah-p6-dotagents-followup — 受入記録（sensor-awareness-hooks campaign）

- 記録: 2026-08-01〜02 / Control `sensor-awareness-hooks-20260801`
- 対象repo: dotagents（commit `3c493bb`・push済み）

## 実施内容（dotagents側）

| 項目 | 結果 |
|---|---|
| timeoutSec欠陥修理 | apply-codex-config生成の全6 entry（callout4・advisory・工程表）を`timeout`へ。旧entryのcanonical化置換をclean-home fixtureで回帰固定。factory scanner v2/v4/v5追従 |
| onboarding追従 | README・AGENTS.mdへ `lattice hooks install --host claude|codex`（製品管理配線・手挿し禁止）を追加。docs/03へSpotter同型の注記、docs/05を`timeout`契約へ更新 |
| verify-install追従 | `lattice hooks status` のwired検査を追加（hooks未対応版はskip・非wiredはinstall command名指しFAIL） |
| gate | make lint・claude/codex smoke・clean-home・factory v2 test・dry-run（生成側timeoutSecゼロ）全green（親再実行含む） |

## 実端末適用（この端末）

- `apply-codex-config --apply` 実施（backup: `~/Archives/dotagents-codex-config-20260801T150648Z.tar.gz`
  ＋事前tar）。dotagents所有6 entryが`timeout`へ置換。
- `verify-install --profile official`: **exit 0・FAIL 0**。`Lattice hooks: claude → wired`／`codex → wired`。
- Codex hook trust: オーナーがUIで全承認済み（2026-08-02）。

## 範囲外へ切り出した発見

`~/.codex/hooks.json`に他製品所有の`timeoutSec`が6件残存（Throughline 3・Caveat 3——同じ罠の
別所有者）。各製品repoの修理としてchip起票済み（caveat参照付き）。本campaignでは触れない。
