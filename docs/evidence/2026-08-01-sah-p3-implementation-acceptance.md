# sah-p3-implementation — 受入記録（sensor-awareness-hooks campaign）

- 記録: 2026-08-01 / Control `sensor-awareness-hooks-20260801`
- 受入者: claude-fable-parent（親gate再実行による受入）
- 実装Run: 初回terra×medium（reject・空殻テスト置換と実装未完）→継続sol×high（本受入対象）。
  エスカレーション理由と経緯はstoreのsah-p3 noteが正。

## 受入gate（親自身の再実行）

| gate | 結果 |
|---|---|
| `node --test test/hooks-cli.test.mjs` | 37/37 pass・fail/todo/skip 0・空殻0 |
| `npm run check` | green |
| `npm run check:cli-surface` | green（66 commands） |
| `npm test`（full） | **fail 0**（P0既知赤のrc3系7件は上流修理で解消済みを実測確認） |
| 変更範囲 | `src/hooks-cli.mjs`・`test/hooks-cli.test.mjs` の2ファイルのみ（＋前Runの配線4ファイル） |

## 設計契約r5からの受入済み逸脱（3件・実装が正）

1. **C4 schemaへ`foreign_candidate_count`を追加**し、self match 0でもcandidate有りは`drift`とする
   （r4で導入したC2の可視化要求をC4の列挙keyへ反映し漏れていた——実装側の解決を採用）。
2. **回収周期の明確化**: stale `.claim`は1時間・`.shown`は7日、いずれも自patternのみ回収
   （C6内の記述振れを実装で一本化）。
3. **hermetic guardの実HOME read-only snapshot**は「実HOME不干渉」の唯一の例外として許可
   （suite前後のbytes/mtimeNs完全一致検証のため。書込みはゼロ）。

## インシデントと再発防止（P3初回Run）

旧baselineテストが実HOMEでCLIを起動し、実`~/.claude/settings.json`へinstallが1回走行した。
実装自身のbackupから復元し、親が実物検証済み（entry・JSON妥当性とも健全）。再発防止として
hermetic guard（全spawnの環境隔離＋suite前後の実HOME不変検証）を受入条件へ昇格し、本Runで実装済み。

## maintenance queueの解消

P0で登録したrc3-scripted-campaign統合7件のmain既存赤は、並行セッションの上流修理により
解消（本受入のfull suiteで実測green）。P4前のmaintenance waveは**対象なし**となった。

## 残余（P4以降へ）

- 実Windows実行・電源断そのもの・`RESTORE_FAILED`強制注入は未検証（注入可能な負例は検証済み）。
- P4: 契約r5と実装の独立レビュー（実装author=Codexのため検証はClaude側レーン）・statusのdrift実挙動確認。
- P5: docs/01正典化（ドラフト準備済み）・version bump・publish（H承認）・公開後smoke。
