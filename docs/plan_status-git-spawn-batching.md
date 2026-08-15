# plan: status git spawn雪崩の根治（evidence blob batch集約）

- 起案: 2026-08-15 / 統括レーン（条件③: Lattice製品改修＋release完遂とdotagents hook改修の複数repo書込み調整）
- 状態: **完了（2026-08-15）**。Lattice 0.60.5をpublish・install・公開後smoke済み（dotagents store実測1.5〜2.3秒）。dotagents側は非同期中継hook（e6e3b6dd）＋git-destroy-gate＋憲法1行（dd9453a6）をpush済み、この端末へClaude/Codex両配線適用済み。
- 関連: dotagents側の非同期中継hook改修（正本はdotagents側。ここでは参照のみ）

## 背景（実測診断 2026-08-15）

`lattice status --json` がdotagents store（evidence記録が育ったstore）で6.5〜8秒かかり、dotagentsのSessionStart hook（5秒上限）が毎セッション期限超過する。CPUプロファイルで6.7秒中6.2秒がspawnSync。Windowsのgit子process起動単価は約66〜100msで、statusのstore検証が推定80〜90回のgit起動を行うことが主因。Node起動・SQLite読込・store破損は主因ではない（Lattice自身のstoreでは0.95秒）。

内訳:
- `readEvidenceBlob`（src/todo-store.mjs）がevidence blob 1件ごとに `gitCatFileBatch([oid])`＝要素1個のbatchを個別spawnする。
- import source（pinned source）の検証も、`pinnedSourceCache` が効かない経路ではcommit＋blobを都度読む。
- `reachableObjects` の `rev-list --objects --all` は218msで脇役（変更しない）。

batch基盤 `gitCatFileBatch`（src/git-process.mjs）は「object 1個=spawn 1回の雪崩防止」の設計コメント付きで実装済みであり、呼び方だけが設計意図から外れている。

## 目的と受入条件

1. dotagents storeでの `lattice status --json` を1秒台へ短縮する（実測で確認）。
2. 外部挙動不変: 修理前後で同一storeのstatus JSON（result_digest含む）が一致する（characterization）。
3. focused test（todo-store系）green。最終確認としてLattice関連suiteを1回通す。
4. release完遂: CHANGELOG・version bump・push・`verify-release-commit`・`npm install -g`・公開後smokeまで届ける。

## 設計

**修理1（本丸）: evidence/pinned sourceの一括prefetch**
`readTodoStore` のmemberごとの検証に入る前に、journal.eventsのpayload（`evidence` / `decision_evidence` / `evidence_slots[].evidence`）と replay後の `task.evidence` から記述子を収集し、
- evidence記述子: repo別にuncached OIDをまとめて1回の `gitCatFileBatch` で読み、`evidenceBlobCache` へseedする。
- import source記述子: 未cacheのcommit・`<commit>:<path>` specをまとめて1回のbatchで読み、`pinnedSourceCache` へseedする。
以後の `readEvidenceBlob` / `pinnedSourceLine` は無改造でcache hitする。read path（1386行の注釈loop）とforWrite path（replay内検証）の両方が同じprefetchで救われる。

**修理2: pinnedSourceCacheの配線漏れ**
`importSourceVerifier` / `verifyPlanNarrativeAnchors` のcache引数を受けていない呼び出しへ、同一呼び出し内で共有できるcacheを渡す（write系経路。効果は従、正しさは同一）。

**修理3（保留・実測待ち）: HEAD解決の集約**
`rev-parse HEAD` 6箇所はいずれもwrite経路のgateであり、statusの主因ではない見込み。修理1・2の後に再プロファイルし、statusパスに残る場合だけ着手する。実測なしで先回りしない。

## 非目標（やらないこと）

- `reachableObjects`（rev-list）の変更、cat-file常駐process化、非同期化などの再設計。
- sensor・gantt serve・run store側の性能改修。
- statusの出力契約・エラー分類の変更。
- dotagents hookのtimeout延長（消費者側で製品の遅さを吸収する蓋になるため。非同期中継はdotagents側の別修理）。

## 既知の罠

