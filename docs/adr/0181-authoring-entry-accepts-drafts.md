# ADR 0181 — authoring入口は下書きを受理し、閉じる口をcageにしない

- Status: Accepted
- Date: 2026-08-20
- Supersedes: [ADR 0056](0056-todo-authoring-transitions.md) Decision 1 の exact argv 順、
  Decision 2 の欠落拒否、Decision 3 の相対path／descriptor専用。
  [ADR 0168](0168-todo-structure-is-an-opt-in-graph-overlay-with-completion-gates.md) Decision 7
  の done 完了gate。
  [ADR 0133](0133-concern-anchor-binding.md) Decision 1 の `within` が owns 専用である制限。
- Relates: [ADR 0128](0128-todo-independence-operational-wiring.md)、
  [ADR 0145](0145-the-verification-net-is-a-gate-not-a-cage.md)、
  [ADR 0159](0159-audit-pending-is-remaining-work.md)、
  [ADR 0166](0166-recovery-paths-must-not-refuse-the-state-they-repair.md)、
  [ADR 0180](0180-dispatch-round-trips-are-advice.md)
- 維持: 内部canonical保存とhash chain。設計メモ空欄の拒否（`NO_PLAN`は明示申告だけ受理）。
  store破損のfail-closed。監査の記録（閉じの門にはしない）。

## Context

0.61.0で往復強制のdispatch gateを助言へ戻した（ADR 0180）。残っていたのは、AIが書いた入力を
「バイトが違う」と捨てる入口と、`todo done`をdashboard／structure／絶対path／descriptor儀式で
止めるcageである。Latticeの仕事は構造観測・契約・記録・版の境界であり、操作AIに整形と往復を
強制するプロセス警察ではない。

設計メモの空欄だけは例外とする。空欄を`NO_PLAN`へ機械挿入すると、無策を成功に見せる。
無策なら本人が`NO_PLAN`と書く。空欄は拒否のまま残す。

## Decision

1. **下書きを受けて機械がcanonicalizeする。** pretty-print、BOM/CRLF、digest未計算、
   repo内絶対pathはauthoring入口が直す。storeへ書くbytesは従来どおりcanonical。
   comment・trailing comma・重複key・repo外pathは拒否する。
2. **flagの順は契約ではない。** write commandはflag名で束ねる。未知flagと位置引数は
   `INVALID_ARGUMENTS`。repo内絶対pathはusage違反にしない。
3. **actor欠落はdefaultする。** 渡した値がidentifierとして不正なら`ACTOR_UNRESOLVED`。
   未設定はhost／`session`／USERからsanitizeしたidentifierを使う。
4. **`todo done`はtaskを閉じる。** dashboard故障、structure realization、監査未了、
   絶対path、証拠本文はdoneの門ではない。監査と構造finalizationはstatusの残作業。
   `--evidence`はdescriptor JSONでも証拠本文でもよい。`--message`は本文からblobを書く。
5. **note／structureの破損はstartを止めない。** 読めないときはtypedな`unreadable`を返す。
6. **`concern_anchors.within`はownsまたはwritesが指す資源でよい。** 所有の嘘を書かせない。
7. **seam-proposal compileはdirty worktreeを拒否しない。** 観測はHEAD、未commitを検証済みにしない。
8. **空の設計メモは直さない。** `NO_PLAN`は無策の明示申告であり、欠落から作らない。

## Consequences

- 他のAIはpretty JSONと絶対pathでmigrate／revise／plan create／doneできる。
- 最後のtaskをdoneしたあと、planの監査は`audit_pending`として残る。taskは閉じている。
- `STRUCTURE_REALIZATION_REQUIRED`は出ない。phase closeは従来どおりfresh finalizationを要求する。
- `INPUT_OUTSIDE_REPOSITORY`はauthoring入口から消える。repo外は`INPUT_UNREADABLE`。
