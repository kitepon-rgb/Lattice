# 外部の並列worker群をmanaged runへ載せる（円卓×実行層の統合）

Latticeの実行層（隔離worktree・write lease・実書き込み観測による競合検出・停止／変換／再開）は
実装済みで実daemonまで通っている。一方、実在する外部消費者Peertableの円卓は**計画層の4面だけを
消費していて、実行層を1つも使っていない**。本書はその接続を次戦のcampaignとして起票するための
構想であり、**実装も工程起票も含まない**。

工程状態の正本はまだ無い。着手時にplan keyを決めてstoreへ起こす。本書は目的・思想・一次資料・
論点・非目標・罠を持つ。

## なぜ今これか

2026-08-08、Peertableの円卓（AI 4〜5席が同一repoを同時に編集する運用）が丸一日走った。そこで
観測された摩擦は、**Latticeが既に持っている装置が届いていない範囲**で起きている。

装置が無いのではない。**消費者が計画層で止まっている**。

| 層 | Latticeの面 | 円卓の消費 |
|---|---|---|
| 計画 | `todo status --json`の`next_ready`／`blocked`／`active_set`／`dispatch_frontier` | **消費している**（各席が次の仕事を取る唯一の入口） |
| 計画 | `todo start`／`done`のlifecycle journal | **消費している**（claim交差時の裁定に機械の事実として引く） |
| 計画 | `todo done --evidence`の証跡束縛 | **消費している** |
| 計画 | `audit_pending`／`todo phase status` | **消費している**（解散判断を機械的に抑える） |
| 実行 | `lattice run start`（managed run・executor adapter・隔離worktree） | **消費していない** |
| 実行 | 実書き込み観測による`observed_write_conflict` | **消費していない** |
| 実行 | 影響閉包だけのhold／`run seam resolve`／resume | **消費していない** |

消費者契約（[00_product-contract.md](00_product-contract.md)「消費者としてのPeertable」）は
消費される面を4つと記述しており、それは**現状の記録として正しい**。本campaignはその記録を
更新しにいく——ただし**面を足す話ではない**（後述の非目標）。

## 着手時点の事実（実読で確定したもの）

Lattice側:

- `lattice run start --request <request.json> --executor <adapter>` が入口。`lattice.run_request.v1`
  の必須keyは `repo` / `capacity{executors}` / `todos` / `manual_witness` / `sensor_query_set` /
  `executor_capability{adapters}` / `claim_mode` / `request_digest`。**`claim_mode`は`const: "exact_minimum"`**
- `lattice run adapter register --input <descriptor.json>` でexecutor adapterを登録する。
  **Peertable projectのadapter registryは空**（`adapters: []`）＝実行層が一度も使われていない
- **各TODOは隔離worktreeで走る**。freeze後は影響閉包内だけhold、閉包外は`carry_over_witness`を
  実証できた場合だけ継続する（[plan_backlog.md](plan_backlog.md)の請求項7の行）
- **請求項9（実変更観測による実行時競合検出）は実装済み・実daemonで確認**。managed supervisorが
  terminal時にorigin-bound worktreeの最終diffを独立観測し、`observed_write_conflict`へ接続する
- **請求項8（双方停止・限定変換・双方再開）は実装済み・実runで一気通貫**。入口は
  `lattice run seam resolve`で、宣言→観測の翻訳段`reconciled`を持つ
  （`test/integration/hold-transform-resume.integration.mjs`・
  [evidence/2026-07-27-xf-003-runtime-transform-loop.md](evidence/2026-07-27-xf-003-runtime-transform-loop.md)）

**注意（この文書を書く過程で踏んだ罠）**: `plan_backlog.md`には2026-07-28時点の経過記述
（「請求項8は実行時に見つかった競合の形を受け取れない」）と、その後の現況表（請求項1〜12の状況）が
**同居している**。上から読むと経過の方に先に当たるので、現在の状態を誤読する。**現況表が正**である。

Peertable側（`peertable` repoの`docs/plan.md`が正本）:

- 席は`tmux`上のCLIエージェントで、**同一のworking treeを直接編集する**。隔離は無い
- 並列境界は`dispatch_frontier`（計画時）と、**room上の会話による宣言**（実行時）で担保している
- 同一ファイルの衝突は、**人が直列化を宣言する**ことで避けている

## 一次資料: 2026-08-08の円卓で観測された摩擦

出典はPeertable repoのroomログ（発言番号）とcommitである。**当事者の言葉ではなく、記録から辿れる形**で残す。

1. **編集途中のtreeを他の席が掴む。** memberが自分の変更の検証を回そうとしたが、別memberが編集中の
   ファイルでimportが壊れており実行できなかった。**HEADから隔離worktreeを手で起こして**自分の変更だけ
   写して検証した（前campaign room [20][24]）
2. **同じことが検査として働いた場合もある。** 別のmemberがローカル検証サーバーを起動した際、それが
   **他memberの編集途中のworking tree**であったため、出荷前のプロトコル不整合バグを偶然踏んで捕まえた
   （前campaign room [122]）。**摩擦であると同時に相互検査でもあった**
3. **同一ファイルの直列化は人が宣言した。** 5 taskが同じ手順書ファイルへ書き込む計画になり、親が
   `t6→t4→t9→t3`の順を、別ファイルでは`t7→t8`の順を、**room発言で宣言する**ことで衝突を防いだ
   （本campaign room [182]）
