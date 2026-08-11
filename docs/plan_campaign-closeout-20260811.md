# plan: 2026-08-11 campaign群の締め（closeout）

- Status: Completed
- 関連: [plan_bridge-persistence-recovery.md](plan_bridge-persistence-recovery.md)・
  [plan_carry-removal-retirement.md](plan_carry-removal-retirement.md)・
  [ADR 0165](adr/0165-terminals-advertise-exactly-what-they-serve.md)・
  [ADR 0166](adr/0166-recovery-paths-must-not-refuse-the-state-they-repair.md)・
  [ADR 0167](adr/0167-carry-tolerates-edges-to-tasks-removed-by-the-same-revision.md)
- 工程正本: Lattice store（`plan_key: campaign-closeout-20260811`）。

## 背景

2026-08-11に3つの修正（ADR 0165/0166/0167）を出し、0.57.1〜0.57.3として全端末へ配った。
成果そのものは着地しているが、**記録と後始末が残っている**。親が工程へ載せていなかったため
卓が待機していた。載せる。

## 非目標

- 新しい機能の追加。本campaignは記録・退役・還流だけを行う。
- bpr5-fox-install の実行。FOXの公開面は永続PTY経由で復旧済みだが、registry installへの切替は
  本campaignの記録・退役・還流の範囲外とする。

## 既知の罠

- **打ち切りToDoの退役は`node bin/lattice.mjs`で回す。** インストール版CLIには carry 緩和が
  入っていない版が居ることがあり、旧実装は`carry_semantics_changed`で拒否する。
- 退役revisionのcutoverは、storeのanchorが指す原本行が散文に実在することを要求する。
  消えている場合は該当commitから復元してからでないと通らない。
- `lattice todo revise`の入力は canonical bytes（1行JSON＋末尾LF1本）でなければならない。

## 検証方法

- 記録: 該当ファイルに当日の実測値（版・digest・URL応答）が入っていること。
- 退役: `node bin/lattice.mjs todo status --json`に対象が出ないこと。
- 還流: 罠DBまたは正典から、次に同じ場面へ来たAIが引ける形になっていること。

## ToDo

- [x] co1-deploy-record: 0.57.3の配備記録を`docs/operations/lattice-kitepon-deployment.md`へ追記する
- [x] co2-retire-bpr6: 裁定で不要となったbpr6-offline-noticeを退役revisionで工程から外す
- [x] co3-plan-status: 完了したplan文書2件のStatusを実態へ合わせ、bridge-hub散文の正本記述を現行versionと archive参照へ直す
- [x] co4-knowledge: 「同じものを2箇所で別々に定義すると、どちらも正しいまま噛み合わなくなる」形を正典へ還流する
