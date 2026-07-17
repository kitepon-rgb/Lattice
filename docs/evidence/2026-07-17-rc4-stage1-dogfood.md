# RC4 Stage 1 — dotagents disposable clone実戦dogfood（actual executor閉ループ）

- Date: 2026-07-17
- 契約: [ADR 0046](../adr/0046-rc4-writer-target-stage-override.md)（stage条件付き上書き・隔離契約）、
  [ADR 0050](../adr/0050-stage1-executor-isolation-implementation.md)（隔離契約の実装形・オーナー裁定「2でいい」）
- Control: `lattice-rc4-dotagents-v1`（H task `RC4-S1-stage1-dogfood-v1`・approval snapshot付き）
- 正典artifact: `research/campaigns/rc4/artifacts/v3`（round 1・on-disk検証16 check green）＋
  `research/campaigns/rc4/artifacts/v3-hold`（round 2・注入→hold→vN+1→redispatch・17 check green）
- driver: `src/rc4-stage1-dogfood.mjs`（`444872c`・integration green）
- 検証規律: 実測値のみ。丸め・事後推定なし。未達は未達と書く

## H gate

オーナー承認（2026-07-17チャット「OK 進めてくれ」）をH task approval snapshot
（purpose／impact／rollback／operation digest）としてControlへ記録してからdispatchした。
executor実装形は途中でオーナー再裁定（「2でいい」→ADR 0050）を経て確定した。

## 実行記録（一回性の実観測）

target: dotagents disposable clone（tmpdir配下・base `ee0afa9`・正規repoへ不着地）。
sensor: 改良後 `1.4.1-lattice.1`（Node 24実行・index 1,511 nodes/0.5秒）。

1. **epoch 1 compile**: 実TODO 3件（TA=ADR 0060対称性のcharacterization test追加、
   TB=resume-check出力の誤読防止改善＝Stage 0 T2実体、TC=consult adapter非H整備のfocused test）
   → dispatchable。conflict 1件（TA×TB＝3,711行の`control-record.test.mjs`共有write＝巨大file
   交差ケース）、waves `[[TA,TC],[TB]]`（minimum 2）。
2. **wave 1**: TA・TCを隔離worktreeへ並列dispatch（actual executor 2体同時＝Claude implementer
   subagent。opaque handleはprovider ledgerのみ、core eventsへ不混入）。
3. TC terminal（156秒・23 test green）→ 実diff観測 findings 0 → receipt `TC-a1-r1` **accepted**。
4. TA terminal（325秒・127 test green）→ findings 0 → receipt `TA-a1-r1` **accepted**。
5. **wave 2**: TA受理で共有resourceが解放され、`dispatchStage1NextWave`がTBをdispatch
   （**conflict serializationのevent列実証**: TB dispatchはTA receipt受理の後）。
6. TB terminal（512秒・126 test green・2 file書込=packetどおり）→ findings 0 →
   receipt `TB-a1-r1` **accepted**。
7. run close（accepted {TA,TB,TC}・residual worktree 0）→ artifact v3 atomic発行 →
   `verifyStage1ArtifactOnDisk` **16 check green**（document digest・event chain・dispatch replay・
   receipt replay双方向・provider handle非混入・isolation_contract完備）。

## round 2 — 注入competition→hold→carry-over→vN+1→redispatch（実TODO・実executor）

round 1はconflictがdispatch内serializationで解決しhold経路が発火しなかったため、plan条項
「注入competition 1件以上」を**round 2**（request `rc4-stage1-e1-hold`・TD/TF 2 TODO・
state/artifact分離）で消化した:

1. TD（quota-snapshot境界test追加・実TODO）に**既知注入**＝witness scope外write
   `docs/rc4s1-injection-canary.md` をdispatch時に含めた。TF（rate-selector残量下限の
   等号境界test追加・実TODO）は正常packet。wave 1で両者並列dispatch。
2. **自然発生のprovider unknown**: TD executor（handle `stage1-TD-h1`）がAPI server errorで
   中断。RC3-I規律どおり**新handleの重複dispatchをせず同一handleで回収**し完遂
   （provider ledgerへ`unknown_provider_error`→`recovered`系列を記録。演出でなく実障害の観測）。
3. TF terminal（69秒・7 green）→ clean checkpoint。TD terminal（回収込み）→ checkpoint観測が
   **`scope_violation`（`docs/rc4s1-injection-canary.md`）を検出**→ intake frozen。
4. **hold裁定: hold {TD}・continue {TF}・lane intentional_serial → vN+1（epoch 2）**。
   TF receipt `TF-a1-r1`は**epoch 2でcarry-over受理**（再実行なし）。
