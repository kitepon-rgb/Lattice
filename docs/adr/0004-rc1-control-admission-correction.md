# ADR 0004: RC1 Controlの未知予算を後継で訂正する

- Status: Accepted
- Date: 2026-07-15
- Scope: Research Campaign 1のorchestration Control lifecycleだけ
- Related: [ADR 0002](0002-research-campaign-1-closed-loop.md)、[ADR 0003](0003-rc1-safety-net-accepted.md)

## Context

`lattice-rc1-closed-loop-v2`は、`max_cost_microusd: null`で初期化された。Control Record契約では
`null`は無制限でも未使用でもなくunknownであり、既知の予約を含むWorker Runを追加するmutationも
`BUDGET_UNKNOWN`で拒否する。RC1-Bのplacement dry-runは実際に`budget-unknown`を返した。

同じdry-runは`verification-insufficient`も返した。記録済みの`codex-native`観測はrouting smokeと
TOML照合までの`verified`であり、実タスクの完遂と回収をまだ証明していない。一方、現在のControl Record
実装はparent以外のwrite Workerに`execution-verified`を要求する。routing smokeを実行検証へ水増ししてはならない。

この時点で`worker_runs`、`consultations`、`campaigns`、dispatchはいずれも0で、RC1-B／RC1-Cの
実作業は子へ渡していない。したがってsource artifactや研究条件の失効はなく、誤りはControl admission設定に
限定される。

## Decision

1. `lattice-rc1-closed-loop-v2`のRC1-B／RC1-C Taskを本ADRで取消し、残りのphaseを「実装未着手の
   管理停止」として完了させ、Control-level finalization後にarchiveする。
2. 同じ`docs/plan_lattice.md`をobjectiveとするcontinuation Control
   `lattice-rc1-closed-loop-v3`を作る。これはplan versionの変更ではなく、Control instanceの後継である。
3. 後継budgetは`max_cost_microusd: 100000000`を既知の上限とし、native Worker Runごとに
   `cost_microusd: 1000000`を予約する。これはControl内の保守的なreservation envelopeであり、
   購入、課金設定変更、外部service起動を許可するものではない。
4. 後継では最初にread-onlyのbounded native Taskを`verified`入口へ配置し、Delegation Packet、
   dispatch、structured report回収、親acceptanceまでをControlへ記録する。その実証だけを根拠に、新しい
   registry observationを`execution-verified`として記録する。
5. RC1-B／RC1-Cのwrite配置は、既知budgetと`execution-verified`の両方を満たすplacement dry-runが
   `eligible`になるまで行わない。失敗時にmanual Worker recordや親直書きへfallbackしない。

## Invariants

- `lattice-research-campaign-1-v2`の仮説、control／treatment、query set、fixture、TODO topologyは変更しない。
- ADR 0003でacceptedになったfixture safety netは後継Controlのpredecessor artifactとして再利用する。
- 旧ControlのTask ID、registry observation ID、transition receiptは削除・改変・再利用しない。
- `/Users/kite/Developer/dotagents`とObserver関連repoはread-onlyのままにする。
- remote作成、push、publish、credential／login、課金設定変更は行わない。

## Rejected alternatives

- `null`を0または無制限として扱う: Control Recordのfail-loud契約に反する。
- routing smokeを`execution-verified`と記録する: 実タスク完遂・回収の証拠がなく、自己保身的な成功扱いになる。
- dry-runを無視して子へ実作業を渡す: admissionとwriter isolationの記録を破る。
- 記録済みControl directoryを削除する: revision 10までのTask／registry履歴があり、ユーザーが許可した
  空Control削除条件を満たさない。
- plan versionを更新する: 研究入力やtopologyは変わらず、Control運用だけの訂正なので不必要なversion churnになる。

## Consequences

- Controlのarchive／continuationに管理作業が増えるが、誤った予算と未検証writerをfail-openにしない。
- native入口の実行検証が独立したevidence artifactとして残り、RC1-B／RC1-Cの配置根拠を再現できる。
- `codex-native`をwriteへ配置する際の実装上の厳格条件を満たすが、dotagents側の文言・分類の整合性は
  Latticeのwriter scopeへ持ち込まず、別repoの実装セッションへ委ねる。
