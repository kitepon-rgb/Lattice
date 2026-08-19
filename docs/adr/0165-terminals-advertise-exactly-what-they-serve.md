# ADR 0165 — 端末は配信している集合をそのまま名乗る

- Status: Accepted
- Date: 2026-08-11
- Extends: [0162 — bridge hub registration protocol](0162-bridge-hub-registration-protocol.md)、
  [0164 — hub landingは公開の製品面である](0164-hub-landing-is-the-public-product-face.md)

## Context

2026-08-11、`https://lattice.kitepon.dev/` の公開一覧が全projectオフラインになった。中身は
生きていた——dashboard daemon（pid 76586）は `iine`・`kikoeru`・`lattice` を配信中で、bridgeは
192.168.1.35:56097 でLISTENして応答し、hub自身も200を返していた。それでも公開面は端末ごと消えた。

原因は、**「この端末が公開しているproject」を2箇所が別々の基準で数えていたこと**である。

| 数える側 | 使っていた関数 | 基準 | 当時の答え |
| --- | --- | --- | --- |
| dashboard daemon（実際に配信する側） | `readVisibleTodoDashboardProjects` | 2時間以内 **または** active run有り | 3件 |
| hub heartbeat（存在を名乗る側） | `readActiveTodoDashboardProjects` | 2時間以内だけ | **0件** |

`last_seen_at` は `lattice todo`／`lattice project` 系CLIを叩いた時だけ更新される。一晩触らなければ
全件が2時間を超え、heartbeatは `skipped_no_projects` として送信ごと省く。hubは90秒
（`BRIDGE_HUB_HEARTBEAT_TTL_MS`）で `offline` へ落ちるので、**2時間Latticeを触らないだけで公開面が
自動的に全滅する**。配信できるのに名乗らないという消え方なので、外からは障害と区別がつかない。

`TODO_DASHBOARD_STALE_MS`（2時間）は登録簿から放置projectを掃除するための尺度であって、
「いま配信しているか」の尺度ではない。それをhubへの露出gateに流用したのが誤りである。

## Decision

1. **端末がhubへ名乗るproject集合は、その端末が実際に配信している集合そのものとする。**
   heartbeatは登録簿を自分で数え直さず、配信しているdashboard daemon自身の
   `/__lattice/health` が返す `project_ids` を使う（`readServedTodoDashboardProjectIds`）。
   配信の実体が唯一の情報源であり、名乗る側が二次的に再計算しない。
2. **「daemonが居ない」と「0件を配信している」を混ぜない。** descriptor不在・health無応答・
   descriptorとhealthのpid／port不一致は `skipped_no_dashboard`、配信0件は `skipped_no_projects`
   として `lattice bridge status` まで届ける。前者は配線の故障、後者は正常な静止であり、
   運用者が取る手が違う。
3. **公開面の露出を、人がCLIを叩いた新しさで律しない。** 露出を決めてよいのは配信の実体だけとする。
   活動の新しさは登録簿の掃除にだけ使う。

## Consequences

- 端末を触らずに放置しても、active runを持つprojectは公開面にオンラインで出続ける。稼働中の
  開発が夜間に消えなくなる。
- 配信が本当に止まった時（daemon停止・repo消滅）は従来通り90秒でofflineへ落ちる。TTLの意味は変えない。
- `readActiveTodoDashboardProjects` は登録簿の問い合わせとして残すが、**公開面の露出判定へは使わない**。
  同じ流用を再びしないこと。

## Addendum — 2026-08-19

`TODO_DASHBOARD_STALE_MS` を1週間へ延長した（0.60.6）。Contextの「2時間」は当時の事実であり書き換えない。
Decision 1〜3は変えない——heartbeatはいまも配信実体だけを名乗る。配信実体そのものの鮮度窓は1週間であり、
active runと監査待ちPhaseは窓を超えても配信する。
