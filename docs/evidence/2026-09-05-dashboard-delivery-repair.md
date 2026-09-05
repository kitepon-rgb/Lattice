# 工程登録から公開配信までの修理

対象版: 0.68.0。着手時は正規repositoryをclone後、`git pull --ff-only`で更新なしを確認した。
基点は`4bd31bebdc23fd1c840278b23773db16492743c8`。

## 原因と変更

movieの工程はローカルに保存されていたが、端末のbridge設定がなく、公開hubに登録されていなかった。
Latticeの任意公開契約は維持する。失われた公開先を推測して有効化する根拠はない。
このPCは以前配信できており、hubに8月30日10:05 JSTまでの記録がある。現在のユーザーフォルダの作成時刻は
同日12:07 JST。環境再作成時の設定引継ぎ漏れは仮説であり、設定が失われた経緯は未特定。
今回の停止は端末設定の欠落による。追加機能は全OS共通の配信状態通知・到達確認であり、設定消失原因の修理とは区別する。

- `status`とToDo保存操作は、工程結果のstdoutを維持し、stderrへ配信結果を返す。
- 設定済みbridgeの常駐欠落・実行体のずれは、工程入口から正規reconfigureで復旧する。
- hub付きsetup/reconfigureはローカルdashboardを起動し、登録、一覧のonline表示、工程HTMLの中継を確認する。
- 明示のdashboard ensureは配信失敗を非0で返す。通常の保存操作は配信障害でも工程の保存結果を返す。

通常のstore操作前にdashboardを登録する既存契約は維持した。配信結果はその時点の工程の到達性を示し、
保存後の特定revisionの公開反映までを証明するものではない。公開HTTPSとSSEは導入後に別途実測する。
bridgeとhubの通信は既存の登録プロトコルを使い、別の配信経路や利用側wrapperは追加していない。

## 境界観測

Lattice sensorを初期化し、`ensureTodoDashboardActivity`、`ensureActiveProjectDashboard`、
`runProjectStatus`、`runBridgeCli`のcallerと影響試験を確認した。
ローカルregistryの実装は変更せず、既存の工程操作とbridge CLIに配信結果の確認を接続した。
配信確認の実装は`src/dashboard-delivery.mjs`が所有し、共通CLIから呼ぶ。
Macの`bridge-launch-agent.mjs`とWindowsの`bridge-startup-folder.mjs`は変更しない。
bridgeのstdoutは既存v4を維持し、配信結果をstderrへ出す。
常駐復旧には既存のOS固有入口を使い、版だけのずれは既存の自動更新に任せる。
追加で保存処理の`atomicWrite`、`atomicWriteMode`、`readTodoStoreStable`を観測した。
動的呼出し・外部サービスの挙動はsensor単独では証明できないため、focused testと実機測定で補う。

## 検証中に確認して修理した既存不具合

- Windowsの文書検査は`spawnSync npm.cmd`が`EINVAL`を返し、配布物を検査できなかった。
  Windows分岐だけでnpmが正規に渡す`npm_execpath`を現在のNodeで実行する。Macのnpm呼出しは維持する。
  文書・配布物内リンクの検査8件が通った。
- 全製品試験の初回は1,885件中1件が、並行読取中のmanifest差し替えの`EPERM`で失敗した。
  該当試験だけでも再現した。独立した実ファイル100回の測定では、`readFile`との競合62回、
  `realpath`との競合31回が失敗し、読み取り終了後の再実行は全件成功した。
  同じatomic renameをWindowsでだけ短く待つ処理をstoreの2つのatomic writerへ接続した。
  試験用のmanifest公開も同じ処理を使う。恒久拒否は元のエラーを返し、途中のbytesは公開しない。

## 検証結果

- 共通配信処理・CLI・dashboard registry・OS固有起動処理の関連試験: 106件中92件成功、14件は対象OS等の条件でskip。
- 復旧後の設定再読込と、版だけのずれで再設定しない条件を追加後、配信・bridgeの26件が成功。
- Windowsのatomic publishとstore関連試験は修正後に成功した。
- 公開設定のない試験環境には独立したbridge設定ディレクトリを割り当て、実端末の配信設定を使わせない。
- 最終の`npm run ci`はWindowsで終了コード0。製品試験は1,889件中1,708件成功、181件skip。
  sensor試験は2,491件中2,289件成功、202件skip。文書、構文、CLI、公開面の到達性、store検証も成功。
  Mac実機でこの修正版を確認した結果とは区別する。

## この端末の復旧実測

2026-09-05 21:43 JSTに、端末状態のtar退避後、導入済み正規版0.67.5の`bridge setup`で接続設定を復元した。
接続先は稼働中のhubから確認した値を使った。製品改良の導入に先立って既存版だけで配信が戻ったため、
今回の停止をWindowsの配信機能欠落とする仮説は棄却する。

- Startup Folderの登録、実行体の存在、bridgeの稼働、登録heartbeatの受理を確認。
- hub一覧でmovieと、既存登録済みLiveTRがonlineになった。
- 公開HTTPSのmovie画面が200を返し、ブラウザーで開発計画と動画理解評価8工程を確認。
- 21:45 JSTの確認でHTMLとSSE初回状態のdigestが一致し、切断後の再接続でも一致した。
- 修正版の共通配信確認関数も、復旧した実環境に対して`hub_delivered`を返した。

