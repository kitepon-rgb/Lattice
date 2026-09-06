# 停電後の公開工程表の停止調査

2026-09-06、オーナーから停電によるPC再起動と、movieの公開工程表が見えないとの申告を受けて調査した。初回は読取調査を行い、続く「原因を探して復旧して」の指示で修理と復旧へ進んだ。

## 確認できたこと

- 公開HTTPSは2回とも503と `BRIDGE_HUB_PROJECT_OFFLINE` を返した。
- WindowsのSystemログにイベント41と6008がある。起動時刻の観測値は19:20:36 JST。停電の発生時刻はこれらの値から推定しない。
- `~/.lattice/dashboard/projects.json` は389バイトすべてがゼロ。SHA-256は `2e9d958387b90088b65dd5d7fcd08a7b1d78c6476ae4c66537c2aebd9aa65ebf`。
- 正規の `lattice todo dashboard ensure --json` はこのファイルのJSON読込で失敗し、配信再開に到達しなかった。
- bridgeとsupervisorの実プロセスは存在せず、supervisorのPIDファイルは前日のまま。起動設定のファイルとNode実行体は存在する。

## 保存処理の判定

`src/todo-dashboard-registry.mjs` の `atomicJson` は、一時ファイルへ `writeFile` した後に `rename` する。`flush: true` やファイル同期の呼出しはない。途中のJSONを他の処理へ見せないための置き換えと、停電前に内容をディスクへ確定することは別の性質である。

Microsoftの[File Caching](https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching)は、キャッシュの書出し前の電源断でデータが失われることを説明している。Nodeの[ファイルAPI](https://nodejs.org/api/fs.html)は、書込みの `flush` 指定による同期を提供している。

停電、ゼロ埋めの現物、同期を要求しない保存処理は整合する。ただし、停電の瞬間のI/Oを記録したものではなく、物理的にどの層で未反映だったかまでは確定できない。同期要求の欠落はOS共通の保存処理で扱う問題であり、Windows限定の例外処理や読込失敗の握りつぶしで対処するものではない。同期要求だけでストレージ全体の電源断耐性を保証するとも主張しない。

## 自動起動の切り分け

初めの単発shellからのレジストリ観測では `.vbs` の関連付けが見えなかった。しかし、永続端末からWindowsの `FindExecutable` を呼ぶと、成功値42と `C:\\WINDOWS\\System32\\WScript.exe` が返った。同端末のレジストリ読取も `VBSFile` を返した。関連付け欠落という仮説は棄却した。

導入済みの起動スクリプトを一時ディレクトリへ複製し、descriptorだけを隔離した。実際のsupervisorを使い、子は起動記録を残して終了する無害なスクリプトへ置き換えた。`cscript.exe` からの起動は終了コード0、標準エラーなしで子の実行記録ができた。試験用supervisorは試験後に停止した。実配信の設定とPIDファイルには触れていない。

これは現在の明示起動経路が動く証拠であり、ログイン時にWindowsが起動スクリプトを実行した証拠ではない。supervisorは標準出力・標準エラーを破棄し、永続的な起動・終了記録を残していないため、停電後の自動起動が行われなかった直接原因は未特定。

## 修理の境界

保存時の同期要求は共通処理が対象。自動起動が欠けた問題はWindowsの起動経路を対象に追加観測する。現時点でWindowsの起動方式を変更する原因証拠はない。既存の検査機構が今回の破損を作った証拠もない。

## 復旧操作で特定したWindows固有の原因

破損登録簿と配信設定をtarで退避し、破損原本は別名でも保持した。hubに残るこの端末の登録がmovieとLiveTRであることを確認し、各repoから正規のdashboard ensureで再登録した。

ここでbridgeの再設定が `BRIDGE_ROLLBACK_FAILED` となった。停止済みの旧supervisorのPIDに対するtaskkillは、終了コード128と日本語の「見つかりませんでした」を返した。`stopRunning` は英語の `not found` / `not running` だけを許容していたため、終了済みを停止失敗と判断して新規起動とrollbackを止めた。この復旧拒否は実機で再現した。

Windowsの停止処理から表示文言の照合を撤去し、taskkill失敗後はsignal 0による存在確認で `ESRCH` のときだけ終了済みとして扱う。常駐の起動方式は変えない。これは正規の復旧を拒否した原因の修理であり、停電後のログイン時に起動しなかった原因の確定とは区別する。

共通保存処理には `flush: true` を加えた。同期がEIOで失敗すると既存の登録簿を置換しない個別試験と、日本語Windowsの終了済みPIDから再設定できる個別試験を確認した。変更境界はsensorで配信登録・daemon記録と呼出元、対応試験を確認した。
