# cross-plan edge rebind 修理計画

日付: 2026-08-12
対象: Lattice の TODO store / revision / dependency CLI
作業席: akari（専用 worktree の単独 writer）

## 目的

plan revision によって cross-plan dependency event の topology binding が古くなり、
store 全体が `binding_stale` となる故障を、append-only の正規イベントで回復できるようにする。
既存の `u1 -> a6` edge を代表 fixture とし、Peertable の repo・store・g1/pgr-01 は対象外とする。

## 実装範囲

- stale edge を限定的に読み出す recovery boundary を追加する。対象 endpoint、旧 event digest、
  旧 expected topology の一致を先に検証し、他の store 不整合を許容しない。
- dependent plan の plan-scoped journal へ、旧 edge を `supersedes` する新しい rebind event を
  append する。既存 journal を直接編集せず、同一 project・存在する task・非循環の edge だけを受け付ける。
- effective edge projection、manifest、status/frontier の再計算を新 event に追随させる。
- typed receipt に旧新 event digest、旧新 topology、frontier diff、`rebound: true` を含める。
- plan revision 側で既存 cross-plan edge の topology 変更を検出し、具体的な rebind command を
  `next_action` として返す。revision set の既存 atomic semantics と通常の connect/idempotency は維持する。
- CLI に recovery の公開入口と help/schema/test を追加する。

## 受入条件

1. `binding_stale` fixture を rebind すると store status が `ready` に戻る。
2. effective edge は意味的に1本だけで、u1 が未完了の間 a6 は frontier 外に残る。
3. endpoint mismatch、task removal、cycle、旧 event digest/topology mismatch は append 前に typed reject し、store bytes を変えない。
4. 通常の dependency connect と duplicate/idempotency、既存 revision-set の atomic activation を壊さない。
5. journal の直接編集を行わず、append-only event と manifest更新だけで回復する。
6. revision 側が stale 化する既存 edge を検出し、endpoint と digest を含む具体的な rebind `next_action` を返す。

## 検証と引き継ぎ

- 実装前に既存 cross-plan tests と revision tests の契約を読み、red fixture を追加する。
- 実装中は dependency/revision の focused tests、完了時に関連 test suite を一度だけ実行する。
- 固定 SHA と focused green を room へ報告後、rei に限定監査を依頼する。
- Rei PASS 後の release-lane 合流は hinata が所有し、akari は別 repo・Peertable 側へ書き込まない。

## 非目標

- 既存の stale journal bytes の書換え・削除・再生成。
- Peertable の pgr-01/g1、Lattice の別 worktree、release/publish/push。
- cross-plan dependency の新しい CRUD 全般、plan topology の mutable 化、cycle 判定の緩和。
