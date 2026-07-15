# Research Campaign 1 plan adoption refutation

- 実施日: 2026-07-15
- 対象: ADR 0002、`lattice-research-campaign-1-v2`
- 実施者: 親統括
- 採用基準: 実コード／実文書の欠陥、論理矛盾、非識別実験、一次資料誤読、具体的な安全事故経路だけ。
- 独立反証: plan採用時には未実施。実artifactを対象にした独立反証とCriticはRC1-GのPhase監査へ一回集約する。

## 反対仮説の検証

| 反対仮説 | 検証 | 裁定 |
|---|---|---|
| 変換以外の入力差で並列幅が増える | TODO outcome、manual evidence、query set、capacity、verifierを両条件でdigest固定し、code snapshot由来graph evidenceだけを変える | 交絡を検出可能。drift時は実験棄却条件をplanへ明記 |
| file分割だけでsemantic independenceを誤認する | 同じ2 TODOへshared-state writeを与えるnegative controlを置き、変換後もconflict保持を成功条件にした | path-only判定を反証可能 |
| 構造差分だけでbehavior preservationを宣言する | treatment admissionをcharacterization greenの後に置き、Codegraph単独acceptを禁止した | 論理飛躍を回避。有限testによる一般証明は主張しない |
| 小型fixtureのwave削減を一般的速度改善へ誇張する | intervention costは記録するが、単一fixtureから速度改善率や経済的純便益を一般化しない | RC1は閉ループ機構の実証に限定 |
| 隔離変換がcanonical worktreeや外部repoを汚す | disposable worktree、bounded scope、canonical worktree不変、Lattice外read-onlyをacceptanceにした | 違反時はartifact reject。fallback継続しない |
| 新version番号だけで旧contextが残る | accepted transform artifactをpredecessorにし、plan／context／patch／assumptionの失効一覧を必須にした | version barrierを観測可能にした |

## 実物から採用したfinding

初稿のHard dependency graphではRC1-CがRC1-Dへ入るように読める一方、task表はRC1-DをRC1-A＋Bだけへ依存させていた。
control compileにtransform isolationは不要であり、初稿図は因果順と矛盾していた。`A+B→D`、`C+D→E`へ修正した。

旧plan archiveも初稿では句読点1行が元blobと異なり、記載したSHA-256と不一致だった。元blobと逐語一致へ修正し、
archive digestを再検証対象にした。

## 親裁定

上記修正後、H1、対立仮説、control、独立変数、指標、成功／反証条件は識別可能で、writer／isolation境界とも矛盾しない。
計画を採用する。実装結果に対する独立反証は証拠が揃うRC1-Gまで増殖させず、Phase単位で一回行う。
