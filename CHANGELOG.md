# Changelog

## 0.19.0 — 2026-07-27

- **判定が途中で止まった記録を、無関係な工程の「検証済み並列」として読まなくなった**。
  compileが`BOUNDARY_UNKNOWN`で止まるとpairwise verdictが1つも作られず記録の`conflicts`が
  空になるが、投影はその空をそのまま「ぶつかる記録が無い＝独立」と読んでいた。実測では、
  同じfileを書く2 ToDoが正しく直列と出ていた状態へ**新規fileを作るToDoを1件足すだけで**、
  競合が消えて2 ToDoが検証済み並列として提示され、案内も`independence_verified`を返していた。
  **判定が失われるだけでなく反転する**——不在を証拠へ読み替える、最も危険な向きの誤りである。
  記録全体がverdictを持たない時は、covered readyを全件`plan_verdicts_absent`として未検査へ落とす。
- 案内へ`independence_verdicts_absent`を足した。「干渉しない」ではなく「まだ判定していない」を
  述べ、次の一歩に`resolve_unknowns_then_recompile`を返す。
- ADR 0132のOpen questions 2〜4を再裁定した（[ADR 0135](docs/adr/0135-readjudicating-seam-proposal-open-questions.md)）。
  複数候補のv2は保留を維持しつつ発火条件を明文化、`verification` digestは同型問題を所有する
  実変換campaignへ移し、新規fileだけを作るToDoは判定対象にすると決めた——ただし自動導出でなく
  宣言とする。観測から機械的に創作境界と読むと、pathのtypoが「必ず止まるエラー」から
  「黙って通る創作境界」へ変わるためである。

## 0.18.0 — 2026-07-27

- **同名symbolの曖昧さをreceiptへ残し、宣言した資源で絞れる**ようにした
  （`lattice.seam_proposal.v2`の`candidate_paths`、[ADR 0134](docs/adr/0134-ambiguous-symbol-receipt-narrowed-by-declared-resource.md)）。
  これまでreceiptは`resolved_path`を単数しか持てず、同じ名前が複数fileにあると解決結果は
  `unknown`へ潰れていた。潰れた先に候補が残らないので、宣言の`within`で絞れば一意に決まる
  場合でも絞る材料が記録に無かった。`ambiguous`のreceiptは候補を2つ以上持ち単数pathを持たない、
  という排他を契約が強制する——決まった事実と決まらなかった事実を同じ形にしない。
- graph操作（`callers`／`callees`／`impact`）の曖昧さは従来どおり`unknown`へ潰す。展開の起点が
  一意でなければ観測の意味が定まらないためで、操作ごとに問いが違うから扱いも違う。
- **正直な宣言のまま`seam_candidate`が出るようになった**（[実行記録](docs/evidence/2026-07-27-honest-declaration-first-candidate.md)）。
  0.16.0の初回実行は、機械が解決できない1 symbolを宣言から落とした探りの宣言でしか候補が
  出なかった。宣言を実態からずらして候補を作るのは「宣言の誠実さが判定の上限」という前提を
  壊す行為なので、そこは限界として記録してあった。今回それが解けている。
- 旧`lattice.seam_proposal.v1`の記録は移行しない。independence記録とsensorから再生成できる
  host localの記録であり、古い記録は`recompile_seam_proposal_or_remove_stale_record`で落ちる。

## 0.17.0 — 2026-07-27

- **`concern_anchors`を宣言手順の単一正本へ載せた**（`lattice todo --help`）。0.16.0で欄を足したのに、
  宣言できる欄を挙げる唯一の面へ足していなかった。誰が書く欄か・何を書くか・並列可否の判定には
  写らないことの3つを述べる。ADR 0130の履行漏れの修理である。
- **束縛できなかったseam提案が、種別と次の一歩を述べるようになった**。これまで投影の`guidance`は
  記録の鮮度しか述べず、`concern_anchor_unresolved`や`semantic_owner_binding_missing`が載っていても
  「記録は現在と一致している」で終わっていた——**一番必要な瞬間に機械が黙る**状態だった。
  重なった時は直す対象が一意に決まる方（壊れた宣言）を、決まらない方（宣言が無い）より先に述べる。
- 投影の契約が、案内codeを規則正本へ引き直して照合するようになった。shapeだけを見ていた頃は、
  載っているunknownと噛み合わない案内でも通っていた。

## 0.16.0 — 2026-07-27

- **係争資源の中で自分が触るsymbolをToDoごとに宣言できる**ようにした
  （`lattice.todo_witness_set.v2`の`concern_anchors`、[ADR 0133](docs/adr/0133-concern-anchor-binding.md)）。
  これまで係争中のfileしか宣言していないToDoは固有anchorを持たず、切断候補を束縛できなかった。
  宣言は並列可否の**判定へ写らない**——判定入力へ合成する時点で落とすので、宣言が誤っていても
  conflictを作ることも消すこともできず、効くのは切断候補の束縛だけである。`concern_anchors`を
  持たない`lattice.todo_witness_set.v1`の宣言はそのまま受理する。
