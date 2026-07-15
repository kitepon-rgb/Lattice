# Codegraph evidenceを再現可能なcompiler inputへ変換する

- 更新日: 2026-07-15
- 確度: Codegraph 1.4.1一次資料＋RC1二回実測は高。version横断一般化は未検証。
- source: [[raw/codegraph-1.4.1-portable-index-source-record]]

Codegraph raw outputは診断には有用だが、そのままartifact digestへ入れるとtemp path、index時刻、node更新時刻が
同じcode snapshotの再実行でも変わる。schedulability compilerではraw telemetryとsemantic／structural projectionを分離する。

RC1の`lattice.codegraph_portable_outcome.v1`はstatusのproject／index path、last-indexed timestamp、DB byte sizeと、
nested nodeの`updatedAt`だけを除く。symbol identity、relative path、source range、signature、score、call／impact／affected、
index version／counts／pending／mismatchは保持する。未知fieldを一般的な「metadata」として捨てない。

この境界は「結果を安定させるための丸め」ではない。独立変数と無関係な実行telemetryをartifact identityから分離し、raw evidenceは
別receiptで保持する。新しいvolatile fieldが現れた時は再生成testをfailさせ、projection versionを更新する。
