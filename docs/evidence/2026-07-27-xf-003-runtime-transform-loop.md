# xf-003: 実行時競合から変換までを実データで1周させた

- 日付: 2026-07-27
- plan: `runtime-transform` / task `xf-003`
- test: `test/integration/runtime-seam-transform.integration.mjs`

## 通した経路

実git repository・実sensorで、次を1本で通した（3.1秒）。

1. fixture repoを作り、`src/page.mjs`（`CSS`／`escapeText`／`renderLeft`／`renderPage`）を置いて索引する。
   `T1`は`renderLeft`、`T2`は`CSS`を自分の担当として宣言する（どちらも同じpathを所有）。
2. `T2`のworkerを隔離worktreeで走らせ、**自分のscope外かつ`T1`のscope内である`src/page.mjs`へ書く**。
3. `captureWorktreeDiff`が実diffを取り、`detectCheckpointFindings`が
   `observed_write_conflict`（`src/page.mjs`、`T1`×`T2`）を返す。**観測が競合を教える。**
4. その観測から変換候補を導出し、隔離worktreeで適用して五条件で判定する。
5. `accepted`なので`lattice.runtime_seam_split.v1`を組む。所有は各自の新資源へ移り、
   競合辺は消える側だけが載る。
6. **本repositoryは変わらない**（`git status --porcelain`が空であることをassert）。

## これが請求項8である

請求項8は「リファクタリングにより解消可能な所定範囲の競合を検出した場合、競合に関係する二つの
作業を停止させ、**競合の解消に必要なソースコードの要素に限定してリファクタリングを行い**、
競合の解消後に二つの作業を再開させる」と述べる。

- **検出**: `detectCheckpointFindings`（実装済み）
- **双方停止**: `decideHoldAndCarryOver`の影響閉包（実装済み）
- **限定リファクタリング**: 本工程。`allowed_paths`／`required_paths`で変更範囲を封じ込め、
  五条件で採否を決める
- **双方再開**: 再計画が`runtime_seam_split`を読み、holdしたTODOへ新plan_ref由来のpacketを発行する
  （実装済み）

従来欠けていたのは3つ目だけで、しかも**事前宣言された処置しか扱えなかった**。実行時に競合を見てから
変換候補を導出する経路が無かった。

## 実行時だから緩める、をしていない

五条件のうち1つでも欠けたら意図的直列へ送り、欠けた条件を残す。緩めると、外部挙動を変えうる変更が
**便益の証明なしに実行中のrunへ入る**。所有面の名前も、与えられなければ候補を作らない——
製品が名前を発明しない線は実行時でも同じである。

## 検証

- `node --test test/integration/runtime-seam-transform.integration.mjs` — 1 pass / 3.1秒。
- `npm test` — 998 pass / 0 fail。

## この記録が主張しないこと

- `recompileNextEpochPlan`へ`runtime_seam_split`を渡して実際に再計画するところまでは通していない。
  組んだsplitが再計画契約の形を満たすことは組み立て側でassertしているが、full recompile requestを
  作って通す経路は別である。
- 変換の導出はbase状態に対して行っている。holdされたTODOの進行中の編集は、再計画が旧contextを
  失効させるため設計上そこで捨てられる。
- worktreeの外への書き込みは観測できていない（`write-coverage` planの`wc-001`）。