- 宣言symbolをsensorのexact一致・資源内包含・task間排他で検証し、破れた宣言は候補にせず
  kindの異なるtyped unknownで返すようにした。解決失敗・資源外・重複を潰さず区別する。
- **pathのconflictでは宣言そのものを切断候補にする**ようにした（`declared_partition`）。pathの競合には
  分割するcall graphが無いが、宣言は所有者ごとのsymbol分割そのものを与える。componentの全taskが
  同じpath内でsymbolを名指しした時だけ候補にし、片側の宣言から他方の担当を補完しない。
- これにより、このrepoの実conflictで**初めて`seam_candidate`が出た**（残余conflict 0、
  [実行記録](docs/evidence/2026-07-27-concern-declaration-first-candidate.md)）。同名symbolが複数fileに
  ある場合は名前だけで解決できず`concern_anchor_unresolved`で止まる限界も併せて記録している。

## 0.15.0 — 2026-07-26

- **切断候補をread-onlyで提案する面**を追加した（`lattice todo seam-proposal compile` と
  `lattice todo seam-proposal`、[ADR 0132](docs/adr/0132-seam-proposal-read-only-surface.md)）。
  これまでconflictは「symbol／path起因なら切断しうる」と分類するだけで、**どこで切るかの情報を
  製品は持っていなかった**。conflict componentを単位に、変更前後のsurfaceとその所有者、提案後の
  残余conflict、sensor証拠、未知を1つのversioned artifactへ記録する。生成はclean worktreeと
  実sensorを要求し、読み出しはsensorを引かない。
- **conflictが争っている実体を記録へ残す**ようにした（`lattice.todo_independence.v3`）。v2の
  conflictは`{task_ids, resource_id, kind}`だけで、`resource_id`は`own-path-<hash>`の合成IDだった。
  **どのsymbol・どのpathが衝突したのか復元できず**、提案生成の入力が存在しなかった。targetは
  conflictへ直書きせず`conflict_resources`辞書へ一度だけ持たせる（conflict最大4,096件×target最大
  4,096 byteに対し保存上限は1 MiB）。
- 既知の旧契約で書かれた独立性記録を`superseded`として再compileへ案内し、**壊れた記録とは区別する**
  ようにした。旧記録が残ったままでも工程表表示とsession-context案内は落ちない。planの改訂と契約の
  陳腐化に別の次の一歩を返す。
- 工程表へseam提案を表示するようにした。実データではほとんどのcomponentが「情報が足りない」に
  なるため、**なぜ提案できないか**（typed unknownのkindと対象ToDo）まで読める見せ方にした。
  争っている資源はhash IDでなくexact targetで出る。
- ToDoへの割り当てをcaller／callee／impactのedgeから導出しない規律を固定した。witnessのtask固有
  anchorが束縛できない場合は`unknown_requires_evidence`を返す。1候補の失敗を`intentional_serial`へ
  昇格させない——探索の不完備は「切れない」ではない。
- 公開契約が独立性artifactを`v1`と記載していたdriftを実装（`v3`）へ揃えた。

## 0.14.0 — 2026-07-26

- **session開始時の現在地を1プロセス・1回のstore読みで返す**入口を追加した
  （`lattice session-context --json`、[ADR 0131](docs/adr/0131-session-context-single-store-read.md)）。
  `lattice status`と`lattice todo status`は同じ`readTodoStore`を別プロセスで二重に払っており、
  hostのSessionStartは両方を呼ぶ。storeが育ったprojectでは実行枠（実測6秒）を超え、
  **現在地の案内が毎回捨てられていた**。実測でdotagents（store 9.7MB／218ファイル）が
  6.5秒から3.2秒へ落ちる。`status`フィールドは`project_status.v1`、`todo`フィールドは
  `todo_status_result.v4`をそのまま埋めるので、hostは既存の検証器を再利用できる。
  既存2面は不変で、これはその合成である。dashboard活動を登録しない読み取り専用面とした。
- **着手候補が無いときに「検証済み」と読める出力**を直した。ready集合が空だと未検査taskの一覧も
  空になり、「未検査が1件も無い」が空虚に真となって、記録が古くても検証済みと答えていた
  （0.13.0のsmokeで露見）。述べる対象が無いことを独立の案内codeにした。
- 独立性投影の消費者へexact key検証を要求しないことを公開契約へ明記した。
  知っているkeyだけを読んでよく、Latticeは既存keyの意味を変えるときだけschema版を上げる。

## 0.13.0 — 2026-07-26

依存線の不在は「順序制約が申告されていない」ことしか意味せず、書き込み境界が干渉しないことは
意味しない。この2つを区別できず、工程表の横並びと`dispatch_frontier`が無申告をそのまま並列可と
提示していた。並列作業可能性を判定・記録・伝達する面を新設した。