公開URL: https://lattice.kitepon.dev/projects/movie/

この復旧実測時点では、修正版のnpm公開・global installはnpm認証待ちのため未実施だった。
稼働中のbridgeは0.67.5。設定消失の直接原因となった操作は未特定のままとする。

## GitHubのMac CIで発見した文書検査の互換性

修正版をmainへpushした後、Mac CIは製品試験開始前の配布文書検査で停止した。
`npm pack --json`の戻り値を配列に限定していたため、npm 12のobject形式を受け付けなかった。
同じコマンドをWindowsでnpm 12.0.2から実行して再現し、原因をOS差ではなくnpm版差と確認した。
共通の読込処理だけで新旧形式を扱う修正を追加した。
出典と再現手順は[RAG](../../rag/npm-pack/npm-12-report-compatibility.md)に保存した。

修正後はWindows上のnpm 11.17.0・12.0.2で`check:docs`がそれぞれ成功した。
source commit `a209059fa2fc24960ef80870444ab19644afe521`の
[GitHub CI](https://github.com/kitepon/Lattice/actions/runs/33967354439)では、Mac実機の全検査が成功した。
同時点でWindowsは旧commitの検査から最新commitへ切替中、Linux・WSL2は実行機未割当で待機している。
旧commitのCIは最新commitへ集約するため取消要求を送った。この時点の公開版は0.67.5だった。

## Windows CIのprocess観測失敗

Windows CIの停止をrunnerのログと実processから切り分けた。サービスのPATHにはPowerShell 7があるが、
旧Windows PowerShellの実行体は含まれていなかった。製品内の2か所が`powershell.exe`を固定しており、
`spawn powershell.exe ENOENT`からprocess identity取得が失敗した。
さらにatomic commitの競合試験が開始前エラーを飲み込んで、開始通知を永久に待っていた。

runnerと同じPATHを子processへ渡した関連試験で再現し、Windows分岐とWindows専用moduleの入口を
`pwsh.exe`へ修正した。試験の開始前エラーも待機側へ伝える。Mac・Linuxの`/bin/ps`経路は変更しない。
sensorで`observeStartIdentityRaw`のmanaged supervisorへの影響と、
`observeWindowsWorkerProcess`のpull intakeへの影響、対応する試験を確認した。
修正後の最小再現は17件中16件成功、1件skip、失敗・取消0だった。
同じrunner PATHで関連範囲を広げた26件も24件成功、2件skip、失敗・取消0だった。

## 最終CIで観測したbridgeの競合

commit `c4d88740`の最終CIでは、Windowsのprocess観測とatomic commit試験は通過した。
一方、Macの既存端末ID同時生成試験が`Unexpected end of JSON input`で失敗した。
`writeFile(..., flag: 'wx')`は存在の排他だけを保証し、完成前のファイルを別呼出しが読めた。
共通処理で一時ファイルの書込みを終えてからhard linkで公開するよう修正した。
既存IDは置換せず、競合側は公開済みの完成したIDを読む。sensorでheartbeat controllerと
bridge本体への呼出し境界を確認した。競合試験は24並行・20回でID一致・保存内容・一時物の除去を確認する。

同CIのWindowsでは、bridge試験の固定ポート58741が`EADDRINUSE`となった。
失敗した試験のbindだけを既存のport 0対応へ揃え、OSが確保した実ポートへ接続する。
製品のポート競合エラーを隠す変更は行わない。

## npm認証

Windows CLIが発行した認証URLをオーナーがMacで開き、指紋認証した後、Windows側のlogin終了コード0と
`npm whoami`の`quolu`を確認した。Windows側のnpm認証は完了している。

## 0.68.0の公開と実環境

source commit `efdce4acfca8e34baabc34d6981f8291f16c9916`の
[最終CI](https://github.com/kitepon/Lattice/actions/runs/33968992235)はMac・Windowsとも成功した。
製品試験はMac 1,892成功・5skip、Windows 1,708成功・181skip。sensorと全静的検査も成功。
Linux・WSL2の工場jobは実行機未割当で待機し、検証済みとは扱わない。

npmの公開追加認証後に`@quolu/lattice@0.68.0`の公開終了コード0とregistryの版を確認し、
公式のglobal installを実施した。このWindowsのCLIと常駐bridgeは0.68.0になった。
bridgeのheartbeatはaccepted、常駐設定とruntimeのずれはなし。
公開HTTPSのmovie画面で評価計画を確認し、HTML・SSE・再接続時のdigest一致も再確認した。

ただし、更新後の`bridge reconfigure`はdashboard子processの起動失敗
`DASHBOARD_DAEMON_UNAVAILABLE`を返した。既存dashboardは生きて配信を継続している。
原因は未特定で、dashboardの更新完了とは扱わない。
オーナー指示により、先にnpm Trusted Publishingの設定へ切り替えた。
