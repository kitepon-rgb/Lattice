# ADR 0183: done evidence は監査可能な追記eventで再束縛できる

- Status: accepted
- Date: 2026-08-23
- Supersedes: ADR 0056 Decision 4 の「`evidence promote` は未昇格の
  `historical_import` doneだけを対象にする」という制限

## Context

`todo verify`はdone eventが指すevidence blobを検証し、参照不能なら
`evidence_unverified`としてstore全体をfail closedする。一方、公開されていた
`todo evidence promote`は完了時刻不明のhistorical importだけに限定されていた。
そのためauthored doneや完了時刻が判明しているimported doneの証拠文書を更新すると、
不整合を検出できるのに正規の修復経路が無かった。実storeでは
`phase5-unverified/t03-catalog-live-match`がこの状態になり、後続planの起票を止めた。

既存eventの書換え、verifyの弱化、store fileの手補正はいずれもjournalの監査可能性を壊す。
必要なのは、現在の完了状態を維持したまま証拠だけを新しいeventで置き換える遷移である。

## Decision

1. `todo evidence promote --plan <key> --task <id> --evidence <file>`は、由来を問わず
   現在`done`のtaskを対象にできる。pending／in-progress／blockedは拒否する。
2. writerはlock内で最新done binding digestと現状態の`imported`値を解決する。callerが
   imported/authoredを申告せず、古い観測から属性を上書きしない。
3. 新しい`done_mode: evidence_promotion` eventは最新done digestへ束縛し、evidenceだけを
   置き換える。`done_at`、`imported`、taskの完了状態は維持する。旧eventは変更しない。
4. 修復遷移を開始するため、対象taskの過去evidence不達だけはprospective replayで
   superseded候補として扱う。新eventのevidenceはhard検証し、他taskの不達も従来どおり拒否する。
5. target不一致と非done拒否は、task、現status、期待／実target、次の操作をtyped detailへ載せる。
6. replayはjournalの状態遷移からTaskごとの現在のevidence所有eventを導出し、その一件だけを
   検証する。これによりreopen前のdoneを含む旧object不達が、修復後の通常mutationを再停止しない。
7. `imported`は完了の来歴であり、現在のevidence descriptor型ではない。imported doneを通常
   evidenceへ再束縛しても`imported=true`を維持し、その状態を後続revisionへcarryできる。

## Acceptance

- authored doneの証拠object不達を再現し、promote後に`todo verify`がgreenへ戻る。
- promote後、旧object不達のままhard readと次の通常mutationが成立する。
- authored／importedの両方で`done_at`と`imported`が変わらない。
- 完了時刻が判明しているcarried imported doneも再束縛できる。
- import source自体が不達でも対象taskを通常evidenceへ再束縛できる。
- promote済みimported doneを次revisionへcarryできる。
- reopen前後の複数done evidenceが不達でも最新promotion後のhard readが成立する。
- 新しいevidenceが不正ならstore bytes不変で拒否する。
- 従来のunknown historical done promotionを維持する。

## Consequences

`evidence promote`は「履歴輸入の確定」だけでなく「done evidenceの監査可能な再束縛」を表す。
event schema名は互換のため維持する。consumerは最新のdone stateを正とし、過去eventのevidenceを
現時点の成立証拠として再解釈しない。