**この版から0.12線のpatch運用を離れminorを使う。** `lattice.todo_mutation_result`をv1からv2へ
置換しており、6つのmutationコマンド全部のwireが変わる。v1を読む既存hostは更新が必要になる。
0.12線では公開result schemaの置換をpatchで出していたが（`todo_gantt_artifact` v1→v2、
`bridge_cli_result` v1→v2）、今回は新しい公開CLI面3つと合わせて変更量が大きく、
patchのまま出すと利用側が破壊的変更に気づけない。

- **並列可能性の判定と記録**を追加した（[ADR 0127](docs/adr/0127-todo-independence-projection.md)）。
  `lattice todo independence compile --plan <key> --input <witness_set>`が、ToDoごとの宣言境界
  （`lattice.todo_witness_set.v1`）と実sensor観測から並列可否を判定し、plan versionディレクトリへ
  `lattice.todo_independence.v2`として記録する。`lattice todo independence [--plan <key>] --json`は
  ready frontierを検証済み並列グループ・要直列の組・未検査へ分けて返し、**参照時にsensorを引かない**。
  判定は`(plan_version, topology_digest, base_sha)`へ束縛し、dirty worktreeでは記録しない。
  記録はwitness setから再生成できるhost localの投影として扱い、git追跡するのは入力の宣言だけとする。
- **conflictの切断可能性**を分類するようにした（[ADR 0128](docs/adr/0128-todo-independence-operational-wiring.md)）。
  symbol／path起因の衝突は`code_seam`（コードの分割で並列化しうる）、state／effect共有は`serial`
  （分割では切り離せない）。判定の元になるresource kindはcompile時にartifactへ焼き込む——
  宣言由来のstate resource idは任意文字列で、後から復元できないため。
- **着手時に助言を返す**ようにした。`lattice todo start`の結果が`lattice.todo_mutation_result.v2`となり、
  `advisory`で進行中ToDoとの競合・切断可能性・未検査の内訳を機械可読で返す。従来のgateは
  active taskが1件も無い初回にしか発火せず、**すでに誰かが走っている状態での着手**——最も競合
  しやすい場面——が素通りだった。助言であって拒否ではなく、ready frontier dispatch契約は変えない。
- **記録の鮮度をtask単位の事実として扱う**ようにした。従来は宣言境界と無関係なcommitでも全taskの
  記録が一斉に失効し、運用が進むほど「常に未検査」へ漸近していた。`base_sha..HEAD`のdiffと宣言境界を
  突き合わせ、交差したtaskだけを未検査へ落とす。diffを確定できない場合（rebase等）は全taskを落とす。
- **plan改訂後の宣言移行**に`lattice todo independence witness migrate --plan <key>`を追加した。
  revisionのtask migrationでtask_idを写す。写像だけを担い、宣言内容が改訂後も妥当かは主張しない。
- **工程表で独立性を示す**ようにした（[ADR 0129](docs/adr/0129-gantt-independence-presentation.md)）。
  カード内のバッジ（∥ 独立検証済／⛓ 要直列／? 未検査）と右ペインの内訳。記録があるplanでは
  「ready frontierは全件同時dispatchが既定」という無条件の断定をやめる。カード寸法と配線には
  触れないのでADR 0068の非交差gateへ影響しない。conflictを線で描くのは配線モデルに定義が無いため
  行わない。renderer版数を`v17`へ上げた。live配信の更新検知へ独立性を混ぜ、再compileが画面へ届くようにした。
- **読み方を製品自身が配る**ようにした（[ADR 0130](docs/adr/0130-lattice-describes-its-own-parallelism-surface.md)）。
  状況から`{code, message, next_action}`を引く案内の単一正本を持ち、advisory・投影・CLI helpが
  そこから引く。MCP server instructionsへ「依存線の不在は独立の証拠ではない／判定はCLI面で読める」
  節を足した。MCPへtoolは足していない——案内は構造を変えないが、toolは構造を変えるため。
- 吸収前CodeGraphの残骸（`.codegraph/`）を掃除した。索引は`.lattice/sensor/`へ移っている。

## 0.12.34 — 2026-07-26

- 0.12.31〜0.12.33で入れた配線変更を文書へ追従させた。依存線がカードとカードの間を通ること、真下へ
  繋ぐ線が一直線であること、依存を持たないToDoのブロックが接続済みToDoの上に来ることを、
  [ADR 0068](docs/adr/0068-gantt-routes-run-between-the-columns.md)として確定し、公開契約と表示仕様へ反映した。
  ADR 0066 Decision 7（edgeを持つToDoを段の先頭行に残す）は、それ自体が誤読事故の機構だったため置き換えた。
- dashboard daemonの入れ替えを公開契約へ書いた。publishとinstallを終えた版が、古いdaemonの生存を理由に
  配信面へ届かないままになることを許さない。待ち時間を固定秒数で打ち切らないことと、その帰結
  （登録project数に比例して`lattice status`の応答が伸びる）をREADMEへ明記した。
