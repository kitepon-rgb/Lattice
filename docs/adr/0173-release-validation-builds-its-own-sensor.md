# ADR 0173: release検証は対象commit自身のsensorをbuildする

- 状態: accepted
- 日付: 2026-08-12

## 判断

Latticeの製品testとrelease検証は、対象commitの`npm --prefix sensor run build`で生成した
`sensor/dist`だけを使う。別worktreeから借りた`node_modules`は依存解決に使えるが、別worktreeの
`sensor/dist`を検証証拠として使わない。

## 理由

`todo-structure-lifecycle.integration.mjs`が`STRUCTURE_SENSOR_EDGE_UNRESOLVED`で失敗した。
同じ失敗は今回の変更前の`50f559e4`でも再現したが、借用していた`dist`には現行sourceが要求する
`--exact-path`対応が含まれていなかった。対象commit自身のsensorをbuildすると同試験は2/2で成功した。

これは製品のsymbol重複不具合ではなく、新しいroot adapterと古いsensor実行物を混ぜた検証環境の
不整合である。したがって`unknown`判定を緩めたり、symbol重複処理を変更したりしない。

## 帰結

- `sensor-repeat-sync-symbol-dedup`工程は誤診として取消す。
- release用clean worktreeでは依存directoryを実体で用意し、対象commit自身のprepack/buildを通す。
- build前の借用`dist`で得た全体CI失敗はrelease可否の証拠にしない。
