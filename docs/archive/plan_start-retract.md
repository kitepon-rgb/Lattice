# 着手の撤回（start-retract-20260809）

オーナー裁定（2026-08-09）: 今回のcampaignで直す。task状態の正本はLattice store（plan_key
`start-retract-20260809`）。

## 課題

journalは追記専用で、startの後の遷移はdone/blockedしかない——**in-progress→pendingへ戻る事象が
存在しない**。誤startは取り消せず、「実質停止なのに記録上active」という嘘の状態で居座る。
実被弾: t19はgate宣言と行き違いのstartが取消不能で、noteに「start記録ありのまま実質停止であり、
その期間に成果が無いのは怠慢ではなくgate遵守である」という弁明を書く羽目になった。
嘘をつかない工程正本という製品の芯に対する欠陥である。

## 設計の制約（実装者が設計を持つ。以下は境界だけ）

- **撤回は履歴の削除ではなく追記**——新しいjournal event（例: start_retracted・reason必須・actor束縛）を
  積み、projectionがin-progress→pendingへ戻す。過去のstartは正史に残る
- **撤回できるのは自分のstartだけ**（actor一致）。他人のstartの扱いは装置が裁定しない——claim争いと
  同じく卓の会話が決め、装置は事実の記録だけを持つ
- **pull intakeとの整合が本丸**: r1のopen-flowはliteralなstart eventへ束縛する。**active intakeが
  在る間のretractはtyped errorで拒否**し、intakeの解放（release/abandon）を先に要求する。
  逆順を許すと「観測中の作業の根拠eventが消える」
- 負のコントロール: pending/done/blockedへのretract・他actorのretract・intake中のretractが
  全部typed errorで止まること
- 撤回後のtaskはnext_readyへ戻る。並列既定はstatusの案内であり、再startをflagで拒まない（ADR 0180）
- 既存storeの読み口（旧journalにretract eventが無い）は無変更で通る——加算互換

## 工程

#### st1 撤回の実装（Lattice）
journal event・projection・`lattice todo`のCLI入口・負のコントロール込みのfocused test。
CLIの語彙（`start --retract`か独立コマンドか）は実装者の判断。

#### st2 受入: 実測（親立会い）
受入条件: ①実planで start→retract→next_readyへ復帰→別席がstart できる ②t19の実際の誤start期間の
ような状態が再現でき、retractで正直な状態へ戻る ③pull intake中のretractが拒否され、release後に
通る ④負のコントロール4種がtyped error ⑤既存planのstatus/gantt/advisoryが無変更で通る。
受入条件はこの5つで固定——実測中の発見はgateへ足さず外へ出す。

## 罠

- t19自体の後始末に使うのは受入(st2)の後。受入前の実planへの適用は実験にしない
- blocked→pendingの欠落は**今回のscope外**（同族の穴だが、混ぜるとgateが膨らむ。課題帳へ）