- 実daemonを起動するtestの後片付け規律を`AGENTS.md`へ規約化し、取り残しを掃除する
  `scripts/reap-orphan-test-daemons.mjs`をREADMEの開発節から辿れるようにした。

## 0.12.33 — 2026-07-26

- 依存の線がカードの下を通って隠れ、別の依存として読める欠陥を修理した（2026-07-25の実被害
  `fm-0640`の真因）。依存を持たない独立ToDoは同じ段の接続済みカードの**下**の行へ折り返していたが、
  接続済みカードの取り付け線は段全体の下にある帯まで垂直に降りるため、同じ列に落ちた独立カードを
  貫いていた。隠れた線の残り半分が「その独立ToDoから出た矢印」に見え、存在しない工程順を伝えていた。
- 独立ToDoのブロックを接続済み行の**上**へ移した。独立ToDoは辺を持たない以上、入辺も持たないので
  必ず最初の段に入る。最初の段へは何も到着しないため、上に置けば貫く線が構造的に存在しなくなる。
  実測で貫通はdotagentsの実store（218辺）663→0、bingo（139辺）2→0。
- 全経路×全カードの矩形非交差testから既知欠陥の除外を外し、例外なしで固定した。

## 0.12.32 — 2026-07-26

- publish済みの新しいcodeへdashboard daemonを入れ替えられず、公開面が古いまま取り残される欠陥を修理した。
  daemonはdescriptorを書く前に登録済み全projectのstoreを読むため、起動時間はproject数とstore規模に
  比例する（実測: 8 projectで約51秒）。入れ替え側の待ち時間は4秒固定だったので、実機では必ず競り負け、
  `DASHBOARD_DAEMON_UNAVAILABLE`で失敗して古いdaemonが残り続けていた。install済みのcodeと配信中の
  codeが恒久的に食い違う。
- 待ち方を、固定秒数の見積りから「spawnした子が生きている間は待ち、死んだら即座に諦める」へ変えた。
  `startupTimeoutMs`は無反応な子に対するbackstopという位置付けに変え、既定を120秒へ広げた。
  死んだreplacementを猶予いっぱい待たないことと、遅い子を待ち切ることを回帰testで固定した。

## 0.12.31 — 2026-07-26

- 工程図で段を跳ぶ依存線が、図全体の右端の外にある回廊まで走ってから縦移動して戻る配線をやめた。
  隣り合うカード同士の1 hopが図の全幅を往復する線として描かれ、どの線がどこへ繋がるか追えなかった。
  カードは全段で同じ列グリッドに載るため列と列の間はどの段でもカードが無い。段跳びの縦移動を、
  両端のカードの間にある列境界のうち最も空いているものへ通す。ギャップ幅は通行量に応じて広げ、
  通行の無い境界は従来の24pxのままにする。右側回廊は撤去した。
  bingo実store（scope all・139辺）で総配線長 981,896→303,596、幅 7044→5988、
  カード右端より外へ出る線分 222→0。
- 真下の工程へ繋ぐ線が一直線にならず、12pxずれた2本の縦線と短い横棒に見えていた欠陥を修理した。
  同じ列の隣接段を繋ぐ辺は出発と到着が同じ取り付け位置集合を奪い合っていた。両端の縦線は帯の中で
  1点で接するだけなので、この形の辺には枠を1つだけ確保して双方が参照する。
- 全経路×全カードの矩形非交差を回帰testで固定した。併せて、線がカードに隠れる既知欠陥
  （`docs/ui-review-backlog.md`）の原因記録を実測で訂正した。真因は段跳び経路ではなく、
  カード下端から帯へ降りるport stubがwave 0の独立ToDoを貫くことだった。こちらは未消化。

## 0.12.30 — 2026-07-26

- 配布文書`docs/bridge-setup.md`へ、LANへbindせずloopbackだけをssh逆トンネルで公開する構成を追記した。
  reverse proxy hostへsshで到達できる場合、bridge hostのaddressはreverse proxyのどこにも現れなくなるため、
  lease変更への追従も自己登録も不要になる。sshdの`GatewayPorts`、Docker container から見たloopbackの
  別物性、host firewallのINPUT DROPという実測3条件を併記した。
- 設定例から実配備のLAN addressと公開hostnameを外し、例示値へ揃えた。

## 0.12.29 — 2026-07-26

- 稼働中のbridgeが、DHCPのlease変更で待受アドレスを失っても気付かない欠陥を修理した。
  待受アドレスの解決はbridge起動時にしか走らず、reconcileは設定のfingerprintだけを見ていたため、
  設定が変わらないまま生きたsocketが死んだアドレスへ取り残され、公開siteが502を返し続けていた。
  プロセスは健康なのでprocess supervisorは再起動せず、新しいbindingが生まれないので
  reverse proxyへの自己登録も走らなかった。
- reconcileの各passで実効アドレスを解決し直し、活きたbindingがその位置から外れた時だけ
  張り直すようにした。静穏時は同値になるため、bindingの作り直しも再登録も起きない。
