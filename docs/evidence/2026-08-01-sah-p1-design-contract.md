# sah-p1-design-refutation — 設計契約（sensor-awareness-hooks campaign）

- 記録: 2026-08-01 / Control `sensor-awareness-hooks-20260801`
- 起草: claude-fable-parent（F: 端末設定書換え契約・公開契約は親直轄）
- 入力: P0 baseline証拠・read-only構造調査（Codex terra×medium）・反証1巡目（Codex sol×high・12 finding全採用）
- 版: r2（1巡目反証を反映した改訂版。r1の欠陥は本文末尾の裁定記録が正）

## 調査ダイジェスト（設計の根拠事実）

- CLI: `bin/lattice.mjs` はtop-level tokenで動的import dispatch。新設は `hooks`→`src/hooks-cli.mjs`
  （`runHooksCli`）が同型。help3層（`src/cli-help.mjs`）と `scripts/verify-cli-surface.mjs` の
  `COMMANDS`、実CLI経由testが出荷条件。
- 配布: `files`は`bin`/`src`全体を含む＝hook本体は`src/hooks-*.mjs`で追加配布設定不要。
- typed契約: 各CLI module局所の`typedFailure`（usage=exit 2・実行失敗=exit 1・成功はschema先頭の一行JSON）。
- host entry形（一次資料確定）: Claude=`hooks.UserPromptSubmit[]`要素
  `{"hooks":[{"type":"command","command":…,"timeout":5}]}`。
  **Codex=keyは`timeout`（秒・既定600）**。`timeoutSec`はCodex 0.146.0のschemaに存在しない
  （serde `rename="timeout"`・公式manual既定600秒——反証finding 7の一次資料）。
- test慣行: 一時workspace＋`spawnSync`実binary起動・stdout JSONのexact key/schema検査。

## 設計契約（r2）

### C1. CLI surface

`lattice hooks <install|status|uninstall|emit> --host <claude|codex>`（4つとも公開surface。
help3層・`COMMANDS`・実CLI経由test同時追加）。statusの出力は機械可読JSONを既定とする。

### C2. canonical entryとidentity（r2で全面改訂）

- canonical commandは install時に解決した **絶対Node実行体＋絶対script** で構成する:
  `"<process.execPath絶対path>" "<bin/lattice.mjs絶対realpath>" hooks emit <host>`。
  どちらかが解決不能なら `INSTALL_SOURCE_UNRESOLVED` exit 1（相対・PATH依存形へfallbackしない）。
- **identity判定はregexでなくtokenize＋argv構造比較**: host別parser（POSIX shell-words／将来のWindows形は
  実装時にexact-argv比較で扱う）でcommandをargv列へ分解し、「実行scriptが`lattice.mjs`（basename一致かつ
  存在すればrealpath一致）で、後続argvが `hooks emit <claude|codex>` に完全一致」する場合だけ自entryと
  みなす。tokenize不能なcommandは**自entryとみなさない**（他人のentryを壊さない側へ倒す）。
- **除去・置換の単位はinner handler**（`{"hooks":[…]}` wrapper内の1 handler object）。同一wrapper内の
  他handlerとwrapper metadataは保持し、除去で純粋wrapperが空になった時だけwrapperを落とす
  （apply-codex-configの参照実装と同じ規律）。
- 単一canonical不変: installは自identity handlerを全除去→canonical handler 1件を追加。
- Codex側handlerは `{"type":"command","command":…,"timeout":5,"async":false,"statusMessage":null}`
  ——**`timeout`キー**（finding 7）。Claude側は `{"type":"command","command":…,"timeout":5}`。

### C3. install書換え契約（不変条件＝P2 characterizationの対象・r2改訂）

1. 対象host home dir不在 → `HOST_NOT_PRESENT` exit 1。dirは作らない。
2. 設定ファイルがsymlink → `CONFIG_SYMLINK_UNSUPPORTED` exit 1。
3. 不正JSON → `CONFIG_UNREADABLE` exit 1・一切書かない。
4. **prestate記録**: 変更前に `{existed, mode, bytes}` を取得する。ファイル不在（dir在り）は
   `existed:false` とし空objectから開始。
5. **backup**: 変更が生じる場合だけ、`<name>.bak-lattice-hooks-<UTC>-<random>` を `O_EXCL` で作成
   （既存backupを上書きする経路を持たない）。`existed:false` ならbackupは作らず、rollbackは
   atomic unlinkと定義する。backup失敗→中止・無変更。
