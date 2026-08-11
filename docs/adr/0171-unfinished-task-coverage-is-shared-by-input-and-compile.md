# ADR 0171 — structure inputとcompileは未完了task coverageを共有する

日付: 2026-08-12  
状態: Accepted

## Decision

既存planへToDo構造検査を途中適用する時、必須coverageはpending／in-progress／blocked taskの集合とする。

- 完了済みtaskはstructure setへの遡及入力を要求しない。
- compileとfinalizeはplan全taskの状態を観測し、structure set外のdone taskだけをcoverage findingから除外する。
- 未完了taskの列挙漏れと、structure set側taskの登録topology欠落は引き続きerrorとする。

## 根拠

入力dry-runとcompileが異なる集合を要求すると、validとして保存したsourceを次の正規操作が拒否する。
完了済みtaskを埋める回避は、途中適用対象を未完了taskへ限定した入力契約と矛盾し、realizationを遡及的に
捏造させる。task状態をcompileへ渡して同じ集合を使うのが最小の修正である。

## 証跡

[v0.58.2公開証跡](../evidence/2026-08-12-v0.58.2-unfinished-coverage-fix.md)