- listen IPがDHCPで動く場合の再bind規則とregistrar配線を`docs/bridge-setup.md`へ記載した。

## 0.12.28 — 2026-07-26

- manifest v2 storeへsuccessor revisionを適用した時、memberの
  `active_revision_digest`がpredecessorを指したまま残り、直後のreadが
  `manifest_revision_binding_mismatch`で停止する欠陥を修理した。
- manifest v2への通常revision適用後に新revision digestへ追従することを回帰testで固定した。

## 0.12.27 — 2026-07-25

- manifest v2へhistorical importで新規planを追加する際、memberの`active_revision_digest`を
  plan digestへ結合するようにした。従来はdescriptorから必須fieldが欠落し、
  `lattice todo migrate`が`import activation manifest invalid`で停止していた。
- manifest v2 storeへの追加と再読込を回帰testで固定した。

## 0.12.20 — 2026-07-25

- 右ペイン「全工程」のplan並びを、動いているplanが上、完走したplanが下になるようにした。従来はstoreのmember順で並べていたため両者が混ざり、実storeでは9plan中ただ1つの稼働中planが4番目に埋もれていた。動いているplanは最終活動の新しい順、完走planは古い順で並べ、plan内のToDo順は登録順のまま保つ。
- gantt renderer versionを`v16`にした。

## 0.12.19 — 2026-07-25

- 右ペインtoolbarのラベルを「元Markdown全文」から「全工程一覧」へ直した。2026-07-19のUI意味訂正で中身はstore由来の全工程一覧と裁定されているのに、ラベルだけが旧意味を指し、元Markdown本文の再表示を期待させていた。
- 未使用のMarkdown描画を削除した。renderer v7で右ペインからnarrative documentが外れた際に描画処理だけが残り、以後どこからも読まれないまま、dashboardがstore変更のたびに実行して捨てていた。narrative自体はanchor検証に必要なので読み込みと集約prose上限は維持する。
- 到達不能になったsection単位の上限変換経路も削除した。集約上限`TODO_GANTT_PROSE_MAX_BYTES`は従来どおりfail closedで効く。
- gantt renderer versionを`v15`にした。

## 0.12.18 — 2026-07-25

- 工程図の表示規約を[ADR 0066](docs/adr/0066-gantt-live-scope-drops-finished-work.md)として正典化した。ADR 0053の折畳み前提を採らず、既定表示は完走した工程を図から除き代わりの箱も置かない、という現行実装の決定を根拠つきで記録する。
- 公開契約・README・design仕様・CLI helpを現行の表示規約へ揃えた。CLI helpの「完走した枝を畳む」はまとめnodeを置いていた時代の文言だったので「図から除く（一覧には残る）」へ直した。
- design仕様の右ペイン節を実装どおり（概要・選択工程・全工程の3面）に書き直し、toolbarの「元Markdown全文」boxが全工程一覧を開くというラベルと実体の不一致、および出力へ載らないMarkdown描画を未裁定として明示した。

## 0.12.17 — 2026-07-25

- 段間隔を段ごとの実需で決めるようにした。従来は図全体で最も混雑した配線帯の幅を全段へ一律適用しており、実storeでは第0段の下を通る52本のedgeが要求する636pxが、edge 1本しか通らない47段にもそのまま適用されて、段間隔704pxのうち箱は68px＝縦の90%が空白だった。
- 依存を持たないToDoを段の中で折り返して格子に並べるようにした。前提を持たないToDoは全て第0段へ入るため、依存宣言の少ないstoreでは数百件が横一列に並んでいた（実storeでは781件中567件が依存edgeを1本も持たない）。edgeを持つnodeは経路計算の前提を保つため段の先頭行に残す。
- 実測（dotagents全工程）: 幅 182656 → 14784px、高さ 36004 → 8028px。面積で1/55。
- gantt renderer versionを`v14`にした。

## 0.12.16 — 2026-07-25

- 図から外した工程の件数バッジを、そのまま展開の入口にした。押すと全工程を描いた図へ切り替わり、もう一度押すと戻る。展開図は同じページへ同梱する（生成物はfile://でも開くため、問い合わせ先のあるlive dashboardを前提にできない）。実storeで+1.2MB、render +40ms。外した工程が無い場合は同梱もbuttonも出さない。
- gantt renderer versionを`v13`にした。

## 0.12.15 — 2026-07-25

- 概要パネルの決着済みPhase（accepted・rejected）を閉じたdetailsへまとめ、進行中のPhaseだけを展開するようにした。従来は状態に関係なく全件を展開しており、実storeでは10件すべてが受理済み、つまり進行中が1つも無いのに縦を占領していた。
- gantt renderer versionを`v12`にした。

## 0.12.14 — 2026-07-25

