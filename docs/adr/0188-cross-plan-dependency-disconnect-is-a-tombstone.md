# ADR 0188: plan間接続の除去はtombstone event（connectの対）

- status: accepted
- date: 2026-08-29

## 文脈

`dependency connect`で誤った向きの線を張った時、除去する正規手段が無かった（実被弾:
逆向きの接続がplan間に残り、正しい向きを張ると循環になるため修正不能）。

## 決定

plan-scoped event `cross_plan_dependency_removed`（payload: target_event_digest, reason）を追加し、
CLI `todo dependency disconnect --from-plan --from-task --to-plan --to-task --reason` で積む。
projectionは除去tombstoneが指す接続を線として数えない。歴史は両eventとも残る。不在・二重除去は
typedに拒否し、除去後の同一辺の張り直しは重複と数えない。

## 帰結

- v0.67.0で出荷。誤接続の修正が「除去→正しい向きで再接続」の2コマンドになった