5. **TD redispatch（attempt 2・新context packet・handle `stage1-TD-h2`・新worktree）** →
   注入なしで完遂（61秒・5 green・scope内のみ）→ findings 0 → receipt `TD-a2-r1` accepted。
6. run close（accepted {TD,TF}・residual 0）→ artifact `v3-hold` atomic発行 →
   on-disk検証 **17 check green**（hold replay検査を含む）。

## Latticeの答え vs 親判断の照合（L4計画条項）

- conflict判定（TA×TB共有write→serial）: 親の独立判断と一致・**妥当**。
- wave構成（TC並列・TB後行）: 妥当・過剰serialなし。
- 見逃し: TB writes `bin/orchestrate-run.mjs`×TA/TC結合は実在せず（grep照合）、**見逃し0**。
- scope検証: 全executorのdiffがpacket write scope内（diff observer findings 0が3/3）。

## 境界検証（ADR 0050 Decision 3・境界事故0の機械判定）

dispatch前後のhost fingerprint比較（`~/.claude`・`~/.codex`・`~/.agents`のsymlink構造・実体、
正典2repoのHEAD/status digest）:

- **dotagents正規repo: HEAD不変・status clean（差分ゼロ）**——最重要境界の事故0。
- `~/.claude`・`~/.agents`: 変化なし。symlink変化なし。
- Lattice repo: 差分はartifact v3の意図的発行のみ。
- round 2完了後の再比較でも同結果（dotagents正典 dirty 0行・変化クラス同一）。
- `~/.codex`: 常駐Codex daemonの状態ファイル（logs/sqlite wal/models_cache等）のtimestamp/append
  変化あり。executorはClaude subagentでcodex面を使っておらず、設定・認証・symlinkの変化なし＝
  **環境常駐ノイズと判定**。ただしfingerprintは行為者を識別できない——この帰属限界は
  ADR 0050 Consequencesの残余リスクと併せ、L5 Phase gateの`fable`×high refuter確認対象とする。

## 実測サマリ（provider ledger正）

| 項目 | 実測 |
|---|---|
| Lattice core処理（compile/observe/receipt/close/publish/verify） | 全てサブ秒〜数秒 |
| executor実行 | TA 325秒/16 tool・TB 512秒/17 tool・TC 156秒/13 tool |
| 受入 | 3/3 accepted・境界事故0・residual worktree 0 |
| witnessコスト | request作成一式≈数分（Stage 0作法確立後、AFFECTED_TEST_DRIFT 0回・写経0） |

## dogfoodが拾った実データ（executor前提訂正2件）

- TA: 依頼前提「characterization test未整備」は部分stale（ca835b9自体が3本同梱済み）。executorは
  実読で検出し、**型間対称性そのものを固定する未カバーtest**を追加した（TODO staleの実測記録＝
  凍結不要合意の想定どおり）。
- TB: 依頼前提「`resume-check --brief`」は構文非実在（`--brief`はstatus専用）。executorは実読で
  訂正し、resume-check本経路へ`summary`（outcome・blocking_count・review_count）を先頭配置で追加、
  既存機械可読契約（ok/command/result）は不変。

## Stage 2 gate裁定（L4最終条項）

- **境界事故0**: 成立（上記・機械判定）。
- **受入品質**: receipt 3/3 accepted・focused test green（127/23/126）・scope violation 0。
  コード実体の正式reviewはStage 2の着地review（親review→pathspec commit経路）で行う——Stage 1は
  不着地のため受入はreceipt契約とdiff scope検証まで。
- **witnessコスト再実測**: L2改良の効果は実戦でも成立（drift 0・写経0・witness作成が閉ループの
  支配項にならない。支配項はexecutor実行時間 156〜512秒/件）。
- **裁定: Stage 2（正規着地・H gate毎batch）へ進んでよい**。着地窓はオーナーと合意する
  （L5条項どおりqueue 20 campaign・R3 finalization・J1と排他）。

## 未達・持ち越し（正直な記録）

- TA・TBは同一fileを同一baseから編集しており、Stage 2で両diffを着地させる際はmerge解決が要る
  （Stage 1のserializationはworktree分離で成立。着地順と統合はStage 2 reviewの仕事）。
- stale receipt・重複dispatch probeはRC3-Iで実証済みのため本runでは未再演（hold→carry-over→
  vN+1→redispatchはround 2で実repo実証済み。unknown回収は実provider障害で自然観測済み）。
- Control台帳への実行記録は、RC3-I前例に従い3 dispatchを個別Worker Runとせず、H taskの
  finalizeとartifact digestで代表させる（dispatch粒度の一次記録はartifact v3 provider ledgerが正）。