- 完走した工程を図から外し、代わりのまとめnodeも置かないようにした。畳み込みnodeは1個につき1列を占めるため、完走したplanが9つあれば9列が履歴のためだけに残り、図が生きた工程の何倍もの幅に伸びていた。nodeを除くだけでは閉路が生まれないので、縮約に必要だった粒度探索・閉路検査・合成node生成をすべて削除した。
- 上部のlane見出し帯を、図が描いているlaneだけに絞った。全plan全laneのchipを並べていたため、実storeでは82個のchipがSVGを11764pxへ広げ、graph本体1644pxの7倍を空列で占めていた。chipの件数は従来どおり外す前の全ToDoを数える（描画node 606→14、lane chip 82→8、SVG幅 11764→1684px）。
- 外した工程の情報は凡例・右ペイン「全工程」・各工程の詳細が持つ。詳細の前提・後続は外す前の依存から表示する。
- gantt renderer versionを`v11`にした。

## 0.12.13 — 2026-07-25

- 完走した枝の畳み込み粒度をplan単位へ粗くした。連結成分で束ねる従来の粒度は、完了ToDoが互いに依存を宣言していないstoreでは1件1nodeへ空振りし、実storeでは767件が592個の畳み込みnodeになって箱の数がほぼ減らなかった。粗い順にplan、plan+kept段数、plan+waveを試し、縮約が非閉路になる最初の粒度を採る（767件 → 9node、描画node 606 → 23）。
- 畳み込みnodeをクリックで開けるようにした。従来は合成nodeに詳細パネルが無く、図のnodeも一覧の畳み込み済み工程も選択が無反応で、生成済みの詳細パネルへ到達する経路が存在しなかった。畳み込みnodeは構成工程を並べ、各工程からは代表している畳み込みnodeへ戻れる。
- 畳まれた工程の前提・後続を縮約前の依存から表示するようにした。従来はunit内部edgeが捨てられた後のグラフを読んでいたため、依存があるのに「登録済みの前提工程はありません」と表示していた。
- 古い版を配信し続けるdashboard daemonを自動で置換するようにした。daemonは起動時に読み込んだコードを配信し続けるため、新版をinstallしても公開面が古いままになる（実際に公開工程表が9時間前のrendererを返し続けた）。health payloadへ起動時の版数を載せ、`lattice status`が通るたびに版差を検知して入れ替える。
- gantt renderer versionを`v10`にした。

## 0.12.12 — 2026-07-25

- `bridge status`が到達性を報告するようにした。設定したlisten addressがホストに存在するか（`listen_state`）、実際に接続を受け付けるか（`reachable`）を別々に返す。従来は`enabled: true`とだけ答え、公開surfaceが落ちていても健全に見えていた。
- bridgeが同一subnet内の現アドレスへ自動で再bindするようにした。別network・loopbackは自動採用せず、代替が無ければ`BRIDGE_LISTEN_ADDRESS_ABSENT`でtypedに失敗する。
- 新しいbindingを張るたびにreverse proxy hostへupstreamを自己登録するようにした（`lattice bridge register`で手動実行も可能）。`ssh <host> <script> <port>`の固定形だけを実行し、アドレスは送らずremote側がssh送信元から決めるため、呼び出し側は自分自身しか登録できない。`LATTICE_BRIDGE_REGISTRAR_SSH_HOST`と`LATTICE_BRIDGE_REGISTRAR_SCRIPT`の両方が設定された時だけ動く。
- registrar設定をLaunchAgent plistへ引き継ぐようにした。launchdはshell環境を継承しないため、これが無いとdaemonの自己登録が永久に発火しない。

## 0.12.11 — 2026-07-25

- 依存工程図が既定で完走した枝を畳むようにした。生きた工程とその直接の前提工程は必ず展開したまま残し、全件を描くには `todo gantt --scope all` を使う。総数・lane集計・最長依存鎖・ready frontierは畳み込み前の全工程で数える。
- `todo gantt` artifact descriptorを`v2`にしてscopeを記録し、`todo gantt status`がscope違いの生成物を陳腐化と誤判定しないようにした。
- revisionでcarryされた完了時刻不明のimported ToDoへ`evidence promote`できるようにした。reopenと同じくplan_genesisのstate migrationへ束縛する。
- publish前検査がuntrackedファイルも拒否するようにした。従来はtrackedのdirtyしか見ておらず、未commitのファイルが公開tarballへ混入しうる状態だった。ignore済みは従来どおり対象外。

## 0.12.10 — 2026-07-25

- revisionでcarryされた完了ToDoを`todo reopen`できるようにした。後継journalにdoneイベントが無い場合でも、完了を運んだ`plan_genesis`のstate migrationへ束縛する。doneでないtaskのreopenは従来どおり拒否する。
- `todo status --json | head`のように結果を部分的に読んでも、未処理EPIPEでstack traceを出してexit 1になることをやめ、静かにexit 0で終えるようにした。EPIPE以外のstream errorは従来どおり失敗として落とす。

## 0.12.9 — 2026-07-25

