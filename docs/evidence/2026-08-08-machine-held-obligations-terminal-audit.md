# machine-held-obligations 終端監査（2026-08-08）

監査人: bell（Peertable円卓の親・監査役）。plan `machine-held-obligations` v1（task 8件）の終端監査記録。
実施主体はPeertable円卓（mitsuki・hinano・suzume・koharu、いずれもOpus 5・4人目は
frontier幅4に合わせて途中着卓）。会話正本はroom `lattice`（seq 124〜300）、状態正本はLattice store。
オーナー裁定A〜D（room [124]）を実装した第2 campaignであり、前campaign
（audit-pending-surface・v0.47.0）の直接の後続。

## 何を作ったか

「工程の途中で発見された義務が、どこにも定着しない」（room [96]の議題）へのオーナー裁定を実装した。

- **A: plan単位note**（ob01）——書き込み・配達（startのnote_context統合）・別chain file化
  （`plan-active.jsonl`）による旧CLI完全互換。`note_append_result.v2`・`note_context.v2`
- **v6のstatus表出**（ob02）——`todo_status_result.v6`へ`plan_notes`欄。骨（schema定数・validator・
  v5拒否）をob02が建て、後続2欄が乗る建て方
- **C①: 調整方式の起票時宣言**（ob03）——`coordination_mode`をplan-scoped journal event
  （`plan-scoped.jsonl`・storeにとって初のplan帰属kind）として記録、`coordination`欄で表出、
  actorが帰属になる
- **C②: 未判定はdispatchを塞がない**（ob04）——Protected behavior化とfrontier_digest不変のanchor test
- **C③: 並列候補の逐次判定**（ob05）——`parallel_candidates`欄（coverage missingでも
  unjudged_task_idsと次コマンドを出す）。判定ロジックは新設せず既存compileの投影のみ
- **E2E**（ob06）——5面（3面一致・宣言遷移・逐次判定・dispatch不変・v6契約）を実CLIで駆動。
  「案内が案内として機能するか」（next_commandsの実実行）までassert
- **ADR 0160・公開契約・CHANGELOG**（ob07）
- **B/D: 棄却の実装なし**（裁定どおり）
- **dotagents 3消費者のv6追従**（ob08）——downstream先行protocol、多版受理（hook）と
  exact pin（projection/saga）の面別方針

## 受入ゲートの充足（2 repo）

### Lattice側

実行者: koharu（隔離worktree・現HEAD相当tree 6e6cbba＝受入対象と`evidence/ob08.md`1ファイル差、
src/test同一を実測確認 room [291][293]）:
`run-product-tests 1408 pass / 0 fail`・`check-syntax 141`・`verify-cli-surface 67`・
`verify-open-questions 29 anchored / unanchored []`・`verify-product-reachability 91 modules / stale []`
（room [294][300]）。差分ぶん（evidence追加）のgate非干渉はsuzumeが数値で確認（room [299]）。

### dotagents側

Latticeの`npm run ci`はdotagentsを測らない（room [292]の指摘）ため別掲:
projection 10 / saga 15 / `make test-orchestrate` 252 pass 0 fail / smoke 2本 ALL PASS / lint OK
（実行者mitsuki・room [285]・commit 1976cc0/3223d47/37bda87/942fd2e。独立確認2人:
suzume [299]・koharu [301]——宣言なしの重複実行だったことはroom [304]が事実として記録し、
再取得可能な観測の重複という規律面の残課題ごとretrospectiveへ持ち越す）。

### gate_ready瞬間の陽性実測（3者独立・同値）

全8task done直後、v6の全欄を実storeで観測: `audit_pending`に本plan（gate_ready・implicit）、
`plan_notes` 2件（head 4047409e…）、`coordination`空・`parallel_candidates`空（宣言なし・ready
なしの正しい陰性）、`next_action.reason: audit_pending`。mitsuki（room [297]）・hinano（[298]）・
bell（監査側保全）が独立に取得し全値一致。

## task別の監査記録

全taskはroomでのdone報告後、実物照合（commit実在・HEAD tree検査・実挙動）で受理した。

| task | commit | 監査 |
|---|---|---|
| ob01（＋B'差し替え） | 5b0d930, 8f8fb2f, 876380f ＋ dd26fc2, 2f7b781 | [161] 受理→[227] 撤回→[231] 再受理 |
| ob02（＋改名re-done） | be7e92f, 60eeb49, 7bbd425, eedac6d | [147]系・再done後受理 |
| ob03 | 3e2adb7, 3201c77, 448db12, af151a8 | [246] 受理 |
| ob04 | 5d43762, e2d608e | [147] 受理 |
| ob05（＋鮮度2修正） | 7fefe26, 6298806, a1884a9 ＋ c64af75, ba8268c | [266] 受理 |
| ob06 | ccf97b6, fa24398 | [276] 受理 |
| ob07 | 043efc7, 525029f, 30f0c2c, 6e6cbba | [280] 受理 |
| ob08 | dotagents 4本・証跡 2fe9818 | [286] 受理 |

## 特記事項

- **設計差し替え（B'）**: plan単位イベントを並行chain fileへ分離し、旧CLIの後方互換破壊と
  rollback不能を設計から除去（room [187]〜[205]で収束・installed 0.47.0での互換を実測）。
  オーナー裁定Aの範囲内の実装詳細として卓の判断で実施（[198]の整理）。
- **HEAD破損事故**: hunk選択によるcommitがcommit済み実装を巻き戻し（6553959）、構文緑のまま
  module解決で全CLI起動不能になった。検出3分・成果物損失ゼロ・復旧済み（3e2adb7/6265ca0）。
  監査手順はこの事故で2段強化（HEAD tree構文検査→展開treeの実行smoke）。検知3層は
  caveat `hunk-commit-tree-green-head` として恒久化。
- **publish前の窓の実測**: installed 0.47.0でのstartはplan noteが届かない（room [250][269]）。
  設計どおりの静かな欠落であり、cutover規則（publishまで散文が正・noteは予備、以後逆転）を
  ADR 0160へ明文化した（room [271][273]）。
- **既知の未了（publish後）**: installed CLIでのplan note配達実機確認（hinano・room [168][221]）、
  hook INFO実機確認（ob08の実SessionStart・mitsuki）。前campaignと同じくpublish後の実機確認で閉じる。
- **範囲外として分離した提案**: task noteの着手後配達（started_atを使うwell-defined案・
  ADR 0160の未決へ発火条件つきで記録）。

## 判定

受入ゲート（Lattice 1408/1408・dotagents 252/252・gate群green・3者一致の陽性実測）は満たされ、
全taskの成果物は実物照合済み。終端監査を**accept**とする。
