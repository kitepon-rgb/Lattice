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

修正版のnpm公開・global installは、このPCのnpm認証が未完了のため未実施。
稼働中のbridgeは0.67.5。設定消失の直接原因となった操作は未特定のままとする。
