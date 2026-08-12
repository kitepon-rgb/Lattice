# structure-provenance-repair-20260812 — pre-baseline実装commitのrealization束縛修理

## 背景

Peertableの実測で、構造検査のbaselineより前に着地した正当な実装commitと、baselineより後の証跡commitを一つのrealizationへ指定すると、Latticeがbaseline..HEADだけをprovenanceへ収集するため、実装commitを`STRUCTURE_REALIZATION_COMMIT_UNREACHABLE`として拒否した。commitは現在HEADから到達可能で、anchorにも交差しているため、この拒否はprovenanceの範囲定義とrealizationの束縛範囲がずれている。

## データフロー

`realization.commit_oids` → Git object存在・HEAD到達性・baselineとの前後関係をtyped判定 → `baseline..HEAD`の既存changesetと、正当なpre-baseline commitの補足changesetを分離して収集 → 明示OIDをchangeset digestへ束縛 → declared commitの変更pathとmutating code anchorを照合 → realization chainへ追記する。

補足changesetは、baselineの祖先かつcurrent HEADから到達可能な明示commitだけを対象とする。既存の`baseline..HEAD` commit order・summary・changesetは意味を変えず、補足分は専用のbounded fieldへ保持する。

## 負例

- objectが存在しない、またはcurrent HEADから到達不能なcommitは`STRUCTURE_REALIZATION_COMMIT_UNREACHABLE`で拒否する。
- baseline自身、anchorへ変更pathが交差しないcommit、他taskがclaim済みのcommitは従来どおり拒否する。
- pre-baseline補足をcommit messageや推測で作らず、明示OIDとGit changesetだけで束縛する。

## 受入条件

- pre-baselineの正当な実装commitとpost-baselineの証跡commitを同一realizationで指定すると、両方が実測changeset digestへ束縛され、anchor照合を通過する。
- unrelated / unreachable / baseline自身を指定した場合、realization chainを変更せずtyped failureを返す。
- 既存のbaseline..HEAD provenance、self digest、他task claim、dirty worktree拒否、既存の構造compile/finalize契約を維持する。
- focused fixtureとCLI/store経路のテストがgreenで、完了証跡から実装commit・証跡commit・拒否負例を追跡できる。

## 所有境界

このtaskが書き込むのは、Git provenance収集・realization観測接続・realization保存の既存経路、関連focused tests、本taskの証跡だけとする。構造schema、一般のplan CRUD、sensor、Peertable側実装、公開・pushは対象外。

## 実装工程

- [ ] spr-01 pre-baseline実装＋post-baseline証跡をrealizationへ束縛する