- Phaseを持たない先行planからのcarryを、typed `REVISION_INVALID`で拒否するようにした。
- `phase_todo_revision.v1`/`v2`の適用でmanifestの`active_revision_digest`を追従させ、revision後にstoreを読めなくなる欠陥を直した。
- 新規plan authoringの入口の記述を実装どおりに書き直した。
- publish対象commitが既定ブランチの祖先であることを`prepublishOnly`の機械gateで強制するようにした。

## 0.12.8 — 2026-07-23

- Phase v3の後続revisionで、既存active sourceを同じ`source_cutover_batch`の明示操作により新しいarchiveへ移転できるようにした。
- cutover操作・旧ref/digest・移転先inventoryが一致しないsource消失は、従来どおり`predecessor_source_silently_dropped`で拒否する。

## 0.12.7 — 2026-07-23

- 巨大工程図のrender中にhealth応答が500msを超えても、生存中dashboardを死亡扱いして新daemonを孤児化しないようにした。
- dashboardはmanifest file identityが変わらない間のstable store readを再利用し、active projectの毎秒再読みと重複renderによるCPU・メモリの自己増幅を防いだ。
- public bridgeのloopback attestationはPID・port一致を維持したまま、正常なbusy health応答を待てる上限へ更新した。

## 0.12.4 — 2026-07-22

- `run abandon --reason`で日本語・空白・句読点を含む監査可能な説明を受理し、表示を偽装するUnicode制御文字・前後空白・256文字超過をCLIとmanaged control wireの共通validatorでmutation前に拒否するようにした。
- `BOUNDARY_UNKNOWN`へ元witnessを残し、fresh path不存在だけを`BOOTSTRAP_OWNERSHIP_SEAM`、既存path・symbol・未束縛ownershipを`ACQUIRE_OWNERSHIP_EVIDENCE`へ分けて安全な次手を機械可読化した。

## 0.12.3 — 2026-07-22

- activeな`phase_todo_revision.v1/v2`でも履歴上の有効source inventoryを解決し、`todo verify`がsource driftを検出して実件数を返すようにした。
- `phase_todo_revision.v3`適用時はinventory差分より先にpredecessor source実体を検証し、物理driftを`predecessor_source_silently_dropped`へ誤分類しないようにした。
- product suiteの並列数を4へ固定し、sensorのMCP初期化test cleanupへbounded retryを追加して、full gateの資源競合を安定化した。

## 0.12.2 — 2026-07-22

- unpublish済みの0.12.1と同一機能を、再利用可能な新versionとしてprivate registryへ再公開した。
- `publishConfig.access`を`restricted`へ固定し、以後のnpm publishが意図せずpublicへ戻らないようにした。

## 0.12.1 — 2026-07-22

- crash後にstale daemon descriptorだけが残ったbridge再構成を`not_running`へ収束させ、停止receipt timeoutで公開経路を復旧できない問題を修正した。
- actor環境のないsession開始時の`lattice status --json`でもactive projectをdashboardへ登録し、既存セッションのprojectが一覧から欠落する問題を修正した。
- 親環境の`FORCE_COLOR`がCLI JSON-only testへNode警告を混入させないよう、子process環境を明示的に隔離した。

## 0.12.0 — 2026-07-22

- actor付きの通常TODO activityからactive projectを自動登録し、一つのloopback dashboardでproject一覧、project固有工程図、SSE更新を提供するようにした。
- Ganttの依存線を専用channelへ直交routingし、box回避、join connector、交差bridgeを追加した。
- 明示IP bindとHost allowlistを持つopt-in network bridge、daemon自動復旧、reverse proxy向けの配備手順を追加した。
- managed runtimeに保存済み競合のfreeze、全running barrier、successor再compile、epoch再bindを追加し、AIShellの実fixtureで競合回収をend-to-end検証した。
- bundled sensorのaffected結果へ`Tests/`配下および`*Tests.swift`のSwift testを含め、既存の`e2e/`分類も維持した。

## 0.11.3 — 2026-07-21

- TODO mutationのactor解決失敗へrequired／missing／invalid環境キーと正規次操作を追加した。
- OS由来identityへのfallbackとstore変更は行わず、callerが設定不備を機械判定して同じ操作を再試行できるようにした。

## 0.11.2 — 2026-07-21

- bundled sensor失敗時にexit code、signal、bounded stderrを保持し、未初期化をtyped errorへ分類した。
- 未初期化syncへ同一pathの正規`lattice sensor init`次操作を返し、silent initやfallbackを追加せず根因を公開した。

## 0.11.1 — 2026-07-21

- 公開subcommandの`--help`／`help`入口を追加し、`todo reopen`等の正規optionをstore非依存で確認可能にした。
- namespace helpと同じclosed surfaceからusageを返し、未知subcommandは従来どおりusage違反で拒否する。

## 0.10.0 — 2026-07-21

- `todo status` v4へ全readyを同時dispatchする`dispatch_frontier`契約を追加した。
- readyが複数の最初の`todo start`に並列開始宣言または意図的直列化理由を必須化した。
- Ganttのready表示を「依存候補」から「同時dispatch推奨」へ更新した。
- Phase監査境界・監査回数・ToDo DAGは変更せず、Phase groupingによる暗黙直列化を再導入しない。

