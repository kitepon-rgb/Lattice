# ADR 0151: 運用工程表は動的dashboardだけにする

- Status: Accepted
- Date: 2026-08-01
- Supersedes: ADR 0053の静的artifact契約、ADR 0129の静的stale検知契約

## Context

動的dashboardが公開工程表として稼働している一方、`todo gantt`はproject別HTMLとsidecarを生成していた。
project規約が状態変更ごとの再生成を要求すると、AIは公開dashboardではなく`docs/*gantt.html`を更新し、
二つの表示面のどちらが正本かを取り違える。store更新から表示までの間に不要な生成gateも生じる。

## Decision

1. 運用中の工程表はLattice storeを都度読む動的dashboardだけを正本とする。
2. `todo gantt`と`todo gantt status`は`STATIC_GANTT_RETIRED`で拒否し、動的dashboardを案内する。
3. `todo gantt serve`はファイルを生成しない動的・read-only確認面として維持する。
4. AI向け規約、help、handoffは個別HTMLの生成、再生成、stale確認を要求しない。
5. 既存静的artifactはlive参照を動的URLへ切り替え、消費者ゼロを確認してから削除する。

## Consequences

- lifecycle変更は追加の生成操作なしでdashboardへ反映される。
- offline証拠が必要な場合は工程表HTMLではなく、store/revision/evidence artifactを保存する。
- 過去のADRとevidenceに残る静的artifactの記録は当時の事実として改変しない。
