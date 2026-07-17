# ADR 0049: Lattice MCP面の公開契約（session code intelligence面の新設）

- Status: **Accepted**
- Date: 2026-07-17
- 関連: ADR 0044（CLI 6面）、ADR 0047/0048（Codegraph吸収・sensor所有）、
  dotagents親plan Phase L3／L7（shadow同等性gate→Codegraph退役→cutover）

## Context

dotagentsオーナー裁定（2026-07-17）により、CodegraphはLatticeへ完全吸収され、第三者Codegraph MCPが
提供してきたsession内code intelligence（`codegraph_explore`相当）を**Lattice MCP面が継承**する。
吸収済みsensorはupstream由来のMCP実装を既に保有する: 8 tool（`codegraph_search` / `codegraph_callers` /
`codegraph_callees` / `codegraph_impact` / `codegraph_node` / `codegraph_explore` / `codegraph_status` /
`codegraph_files`）、detached共有daemon＋stdio proxy構成、client refcount＋idle timeoutによる自動終了、
daemon失敗時のin-process直接実行、upstream GitHubへのupdate-check／self-upgrade導線、既定ONの
外部telemetry。**吸収時点ではpackage名・version系列・global状態dir（`~/.codegraph/`）が
upstreamと未分離**であり、これが併走期間の安全性を規定する（Decision 4/5/7の前提）。

Latticeの既存公開面はCLI 6面（`plan compile` / `plan verify` / `run start` / `run observe` /
`run status` / `event verify`・stdout versioned JSON 1行・exit 0/1/2・fail closed）であり、製品契約は
exact key・canonical serialization・暗黙fallback禁止を要求する。RC3制約として「CLI+driver常駐でない」
（自動dispatch常駐サービスを持たない）を明文化している。

## Decision

1. **面の位置づけと責務分離**: Lattice MCP面は「session code intelligence面」であり、CLI 6面
   （orchestration契約）とは別種の公開面である。**Latticeのplan／witness契約が消費するevidenceは
   CLI面・portable projectionのみ**とする。この防壁の実効性は禁止条項ではなく構造が担う——
   graph系evidenceは`plan verify`の**独立再計算＋canonical digest完全一致**が機械的に強制するため、
   MCP proseの手写しは構造的に無効である。手動evidence fieldへ入ったMCP由来テキストは
   「人間入力と同格の未検証assertion」として扱い、防壁の保証対象外と明記する（検出は要求せず
   格付けで処理する）。run request側へのprovenance種別導入はRC4 Stage 1の裁定事項として送る。
2. **tool面**: v1は吸収済みsensorの8 toolを**そのままの名前・入力schemaで**公開する。
   根拠: (a) 同一入力を同一名で新旧両系へ投げられる**入力面の同型性**（shadow record/replay比較の
   前提。出力の比較には正規化仕様が別途必要であり、その所有はL7 planに委ねる——除去対象:
   更新通知・絶対path・タイミング・truncation境界等）(b) 既存agentの利用習慣・host docsとの互換。
   `lattice_*`への改名は**L7 cutover受入の完了条項に改名ADRの起票を含める**ことで恒久化への漂流を
   防ぐ。server instructionsに「`codegraph_*` toolはLattice sensorが提供する」旨を明記する。
3. **製品同一性の分離（v1受入条件・全Decisionの前提）**: upstream identityを3点で分離する。
   (a) **version名前空間化**: sensorのversion文字列をLattice系列（例 `1.4.1-lattice.1`）へ移す。
   daemon rendezvousのhello照合は完全一致のため、これだけで**異製品daemonは構造的に常時
   mismatch側へ落ち**、同一version偶然一致による無言のcross-product attachが不可能になる。
   `-lattice.` markerの有無で「同製品の版差」と「異製品」をhello上で判別できる。
   (b) **global状態dirの分離**: daemon discovery registry等のホーム側状態を`~/.codegraph/`から
   Lattice固有path（`~/.lattice/sensor/`配下）へ移し、tmpdir socket relocate名にもLattice固有
   prefixを与える。これにより第三者Codegraphの`stop --all`によるLattice daemonの**越境kill**
   （machine-global registry共有起因・project横断）を遮断する。
   (c) package.json読取失敗時のsentinel version（`0.0.0-unknown`）はビルド破損であり、
   恒久mismatchとして沈黙させず**起動時fail**にする。