4. **会話上のclaimと工程正本のstartは別物である。** memberがroomへclaimを投稿した直後に
   `lattice todo start`が`STORE_INCONSISTENT / invalid_start_transition`で弾かれた——数秒前に
   別memberが同じtaskをstartしていた。**社会的宣言と機械的記録の間に隙間がある**（本campaign room [191]）
5. **path非交差でも壊れる依存がある。** 2つのtaskは**ファイルが1つも重ならず**、compileから見て
   完全に独立と判定され、実際そう扱われた。ところが片方がSSEのワイヤへ新しいevent種別を足した瞬間、
   もう片方（そのストリームの消費者）が壊れた。**依存はpathではなく共有プロトコルにあった**
   （前campaign room [106][122]、本campaign room [195]①）
6. **完了の定義に機械が届いていない。** 全taskがdoneで監査も通った後、成果物3本が**未pushのまま
   取り残されていた**。publish経路の機械gateはtarballしか見ないので、docs・証跡・実験コードは
   その外側にある（前campaign room [168]、その後`done.sh`へ未push本数の表示を追加）

## 論点（設計判断が要るもの）

### 1. 席をmanaged runのworkerとして走らせられるか

Latticeのmanaged runはexecutor adapterへdispatchし、隔離worktreeとwrite leaseを配る。円卓の席は
**長寿命の対話エージェント**で、1 taskが終わっても解散せず次を取りにいく。この寿命の違いをどう扱うか。

- 案A: 席そのものをadapterとして登録し、`run start`のdispatch先にする。**claim（会話）とdispatch
  （機械）が二重になる**——`claim_mode`が`exact_minimum`固定であることとの整合が要る
- 案B: 席は今のままで、**worktreeとleaseだけを配る**。実行層の一部（隔離・観測）だけを借りる
- 案C: 接続しない。摩擦は会話で解き続ける（現状維持を明示的に選ぶ）

**判断材料は「誰がdispatchを所有するか」である。** 消費者契約は「Latticeが所有しないもの＝会話の正本、
参加者の規範、宣言ベースのclaim、判断そのもの」と定めている。dispatchをLatticeへ渡すと、**claimが
機械の割り当てへ変わる**——それは消費者側の社会契約（判断は情報を持つ者がする）と衝突しうる。

### 2. 資源の宣言に「線」を含められるか

一次資料5が示すのは、**path単位の独立性判定では見えない依存**である。共有プロトコル（wire format・
API形・イベント種別）を変更する側と、それを読む側は、ファイルを1つも共有しないまま壊れ合う。

`owns`／`reads`／`writes`／`creates`はpathとsymbolの語彙を持つ。**線（stream・schema・event種別）を
資源として宣言できるか**、できるとして`observed_write_conflict`の観測側はそれをどう検出するか。
実書き込み観測はfileのdiffを見るので、**「同じfileを触っていないが、線の形を変えた」は観測に映らない**。

### 3. 隔離は偶然の相互検査を消す

一次資料2が反対材料である。**隔離worktreeを自動配布していたら、あの検査は起きなかった。**
memberは心拍の無いサーバーで全部greenにして出荷し、本番で壊れていた。

したがって本campaignは「隔離すれば摩擦が消える」を目標にしてはならない。**隔離で消える偶然の相互検査を、
意図的な装置で置き換える**ことまでを設計に含める。候補は論点2の裏返しで、**「このrunは線Xを変更した／
線Xの消費者はrun YとZである」を機械が言えること**である。今日それは人が口頭でやり、しかも
**変更をcommitした後**に言われた（前campaign room [106]）ので、消費者側は4回空振りした。

### 4. runの終端で「着地したか」を見るか

一次資料6。完了の定義が「repoへ着地するまで」であるなら、runの終端で**成果が既定ブランチの祖先か**を
見るのは自然である。ただしpush既定でないrepoやまとめてpushする運用を壊さないこと——
消費者側は既に`done.sh`で「出すだけ・止めない」形を採っている。

## 非目標

- **実装しない。工程起票もしない。** 本書は構想の起票までである（オーナー裁定 2026-08-08）
- **会話・claim・判断を実装しない。** 消費者契約が「Latticeが所有しないもの」と定めた範囲であり、
  実行層を繋ぐことでこの境界を侵さない
- **Peertableのために面を足さない。** 接続に新しい公開面が要ると判明した場合、それは
  「この消費者のための面」ではなく**汎用の実行層の面**として成立するかを先に問う。成立しないなら
  接続しない側を選ぶ（分離の維持。Latticeのコードに特定消費者を指す語を入れない）
- **standalone modeは対象外。** 消費者がLattice無しで動く形は契約の外である

## 罠

- `plan_backlog.md`は経過記述と現況表が同居している。**現況表が正**（本書「着手時点の事実」の注意）
- 実行層の面は`.lattice/runs/<id>`を持ち、storeとは別の資産である。消費者は`.lattice/`のstore fileを
  直読み・直書きしない契約なので、**runの観測も公開CLIとversioned JSON経由に限る**
- 円卓の席は`PEERTABLE_*`環境変数と`.mcp.json`で構成されており、**working directoryを移すと
  room接続とMCP解決の両方が変わる**。worktreeを配るなら、この構成をworktree側へ運ぶ必要がある