- prefetchは**成功したblob読みだけ**をcacheへ入れる。missing / 非blobをcacheすると失敗の意味論（repo状態は変わりうるので失敗は覚えない）が壊れる。per-item経路の失敗挙動を変えない。
- `gitCatFileBatch` のmaxBufferは `maxBodyBytes×件数` で見積もられる。大きなstoreで一括にする際も既存の見積もり式に従う（`TODO_LIMITS.narrativeSectionBytes+1` を維持）。
- `EVIDENCE_BLOB_CACHE_LIMIT`（512）: prefetch件数が上限を超えるとFIFO evictionでhitしなくなるが、per-item経路が従来どおり動くため正しさは保たれる（性能だけ劣化）。上限変更はしない。
- pinnedSourceLineは「commitの型検査」と「blob読み」の2責務を持つ。prefetch時もcommit検証をスキップしない（cache.commitsへ入れるのは型検査を通したものだけ）。
- 複数repository構成（manifest.repositories）ではrepo別にbatchを分ける。OIDは同じでもrepoが違えば別object。

## 工程と並列判断

直列・単一writer（私）。Lattice修理→release→dotagents hookの順。別repo並列委譲は可能だが、hook改修はLattice修理後のsmokeと結果面が絡み、親の受入帯域も直列のため並列利益なしと判断（委譲契約の検討義務への結論記録）。Lattice run経由は同一repo複数writerに該当しないため使わない。

## 検証

- characterization: 修理前に `lattice status --json` の出力（dotagents store・Lattice store）を保存し、修理後に一致を確認。
- focused: `node --test test/todo-store*.test.mjs` 等、todo-store系の既存suite。
- benchmark: `time lattice status --json`（dotagents store）修理前6.5秒 → 目標1秒台。
- 最終確認: Lattice関連suiteを1回。

## maintenance queue（campaign中に発見・本筋外）

- **codex-sidecar（Windows）**: `codex_review`が`RUN_STORE_CORRUPT: unsafe durable auth directory: C:\Users\kite_\.cache\codex-sidecar`で常時失敗。空の新規dirに対する発火で、POSIX permission検査(0700期待)がWindows ACLで誤判定の疑い。所有repo: codex-sidecar-mcp。再現: Windows端末で`codex_review`を1回呼ぶだけ。回避: aiterm `codex_agent`経由。
- **aiterm grok_agent（この端末）**: 稼働中MCPプロセスが古いenvを掴んでいてWSLパスを解決していた。User環境変数・`~/.claude.json`のMCP envともWindows `grok.exe`へ設定済み。MCP再起動後の再確認だけ残（端末固有・repo修正なし見込み）。

## 結果（2026-08-15）

- **実測**: dotagents storeの`lattice status --json` 6.5秒→**1.46秒**（git起動96回→23回）。Lattice store 0.95秒→0.08秒級。status JSONはversion/git_head/result_digest（期待差）以外byte一致。
- **実装**: 修理1・2を実施。修理3（HEAD集約）は再プロファイルでstatusパスの主因でないと確認し不実施（write経路gateのみ）。収集元は診断時の想定に加え、**改版genesisの`state_migration[].state.evidence`（carry系）**が実測で主経路と判明し追加。
- **cross-providerレビュー（Codex Sol×high）**: 修正必須2件→両方採用して修正。①batch同乗で上限超過blobが未検証→検証済みへ昇格する挙動差（prefetchはbody>narrativeSectionBytesをseedしない）②513件以上でseeding自身のFIFO evictionが雪崩を復活させる（満杯時は追い出さずseed停止）。①は判別力検証済みのcharacterization testで固定。②の513件fixtureはtest費用対効果で見送り（本節に記録）。
- **レビュー指摘の残り**: 計数testがbatchを識別しない件は、①のtest追加と実測プロファイルで代替し、argv記録方式は見送り。
- **事故記録**: 受入検証中に統括（私）が`git checkout --`で未commit実装を消去し、会話記録から全編集を再構築した（再構築後にcharacterization・判別力検証・focused suiteを全て再走してgreen）。一時変更の復元にgit破壊操作を使わない。
- 並列判断の記録: 直列・単一writerで実施（別repoのdotagents hook改修のみTerra委譲で並走）。