4. **外部通信の遮断（v1受入条件）**: 継承コードのupstream GitHubへのupdate-check・self-upgrade・
   release download導線（`checkForUpdateInBackground`・`upgrade/`・tool出力／server instructionsへの
   更新通知混入）は**無効化する**。upstream版によるsensor上書きはADR 0047/0048の改良を静かに
   破壊するため、製品同一性の問題として扱う。sensorの更新はLattice自身のrelease面のみが行う。
   **telemetryは既定ONで外部endpointへ送信するため無効化する**。update-checkキャッシュ等の
   ホーム側残置物も棚卸しに含める。**v1受入条件: MCP面（proxy・daemon・direct全経路）は外部
   networkへ一切通信しない**ことをverify対象にする。なお本条件はDecision 3(a)が前提——
   異製品daemonへのattachが可能なままでは、tool callが第三者daemon内で実行され遮断が破られる。
5. **実行モードの契約（typed degradation）**: daemon経由（primary）とin-process直接実行（direct）は
   無条件の等価ではない——等価には(a)同一package version (b)同一index状態、の2前提が要る。
   ①directへの切替を許す事由は**列挙制**とする: daemon不在／socket接続不能／opt-out指定／
   `.codegraph/` root不在（Decision 6①の誘導経路）／session途中のdaemon接続喪失（in-process継続・
   in-flight再serve）／transport系のproxy setup失敗。
   ②DB open失敗・schema不整合・integrity異常・lock異常は**fail closed**（directで隠さない。
   現実装のfallback engine初期化失敗の握り潰しはこの改修対象に含む）。
   ③hello mismatch時は二分する: **異製品**（`-lattice.` marker無し）→socket衝突（第三者Codegraph
   daemonの可能性）を名指しするtyped error。**同製品の版差**（marker有り・self-update直後の
   正当な旧daemon残存等）→directへdegradeし`mode: direct`／`reason: version-skew`で機械可読に
   宣言する（旧daemon watcherとの再index併走が起きうる点は既知の限界として明記）。
   ④実行モードは`codegraph_status`出力の**機械可読field**（`mode: daemon|direct`・`reason`）として
   契約化し、人間向けstderr通知に委ねない。`codegraph_status`のtool descriptionも
   「版・index schema・実行modeの宣言面」へ更新する。
6. **index不在の意味論（三分法）**: ①index不在project→**成功shapeの明示guidance**
   （`codegraph init`を名指しする定型文。空結果と区別可能）。isErrorにしない理由はupstreamの
   実観測（session序盤のisErrorはagentに「toolset全体が壊れている」と学習させ以後呼ばれなくなる）
   を踏襲するempiricalな裁定であり、製品契約のfail closedとは「agent誘導面での明示的な不能宣言」
   として両立する。②真の故障・security refusal→isError。③server自体が成立しない
   （sensor build欠如等）→起動時fail（exit 1）。
7. **併走期間の分離と排他の機構**: 併走期間、**同一hostに両MCP（第三者`codegraph`とLattice
   `lattice`）をuser scopeで同時登録しない**（host単位排他）。project粒度の使い分けが必要な場合は
   project scope設定で行う。切替時は旧daemonを掃除（`stop --all`相当）してから登録する
   （登録解除後もdaemonは最長30分残存するため）。違反時の実害: 同一`.codegraph/` DBの取り合い
   （「最後にindexした側が答える」）、旧実装同士のsilent attach、越境kill（Decision 3(b)適用前）。
   **L7のshadow同等性比較はhost同時配線では行わず、index snapshotを固定したoffline／CLI
   record-replayで行う**。比較手順の正本はL7 planが所有し、本ADRを参照する。
8. **entrypoint**: MCP serverは**別bin `lattice-mcp`**（`bin/lattice-mcp.mjs`）とし、CLI 6面の
   公理（stdout versioned JSON 1行・exit 0/1/2・`lattice.cli_error.v1`）は`bin/lattice.mjs`にのみ
   適用される。工場のMCP command慣習（`gpt-connector-mcp`等）とも一致する。`lattice-mcp`の契約:
   ①stdoutはMCP protocol frame専用・診断は全てstderr（継承コードのstdout混入がframeを壊さない
   ことをテスト対象にする）。②**内部daemon再invoke形（`serve --mcp --path`相当＋internal env）を
   受理する**——これを拒むとdaemonが永遠に起動せず「daemon不在」経路でdirect固定化する
   silent degradationを本ADR自身が作るため。③exit意味論: 起動前usage違反=exit 2、起動時精査
   失敗=exit 1＋stderrへ`lattice.cli_error.v1` 1行、正常session終了（stdin close・host喪失系の
   watchdog終了を含む）=exit 0、session確立後のuncaught fatal=exit 1（`cli_error.v1`なし）、
   liveness watchdogによるsignal終了あり。session確立後の通常失敗はMCP protocol errorであり
   processを終了しない。親別matrix上のMCP server IDは`lattice`とする。
