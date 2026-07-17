# ADR 0051: RC4 Phase gate — 条件付きsupport（編入判定の確定とclaim境界）

- Status: accepted
- Date: 2026-07-18
- 前提: [ADR 0045](0045-rc3-phase-gate-support.md)（RC3 support）・
  [ADR 0046](0046-rc4-writer-target-stage-override.md)（Stage 2契約）・
  [ADR 0050](0050-stage1-executor-isolation-implementation.md)（executor隔離実装形）
- 一次証拠: [L5 Phase gate evidence](../evidence/2026-07-18-rc4-l5-phase-gate.md)・
  [Stage 2着地evidence](../evidence/2026-07-18-rc4-stage2-landing.md)

## Context

RC4 campaign（Stage 0〜2）はdotagents正規repoへの3 batch着地を完了し、L5 Phase gateの全装置
（full CI両repo・クロスprovider検証・`fable`×high refuter・knowledge return）を通した。
refuterの総合verdictは**条件付きsupport**——核心数値（19 check・5/5受理・事故0・実測時間）は
独立再検証ですべて裏付き、RC4反証条件4種はいずれも不成立。条件は4点で、本ADRが裁定として吸収する。

## Decision

### 1. RC4はsupportで閉じる。dotagents導入plan Phase L6（編入wave）の凍結を解除する

refute条項（`plan_lattice-factory-integration.md` L5）は発動しない。

### 2. claim境界（ADR 0045 Decision 3の型。誇張したらこのADRが偽になる）

RC4が実証したのは「**受理済み小粒patchの、親review→pathspec commit経路によるdotagents正規repoへの
事故0着地pipeline**」であり、以下は**実証していない**:

- **単一provider**: 全10 executor runが`claude-implementer-subagent`。クロスproviderのexecutor実行は未実証
- **Stage 2は仕様渡し再実装**: Stage 1の受理報告を仕様としてexecutorへ渡した。新規課題の解決能力の実証ではない
- **着地物はtest支配の小粒patch**: 5件計95行追加・挙動変更はresume-checkの7行のみ。lib本体の大規模patch着地は未実証
- **字義の隔離HOME未達**: ADR 0050の代替形（subagent executor＋isolation_contract＋fingerprint境界検証）。
  隔離HOME回帰条件（ADR 0050 Decision 5）は生きている
- **実timeout・Stage 2でのpatch reject・着地後rollbackは未観測**

「任意規模・任意providerの正規着地能力」をclaimしない。L6/L7でこれらの領域に入る時は、その時点で追加実証する。

### 3. behavior-preserving lane下のfeat着地（`b248c46`）の裁定

Control `lattice-rc4-dotagents-v1`はbehavior lane=behavior-preservingで固定したが、batch3
（dotagents `b248c46`）はresume-check成功envelopeへ`summary`キーを追加する観測可能変更を含んだ。裁定:

- **受理は維持する**。根拠: 変更はdotagents側正規TODO由来・追加的（既存キーの名称・順序・意味不変・
  他コマンド不波及）・batch個別のH承認と親実読reviewを通過・契約正典
  （`dotagents/shared/orchestrate/control-record.md`）へ例外条項として明記済み（L5 gateで是正）
- **再発防止**: 今後のcampaignは、TODO集合に観測可能変更が1件でも含まれるならlane=behavior-changeを
  宣言する。lane宣言は「campaign機構の性質」でなく「着地するTODO集合の実態」に従う
- phase gateの`behavior_change` stepは、lane制約（behavior-preserving→not-applicable＋Decision必須）に
  従いnot-applicable＋本Decision参照で進める。実態（追加的変更1件の受理と是正）は本節が正

### 4. patch bind検証の強化をmaintenance queueへ

`patches_bound_to_accepted_receipts`は現状path照合のみ（保存`checkpoint_digest`未検証・
receipt content digestとpatch適用結果の突合なし）。強化（digest照合）を編入planのmaintenance queueへ
記録する。P0/P1非該当（親実読reviewが補償経路として存在）。

### 5. ADR 0050残余リスクの恒久化条件（編入契約へ）

subagent executor形態を編入後も常用する場合、「読取の帰属不能」残余は恒久化する。適用範囲を
**公開repo内容のみを扱うcampaign**に限定し、秘匿情報を扱う場合は隔離HOME回帰（ADR 0050 Decision 5）を
前提条件とする。この制約をdotagents導入plan L6の編入契約文書化へ含める。

### 6. carry-over（plan archiveに伴う移管）

本plan（`docs/plan_lattice_rc4_dotagents_dogfood.md`）はRC3-J作法で`docs/archive/`へ退避する。
未消化項目は消さずに移管する:

- **Maintenance queue 3件**（sensor `require()`偽陰性・CLI `cli_error.v1` detail欠落・Decision 4の
  patch bind強化）→ dotagents `docs/plan_lattice-factory-integration.md`のmaintenance queueへ
- **編入パッケージ要件の文書化**（CLI 6面契約・schema一覧・run store/artifact規約・executor adapter契約・
  Codegraph同梱方針）→ 同plan Phase L6の先頭TODOへ

## Consequences

- L6（編入wave）着手可。第10枠はObserver予約済みのため**Latticeは第11**（導入plan罠8）
- 本ADRのclaim境界を引用せずにRC4を「実証済み」と語る文書は誇張であり、罠10違反として扱う
- Control `lattice-rc4-dotagents-v1`は本ADRを親最終Decisionとしてfinalize・archiveする
