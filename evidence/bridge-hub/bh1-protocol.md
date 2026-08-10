# bh1-protocol — hub 登録プロトコル契約の設計文書

## 作ったもの

- `docs/adr/0162-bridge-hub-registration-protocol.md`: 端末→hub登録プロトコルの契約ADR。
  登録・heartbeat・失効・project_id衝突の設計判断と根拠を確定した。
- `src/bridge-hub-protocol.mjs`: 契約の実装。ソケット・時計・ディスクを持たない純粋関数
  （`applyBridgeHubRegistration`・`projectBridgeHubRegistry`）＋wire schema検証
  （`validateBridgeHubRegistrationRequest`・`validateBridgeHubRegistryEntry`）。
  hub server実装（bh2）・端末heartbeat実装（bh3）はこの契約に対して配線するだけでよい。
- `test/bridge-hub-protocol.test.mjs`: 12件のcharacterizationテスト。
- `scripts/verify-product-reachability.mjs`: 新規moduleが未配線（bh2待ち）である事実を
  `RESEARCH_ARTIFACTS`宣言（reason付き）で明示し、reachability gateのdrift扱いを解消した。

## 設計判断の要点（詳細はADR 0162）

- registryはproject_idで引く（1端末が複数projectを持てば複数entry）。
- requestはaddressを運ばない。呼出側が渡す接続元addressだけを採用する
  （`bridge-registrar.mjs`の安全思想を継承）。
- 登録は毎回その端末の完全な現在状態を宣言し、以前は持っていたが今回無いprojectは解放する。
  専用の「登録解除」verbは無い。
- project_id衝突は`adopt`に明示した名前だけ移り、他は自動勝ち抜きしない。衝突は集めて一括報告し、
  一部だけ書いて残りを拒否することはしない（registryは不変のまま）。
- 失効は読み出し時の投影だけで判定し（`last_seen_at`とTTL）、登録簿から削除しない
  （「黙って消さない」）。

## 検証

- `node --test test/bridge-hub-protocol.test.mjs`: 12/12 green（新規contractのfocused test）。
- `node scripts/check-syntax.mjs`: 151 files、green。
- `node scripts/verify-product-reachability.mjs`: undeclared_unreachable=[]、stale_declarations=[]、
  green（新規宣言込み）。
- `node scripts/verify-open-questions.mjs`: green（109 ADR、unanchored=[]）。
- `node scripts/verify-cli-surface.mjs`: green（67 commands、undocumented/unexercised=[]）。
- **`npm run ci`・`npm test`はこの完了時点では実行していない。** bell が同時刻に別のP0
  hotfix（room [2360]、Windows gantt serve/dashboardのgit子起動スパム修理）を同じcanonical
  working treeで進行中で、`src/todo-store.mjs`・`src/todo-cli.mjs`・`src/project-cli.mjs`・
  `src/runtime-cli.mjs`・新規`src/git-process.mjs`が未commitのまま変更されている。この状態で
  `npm test`を1回実走したところ1396件中150件failしたが、失敗は上記5fileの変更範囲に集中しており、
  `src/bridge-hub-protocol.mjs`はどの製品fileからもimportされていない（reachability gateが
  それ自体を検証済み）ため、この結果を自分の変更の欠陥として扱わない。bellのhotfixが着地し
  treeが再びcleanになった時点で、次にfull CIを回す誰か（bh2着手者、または監査）が本来の
  baselineとして確認するのが正しい。この報告を「full CI green」と偽らないための記録として残す。

## commit対象

`src/bridge-hub-protocol.mjs`・`test/bridge-hub-protocol.test.mjs`・
`docs/adr/0162-bridge-hub-registration-protocol.md`・`scripts/verify-product-reachability.mjs`・
`evidence/bridge-hub/bh1-protocol.md`・`.lattice/todo/`のbh1-protocol start分。
bellが同時編集中の5fileは対象に含めない（pathspec明示）。