6. merge対象は自identity handlerだけ（C2）。他handler・他key・並び順不変、追加は末尾。
7. **書出しとCAS**: serialize→re-parse検証→同dirへ`O_EXCL`・元modeでtmp作成（`existed:false`は0600）→
   fsync→**rename直前にpreimage再読込しbytes一致を検証（CAS）**。不一致＝並行書込み検出→abort・
   tmp削除・再読込から再merge（1回だけ再試行、再衝突はtyped errorで停止）。rename→read-back検証。
   read-back失敗は `existed:true`→backupから復元／`existed:false`→unlinkで復元。
   全失敗経路で `finally` によりtmpを削除する。
8. 冪等: 既にcanonicalなら無変更・backup無し・`already_wired`。

### C4. status契約（r2改訂）

`lattice.hooks_status_result.v1`:
`{schema, host, config_path, state, canonical_command, matched_handler_count, executable_ok, next_action}`
- `wired` := 自identity handlerが**ちょうど1件**かつcanonical完全一致**かつ**Node実行体とscriptが
  存在し実行可能（`executable_ok:true`）。
- それ以外でmatched>0（旧path残存・重複・実行体不能を含む）→ `drift`。
- matched=0 → `not_wired`。dir/file不能・symlink・不正JSON → `unreadable`（exit 1。他はexit 0）。

### C5. uninstall契約

自identity handlerだけ除去（C3の安全則1-3,5,7を共有）。ファイル不在・handler無しは
`removed_count:0` のtyped成功。

### C6. emit（導線hook本体）実行時契約（r2改訂）

判定順:
1. `LATTICE_HOOKS=off` → 沈黙 exit 0。
2. state root解決: `XDG_STATE_HOME`が絶対pathならそれ、無ければ`os.homedir()/.local/state`。
   `lattice/hooks/` を owner確認付き `mkdir -p`（mode 0700）。**解決・作成不能なら1行の可視診断を
   stdoutへ出して exit 0**（fail-visibleの最終経路。無記録の沈黙はしない）。
3. stdin（64KiB上限・strict JSON・`session_id`/`cwd`必須）不成立 → `errors.log`へ記録して沈黙。
4. git root解決（`--no-optional-locks rev-parse --show-toplevel`・timeout 2s）:
   **exit非0（非git）だけ沈黙**。spawn失敗・timeoutは`errors.log`記録＋1行可視診断（planの
   fail-visible契約——非対象の沈黙と異常の可視を分ける）。
5. `<root>/.lattice/sensor/` がdirでない → 沈黙。
6. marker `<state>/lattice/hooks/<sha256(session)>.<sha256(root)>.shown` を **`wx`でatomic作成**。
   既存（EEXIST）→沈黙（並行promptの二重表示はこのclaimで裁定される）。作成成功→案内を出力。
   自pattern（`*.shown`）かつ7日超だけgc。
- 出力形: claude=plain 1行／codex=`hookSpecificOutput` envelope（ASCII）。
- 文面: `INFO: このrepoにはLattice sensor index（.lattice/sensor/）があります。コード構造の調査はsensor入口（MCP: lattice_sensor_explore 等／CLI: lattice sensor）を優先できます。`

### C7. 非採用と理由

- 専用binstub追加: 既存binstub＋subcommandで足りる。
- `--home`引数: testはHOME/XDG環境変数差替えで足りる。
- index無しrepoでの案内: 非目標（空砲の禁止）。
- regex identity: 反証1巡目finding 1/2により廃止（tokenize＋argv比較へ）。

## 反証結果と親裁定

### 1巡目（Codex sol×high・2026-08-01）

12 finding（high 9・medium 3）。**全採用・棄却なし**。判定「実装へ進めてはいけない」を受け、
本契約をr2へ改訂した。要点:

1. regex identityの誤爆（採用→C2 tokenize化）
2. quoted/space/Windows形の取り逃し（採用→C2 argv比較）
3. 除去単位のwrapper/handler混同（採用→C2 inner handler単位）
4. 新規作成ファイルの復元経路欠落（採用→C3 prestate＋unlink rollback）
5. backup同名衝突（採用→C3 `O_EXCL`＋random suffix）
6. tmp残骸・mode保持（採用→C3 finally削除・元mode）
7. **Codex keyは`timeout`・`timeoutSec`は無効**（採用→C2。dotagents apply-codex-configの同欠陥は
   P6 dotagents追従waveの修理対象として登録）
8. wired/drift非決定（採用→C4 exact-1-canonical定義）
9. state dir初回不在・並行claim（採用→C6 mkdir -p＋`wx` claim）
10. fail-visible矛盾（採用→C6 非対象沈黙と異常可視の分離・無記録沈黙の禁止）
11. 「PATH非依存」が偽（採用→C2 絶対Node＋絶対script・C4 executable_ok検証）
12. 並行書込みTOCTOU（採用→C3 CAS＋1回re-merge）

### 2巡目（改訂版への再反証）

（完了後に追記）