## 0.9.1 — 2026-07-21

- PhaseをToDoの直列化groupから重監査境界へ分離し、通常ToDoはDAGだけで並列readyを判定するv5契約へ更新した。
- Phase受理が本当に必要なToDoだけを閉じる`phase_accept_dependencies`と、v3 authoring schemaを追加した。
- fresh projectのtyped discoveryがv3 authoring schemaと生成commandを`next_action`で返すよう更新した。
- live GanttをSSEで自動更新し、静的Ganttのdigest付き`current / stale / missing`検証を維持した。
- runtime、project state、設定、環境変数、MCP tool名をLattice Sensorへ完全切替し、旧製品dataを入力・移行元・fallbackとして読まない契約を固定した。
- 新規AIShell cloneで48 files／797 nodes／2078 edgesを構築し、`DevelopmentRuntimeService`のdepth 3 impactが74 nodes／107 edgesになることを現行sensorだけで確認した。
- 製品testと退役済みartifact replayを分離し、公開判定が現行runtime surfaceだけを評価するようにした。

## 0.9.0 — 2026-07-21

- first-class Phase controlを追加し、ToDo完了時の軽量確認とPhase境界の重監査を分離した。
- `todo phase status/review/accept/reject/reopen`、Phase state migration、Decision evidenceを追加した。
- `todo revise-set` v3でPhase revision同士、およびPhase revisionと通常revisionのcross-plan atomic activationに対応した。
- `todo status/verify --json`の互換aliasを復旧し、cross-plan start/done/reopenの判定をmerged storeへ統一した。
- loopback-onlyのlive Ganttを追加し、静的Ganttには`current / stale / missing`を判定するdigest付きstatus面を追加した。
- bounded seamの隔離transform契約を追加し、許可locus外の変更をfail closedにした。
- 外部の旧上流runtime・旧cache/dataへの依存を廃止し、配布物内のLattice sensorだけを正式runtimeとした。
- Phase revisionの全6 durability境界と、通常／Phase混在revision setのcrash retryを検証した。

## 0.8.0 — 2026-07-20

- project-local run storeと`run list/resume/close/abandon`を正式化した。
- runtime/control timestampをcanonical UTC millisecondsへstrict化した。

## 0.7.3 — 2026-07-20

- private Lattice sensor runtimeを配布物へ固定し、公開`codegraph` binを除去した。

## 0.7.0 — 2026-07-20

- 旧上流由来実装をLattice所有sensorへ吸収し、公開入口を`lattice sensor`へ切り替えた。

## 0.6.4 — 2026-07-19

- `readTodoStore`のpinned source検証を1回のread内でcommit・blob単位にmemoizeし、同じsourceを持つhistorical import taskごとの重複`git cat-file`を除去した。
- 653 active tasks / 7 plansのdotagents実storeで`lattice todo status`を8.41秒から0.29秒へ短縮し、Claude/Codex SessionStart hookの内部5秒timeout内へ戻した。

## 0.6.3 — 2026-07-19

- source verifierで`0a. [x]`や`6A. [ ]`など数字＋英字付き番号のcheckboxを正規TODOとして認識するようにした。
- dotagents inventoryとLattice reviseのcheckbox認識を揃え、migrate後のanchor校正が`source_item_not_todo`で停止する不一致を解消した。

## 0.6.2 — 2026-07-19

- `carry_reconciled_metadata`を追加し、実行意味と依存を変えずにsource provenanceと親子関係だけを校正できるようにした。
- metadata校正時も既存task state・evidenceを保存し、title・lane・compile binding・dependency・join変更はfail closedで拒否する。

## 0.6.1 — 2026-07-19

- NPM pack前にsensorを必ずbuildし、gitignoreされた古い`dist`が公開物へ混入する経路を塞いだ。
- `0.6.0`の公開物でNode.js 26を誤って遮断した生成物を、source契約どおりNode.js 25だけを拒否する生成物へ更新した。

## 0.6.0 — 2026-07-19

- `lattice todo revise`で、active planを直接書き換えずsuccessor revisionを原子的に発行できるようにした。
- `lattice.todo_plan.v3`、`lattice.todo_event.v2`、
  `lattice.todo_revision.v1`を追加し、task stateのcarry・reset・removedを
  機械検証する。
- source inventoryとreconciliation digestをrevisionへ固定し、source drift、
  stale predecessor、異なるretry bytesをfail closedにした。
- `lattice todo status`と`lattice todo verify`へrevision・reconciliation状態を
  公開した。
- removed taskのpredecessor journalとevidenceを不変保存し、crash recoveryとexact retryを検証した。
- Node.js 26を正式サポートし、既知の非互換があるNode.js 25だけを拒否するようにした。

## 0.5.0 — 2026-07-18

- 依存工程図renderer v7と、active taskの未達依存を示すstatus v2を追加した。
