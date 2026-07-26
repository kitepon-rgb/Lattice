# bk-002: 実変換campaignを起票した

- 日付: 2026-07-27
- plan: `backlog` / task `bk-002`
- 起票先: Lattice storeの`real-transform` plan（8工程）、散文は[docs/plan_backlog.md](../plan_backlog.md)

## 起票の裁定

オーナーが製品目標を明示した——**特許請求の範囲12項を体現すること**。これを受けて、
どの構成要件が埋まっていないかを実コードで照合し、核の欠落を1つのcampaignへ起こした。

照合結果は[docs/plan_backlog.md](../plan_backlog.md)の「請求項の充足状況」が持つ。要点は3つ。

1. 実行時の側（請求項9・10）と競合判定（請求項4）、並行実行制御（請求項1(c)）は実装済み。
2. **静的側の核（請求項1(b)・5・6）が未実装。** `seam_candidate`は「どこで切れば競合が消えるか」を
   提案後ownershipでの仮想再compile（残余conflict 0）まで確かめて記録するが、**その切り方を
   実際のソースへ適用する側が無い**。提案surfaceはディスク上に存在せず、artifact自身が
   `hypothetical_new_surfaces`とラベルしている。
3. 請求項2（AIが作業仕様から影響範囲を推定）と請求項7（他方の変更を版管理へcommit）は、
   本campaignのscope外。前者は製品にAI呼び出しが無く、後者は`runtime-engine.mjs`が`commit`を
   `FORBIDDEN_OPERATIONS`へ入れており現設計と正面から衝突する。別途の裁定が要る。

## 現在の到達点（何が在って何が無いか）

`src/bounded-seam.mjs`は器として完成している。

- 隔離worktreeの作成と後片付け、`base_sha`照合
- scope drift検査（`allowed_paths`外の変更、`required_paths`の未変更を拒否）
- 4ゲート検証（`behavior_equivalent`／`focused_tests_passed`／`sensor_fresh`／`overlap_reduced`）
- 本repositoryが変換で変化していないことのassert

**足りないのは`transform`と`verify`の中身である。** どちらも注入引数であり、製品側は誰も渡していない。
importしているのは`test/bounded-seam.test.mjs`だけで、製品経路から切れている。
`rc2-campaign.mjs`と`rc2-delivery-policy-transform.mjs`はどこからもimportされておらず、
`npm run check`の対象にも入っていない。

## 起票した8工程

依存は直列ではなく、変換器（rt-003）と検証器（rt-004）は導出（rt-002）から並行に分岐する。

1. 実変換の受入契約とrc2断線の扱いを裁定する
2. `seam_candidate`からbounded seam candidateを導出する
3. 宣言anchorのsymbolを新surfaceへ移す変換器を実装する
4. 外部挙動同等性・focused test・再index・重複解消の検証器を実装する
5. 隔離worktreeで変換を実行する公開CLI面を足す
6. 採用した変換を本ツリーへ着地させ、再indexして残余conflict 0を実測する
7. accepted artifactをpredecessorにした新plan versionへ再コンパイルする
8. このrepoの実conflictで閉ループを1周させ、releaseまで通す

## 着手条件が揃っている根拠

0.18.0で、**正直な宣言のまま`seam_candidate`が出る**ようになった
（[実行記録](2026-07-27-honest-declaration-first-candidate.md)）。それ以前は、機械が解決できない
symbolを宣言から落とした「探りの宣言」でしか候補が出ず、変換の入力が実態からずれていた。
今は`tio-008`/`tio-009`の実conflictから、残余conflict 0の候補が正直な宣言で得られる。

## この記録が主張しないこと

- 変換はまだ1度も実行していない。本campaignはその起票である。
- 請求項2・7はscope外として明示的に外した。縮小ではなく、別の裁定を要する論点として分けた。