9. **常駐非目標との両立**: 「常駐サービス化はしない」はLatticeのorchestration面の非目標
   （自動dispatchを行う常駐driverを持たない）である。MCP serverはhost sessionのstdio子プロセス
   （session寿命）、共有daemonはclient refcount＋idle timeoutで自動終了するcache工程である。
   どちらも**自律的なdispatch・製品状態への書込を行わない。書込はproject cache（`.codegraph/`
   配下）へのwatcher再indexと、Lattice固有のglobal管理領域（Decision 3(b)）・socket rendezvous
   nodeに限る**。stale daemon（lockfileのpid＋version残存）とversion skew時挙動はこの主張の
   反証候補として監査対象に含める。この区別を製品契約（00_product-contract.md）へ追記する。
10. **登録・検証**: 親別matrix（Claude親・Codex親）への`lattice` MCP登録はhost変更＝H。
    isolated HOMEでの登録・疎通検証を先行し、実端末適用はオーナー承認後に限る。

## 諮問・反証記録（2026-07-17）

- **fableスポット諮問**（read-only・9指摘）: 採用=①upstream self-upgrade導線の無処理（→Decision 4）
  ②併走socket/DB衝突とL7測定妥当性（→Decision 7）③direct等価主張の条件化・mode機械可読化
  （→Decision 5）④index不在の三分法（→Decision 6。Draft v1の「明示エラー」を撤回）
  ⑤`lattice mcp`のCLI公理衝突（→Decision 8で別binへ変更）⑥evidence防壁の構造化（→Decision 1）
  ⑦tool名維持根拠の弱化と改名引き金の固定（→Decision 2）⑧daemon書込の正確化（→Decision 9）
  ⑨status description更新（→Decision 5④）。
- **クロスprovider `codex_opinion`**（7反対）: 採用=direct実行のtyped degradation・fail closed境界
  （→Decision 5）、別bin `lattice-mcp`（→Decision 8）、併走時の測定妥当性懸念（→Decision 7）。
  **棄却**=全tool出力のversioned semantic envelope化（比較妥当性はsnapshot固定harness＋正規化仕様で
  達成でき、agent対話面へのexact-key契約はCLI面と二重化する。改名ADRでの再検討事項に格下げ）、
  `lattice_*`への即時改名（入力同型性と利用習慣の利益が実在。恒久化はDecision 2の引き金固定で防ぐ）、
  run requestへのprovenance field即時導入（CLI契約変更でありMCP面ADRの範囲外。Stage 1裁定へ送る）。
- **fable refuter**（Draft v2への反証6件・全採用）: ①製品識別なきhello完全一致による同一version時の
  無言cross-product attach（→Decision 3(a)新設）②global registry共有による越境killと書込文言の虚偽
  （→Decision 3(b)・9）③version mismatch一律typed error化がself-update直後の正当な旧daemon残存を
  全滅させる（→Decision 5③の二分法）④同時有効化禁止と登録粒度の不整合（→Decision 7の排他機構）
  ⑤daemon内部再invoke拒否によるdirect固定化とexit表の異常系3クラス（→Decision 8②③）
  ⑥direct切替事由の列挙不足とfallback engine初期化失敗の握り潰し（→Decision 5①②）。
  確認済み: Decision 4の対象特定（telemetry既定ON含む）・Decision 6の実装一致・棄却3件の妥当性・
  Decision 1の構造防壁・入力同型性の利益。

## Consequences

- 実装対象: version名前空間化とglobal状態dir分離（Decision 3。反証1〜3の根治を同一waveで行う）、
  update-check/upgrade/telemetry導線の無効化、`bin/lattice-mcp.mjs`（内部再invoke受理＋起動時精査）、
  `codegraph_status`のmode/reason field＋description更新、hello二分法（typed error／version-skew
  degrade）、fail closed境界の明示化（fallback engine初期化失敗の握り潰し改修を含む）、
  index不在guidanceの定型化確認、stdout純度テスト、sentinel versionの起動時fail化。
- 検証対象: 外部network遮断（全経路）、異製品daemonへの非attach、isolated HOMEでの親別登録・疎通、
  mode fieldの機械可読性。
- L7 planへ委譲: 出力比較の正規化仕様、offline record/replay比較手順、cutover受入完了条項への
  改名ADR起票の組み込み。
- 00_product-contract.mdへの追記: MCP面の位置づけ（Decision 1/9の要旨）。
- dotagents親matrixへの反映: 併走期間のhost単位排他と切替手順（Decision 7）。
