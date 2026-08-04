# rpf-004 対象作業群限定 barrier

## 結果

- runtime finding の当事者から既存の affected closure を計算し、その作業群だけを barrier する。
- closure 外の running TODO は process、context、partial patch、origin write lease を維持する。
- closure 外 TODO の旧 epoch receipt は、各 epoch の carry-over witness と hold decision が連続し、context invalidation が無い場合に origin binding の成果として受理する。
- 通常の部分 replan では carry-over TODO を rebind しない。rebind packet は supervisor restart の全 process recovery にだけ使う。
- shutdown、restart recovery、初期 dispatch の `barrierAll` は変更していない。

## 請求項との対応

影響を受ける作業群だけを停止・再計画する請求項10の構成を、物理 process 停止、context 失効、lease、receipt 裁定まで同じ境界へ揃えた。請求項本文は変更していない。

## 検証

- `npm run check`: 139 files syntax check passed
- `node --test test/runtime-managed-supervisor.test.mjs`: 11/11 passed（実 Unix socket を使うため sandbox 外の project PTY で実行）
- `node --test test/rc3-hold-recompile.test.mjs test/rc3-runtime-engine.test.mjs`: 24/24 passed
- `node --test test/runtime-conflict-cli.test.mjs`: 10/10 passed（実 supervisor/controller daemon、hold→successor release→resume を含む）

実装 commit: `b1d24d0`
