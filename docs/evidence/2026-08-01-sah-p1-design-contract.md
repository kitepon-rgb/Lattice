# sah-p1-design-refutation — 設計契約（sensor-awareness-hooks campaign）

- 記録: 2026-08-01 / Control `sensor-awareness-hooks-20260801`
- 起草: claude-fable-parent（F: 端末設定書換え契約・公開契約は親直轄）
- 入力: P0 baseline証拠・構造調査（terra×medium）・反証1巡目12件全採用・2巡目11件全採用・
  3巡目12件中10件採用/1件棄却/1件部分採用
- 版: r4（3巡目反証を反映。旧版の欠陥は末尾の裁定記録が正）

## 調査ダイジェスト（設計の根拠事実）

- CLI: `bin/lattice.mjs` はtop-level tokenで動的import dispatch。新設は `hooks`→`src/hooks-cli.mjs`
  （`runHooksCli`）。help3層・`scripts/verify-cli-surface.mjs` の`COMMANDS`・実CLI経由testが出荷条件。
- 配布: `files`は`bin`/`src`全体を含む。
- typed契約: module局所`typedFailure`（usage=exit 2・実行失敗=exit 1・成功はschema先頭一行JSON）。
- host entry形（一次資料確定）: Claude=`hooks.UserPromptSubmit[]`要素
  `{"hooks":[{"type":"command","command":…,"timeout":5}]}`。
  **Codex=keyは`timeout`（秒・既定600）。`timeoutSec`は無効キー**（caveat:
  codex-hooks-json-hook-timeout-key-timeout-timeoutsec-600）。
- test慣行: 一時workspace＋`spawnSync`実binary起動・stdout JSONのexact key/schema検査。

## 設計契約（r3）

### C1. CLI surface

`lattice hooks <install|status|uninstall|emit> --host <claude|codex>`。**emitも同一構文
`hooks emit --host <host>`**（canonical commandもこの形。位置引数形は存在しない）。
4 subcommandとも公開surface（help3層・`COMMANDS`・実CLI経由test同時追加）。

### C2. canonical entryとidentity（r3改訂）

- 対応platform: v1は**POSIXのみ**。Windows native（PowerShell command形）は
  `HOST_PLATFORM_UNSUPPORTED` のtyped errorで拒否し、対応はplanの明示的な後続工程とする
  （半端なcommand形を書き込まない）。
- canonical command: install時に解決した絶対path対
  `"<process.execPath絶対path>" "<bin/lattice.mjs絶対realpath>" hooks emit --host <host>`。
  解決不能は `INSTALL_SOURCE_UNRESOLVED` exit 1。
- **identity＝install receipt照合**（basename等のheuristic推定は廃止）: 自分が配線したargvは
  state rootの `installs/<host>.json`（owner receipt・追記型）へ記録する。ある既存handlerが
  自entryとみなされるのは、POSIX shell-wordsでtokenizeしたargv列が
  (a) 現canonical、または (b) receiptに記録された過去のinstall argv、のどちらかと**完全一致**する
  場合だけ。tokenize不能・不一致entryは他人の所有物として一切触れない
  （他人のdead entryも消さない——誤爆より取り逃しへ倒す）。
- **receipt/configのcommit protocol**（r4）: 更新は receiptへ`pending`entryを先行fsync→config
  commit→receiptを`committed`化、の順で行う。CLI起動時に`pending`が残っていればconfig実体と
  突合して回復（適用済→committed化・未適用→pending破棄）する。configのrenameとreceipt追記の
  間のcrashで削除権が孤児化しない。
- **receipt leafの安全**（r4）: receiptファイルは`O_NOFOLLOW`でregular file・owner・0600を確認
  してからatomic更新する（symlinkされたreceipt経由で他ファイルを書かない）。
- **未帰属candidateの可視化**（r4）: receiptに無いが`hooks emit --host`形を含むhandlerは
  削除権を持たない`foreign_candidate`としてstatusへ計上し、driftで可視化する（receipt喪失・
  設定ファイルの端末間手動copy等の二重発火を、削除でなく報告で扱う）。
- 除去・置換の単位はinner handler。同一wrapper内の他handlerとmetadataは保持し、除去で
  純粋wrapperが空になった時だけwrapperを落とす。
- 単一canonical不変: installは自identity handlerを全除去→canonical handler 1件を追加。
- handler形: Claude `{"type":"command","command":…,"timeout":5}`／
  Codex `{"type":"command","command":…,"timeout":5,"async":false,"statusMessage":null}`。

### C3. install書換え契約（不変条件＝P2 characterizationの対象・r3改訂）

1. host home dir不在 → `HOST_NOT_PRESENT` exit 1。dirは作らない。
2. 設定ファイルがsymlink → `CONFIG_SYMLINK_UNSUPPORTED` exit 1。
3. 不正JSON → `CONFIG_UNREADABLE` exit 1・一切書かない。
4. prestate記録: `{existed, mode, bytes}`。不在（dir在り）は`existed:false`・空objectから開始。
5. backup（変更が生じる場合だけ）: `<name>.bak-lattice-hooks-<UTC>-<random>` を **`O_EXCL`かつ
   mode 0600** で作成し、write→fsync→close→**parent directory fsync**完了をもって有効とする。
   既存backupの上書き経路を持たない。`existed:false`はbackup無し・rollback＝atomic unlink。
   backup失敗→中止・無変更。**保持規則**（r4）: commit前失敗で作った当回のbackup/displacedは
   削除する。成功物はファイルごとに直近5世代だけ残し、それ以前を回収する（最低1世代は常に残す）。
6. merge対象は自identity handlerだけ（C2）。他handler・他key・並び順不変、追加は末尾。
7. **置換手順（r4・displaced-preimage方式）**:
   - `existed:true`: serialize→re-parse検証→同dirへ`O_EXCL`・元modeでtmp作成→fsync→
     直前preimage再読込で一致検証→`link(target, "<name>.pre-lattice-hooks-<UTC>-<random>")` で
     置換直前inodeを退避（link失敗は中止）→**rename直前にtargetを`lstat`し、退避したinodeと
     dev/ino一致を再検証**（不一致＝hostが差し替えた→abort・re-mergeへ）→`rename(tmp→target)`→
     parent directory fsync→read-back検証。
   - `existed:false`（r4）: displaced/linkの前段を持たず、**`link(tmp, target)`のno-clobber commit**
     で作成する（`EEXIST`＝並行作成検出→再読込・re-merge）。mode 0600。
   - **残余竞合の受容（r4・表現訂正）**: inode再検証とrenameの間のごく短い窓で、hostが
     atomic rename型writerでtargetを差し替えた場合、その内容は失われうる。displacedが保証する
     のは「当方が検証した置換直前inodeの保全」までであり、「あらゆる並行書込みが必ず残る」
     ではない。窓はμsオーダー・hostのsettings書込みは低頻度・失われるのはhost側の直近1回の
     設定変更のみ（利用者が再操作で回復可能）——この残余をtyped契約の明記事項として受容する。
   - preimage不一致検出時は abort・tmp削除→再読込から1回だけre-merge。**retry時はprestateと
     rollback源を再読preimage（displaced優先）へ更新する**。
   - read-back失敗の復元は `existed:true`→直近preimage（displaced優先）から、`existed:false`→unlink。
     復元もtmp→fsync→rename→parent fsync→read-back規律。復元失敗は `RESTORE_FAILED` typed fatal。
   - 全失敗経路で`finally`によりtmpと当回の未確定backup/displacedを削除。
8. 冪等: 既にcanonicalなら無変更・backup無し・`already_wired`。

### C4. status契約

`lattice.hooks_status_result.v1`:
`{schema, host, config_path, state, canonical_command, matched_handler_count, executable_ok, next_action}`
- `wired` := 自identity handlerが**ちょうど1件**かつcanonical完全一致かつNode実行体・scriptが
  存在し実行可能（`executable_ok:true`）。
- それ以外でmatched>0 → `drift`。matched=0 → `not_wired`。
- dir/file不能・symlink・不正JSON・platform非対応 → `unreadable`（exit 1。他はexit 0）。

### C5. uninstall契約

自identity handlerだけ除去（C3の1-3,5,7と同じ安全則・receipt照合）。ファイル不在・handler無しは
`removed_count:0` のtyped成功。

### C6. emit（導線hook本体）実行時契約（r3改訂）

判定順:
1. `LATTICE_HOOKS=off` → 沈黙 exit 0。
2. state root解決（r4）: `XDG_STATE_HOME`（絶対pathの時のみ採用）または`os.homedir()/.local/state`
   に対し、**存在する最深ancestorをrealpathで固定**してから、そこへ至る未存在component
   （`.local/state`自体を含む）と`lattice`・`hooks`を順に作成する。各既存componentは`lstat`で
   symlink拒否・owner・mode確認（fresh homeでも到達可能）。解決・作成不能は1行可視診断を
   stdoutへ出して exit 0（無記録の沈黙禁止）。
3. stdin（64KiB上限・strict JSON・`session_id`/`cwd`必須）不成立 → `errors.log`記録＋沈黙。
   **log書込み自体の失敗は可視診断へfallback**。
4. git root解決: shell非経由の固定argv
   `git --no-optional-locks -C <検証済みcwd> rev-parse --show-toplevel`（timeout 2s）。
   **exit非0（非git）だけ沈黙**。spawn失敗・timeout・その他I/O失敗は記録＋可視診断。
5. `<root>/.lattice/sensor/` の判定: `ENOENT`/`ENOTDIR`だけ沈黙。EACCES/EIO等は記録＋可視診断。
6. 通知claim（r4）: **先に同名`.shown`（7日以内）の存在を確認し、あれば沈黙**。無ければ
   `<state>/lattice/hooks/<sha256(session)>.<sha256(root)>.claim` を`wx`で作成（EEXIST→沈黙）→
   案内をstdoutへ出力→出力成功後に`.shown`へrename。出力失敗はclaimを削除（永久抑止を
   作らない）。**出力成功後のrename失敗**は可視記録し、`.shown`の直接`wx`作成を試みる
   （両方失敗なら後の再表示を受容・記録）。stale claim（1時間超）は回収する——claim内容には
   pid・開始時刻を診断用に書くが、回収は年齢基準とし、suspend復帰等の極端系で起きうる
   稀な二重INFOは実害軽微として明記受容する。gcは自pattern（`*.shown`/`*.claim`）かつ
   7日超だけ・state root配下限定。
- 出力形: claude=plain 1行／codex=`hookSpecificOutput` envelope（ASCII）。
- 文面: `INFO: このrepoにはLattice sensor index（.lattice/sensor/）があります。コード構造の調査はsensor入口（MCP: lattice_sensor_explore 等／CLI: lattice sensor）を優先できます。`

### C7. 非採用と理由

- 専用binstub追加・`--home`引数・index無し案内: r1どおり非採用。
- regex／basename heuristicのidentity: 反証1・2巡目により廃止（receipt照合へ）。
- 「CAS」を名乗る置換: POSIXに真のfile CASが無いため僭称を廃止し、displaced-preimage方式で
  「競合内容は消えない」を契約化（残余窓の存在は明記の上で受容——backup・displaced・
  read-backの三重で回収可能性を保証する）。
- Windows native対応: v1はtyped unsupported。対応する場合は`commandWindows`形の固定を含む
  独立工程として起票する。

## 反証結果と親裁定

### 1巡目（Codex sol×high・2026-08-01）

12 finding（high 9・medium 3）・**全採用**→r2改訂。要点: regex identity誤爆/取り逃し、
wrapper/handler除去単位、absent復元経路、backup衝突、tmp残骸/mode、**Codex keyは`timeout`**
（dotagents apply-codex-configの同欠陥はP6で修理・caveat登録済み）、wired/drift非決定、
state dir初回/並行claim、fail-visible矛盾、PATH非依存の偽（絶対Node化）、並行書込みTOCTOU。

### 2巡目（同refuter・r2への再攻撃）

11 finding（high 9・medium 2）・**全採用**→r3改訂。裁定メモ:

1. C1/C2構文不整合（採用→emit構文を`--host`へ統一）
2. basename identityの双方向誤り（採用→install receipt照合へ全面置換）
3. Windows canonical未固定（採用・裁定: v1はtyped unsupported。半端対応を書き込まない）
4. backup mode漏洩（採用→0600・fsync/close完了で有効）
5. 偽CAS（採用・裁定: CAS僭称を廃止しhardlink退避で「消えない」契約へ変換。残余窓は明記受容）
6. retry rollback源のstale化（採用→prestate/rollback源を再読preimageへ更新）
7. 復元経路の原子性未規定（採用→復元も同規律・`RESTORE_FAILED` typed fatal）
8. state root symlink・GC所有権（採用→realpath固定・component lstat・dir fd基準）
9. claim後出力失敗の永久抑止（採用→`.claim`→出力成功→`.shown` rename・stale回収）
10. log失敗・stat異常の無記録沈黙（採用→ENOENT/ENOTDIR以外は可視診断fallback）
11. git rootがstdin cwdへ未束縛（採用→`-C <cwd>`固定argv）

### 3巡目（同refuter・r3の変更機構への再攻撃）

12 finding（high 9・medium 3）。**10件採用・1件棄却・1件部分採用**→r4改訂。裁定メモ:

1. receipt喪失/非同期での未帰属entry（採用→`foreign_candidate`可視化。削除権は与えない）
2. receipt/config間のcommit protocol欠如（採用→pending先行fsync→config commit→committed化）
3. receipt leafのsymlink（採用→`O_NOFOLLOW`・regular・owner・0600検査）
4. **不在ファイルへのlinkでinstall構造的不能**（採用→`existed:false`は`link(tmp,target)`
   no-clobber commitへ分岐。契約文の確定バグだった）
5. **「必ず残る」の反例**——hostのatomic rename型writerの内容はhardlink退避に入らない
   （採用・裁定: rename直前のdev/ino再検証で窓を縮小し、絶対表現を撤回して残余を
   明記受容へ訂正。真のatomic exchangeはNode標準に無く、native依存化は本機能の
   規模に不釣り合い）
6. parent directory fsync欠如（採用→backup/link/rename/unlink各境界でparent fsync）
7. backup/displaced無限蓄積（採用→失敗時当回分削除・成功物は直近5世代保持）
8. **`.shown`未確認で毎prompt再表示**（採用→claim前に7日以内`.shown`確認。確定バグだった）
9. stale claim回収の競合（部分採用: pid/開始時刻は診断用に記録するが、回収は年齢基準を維持。
   極端系の稀な二重INFOは実害軽微として明記受容——inode/process生存検証機構は過剰）
10. 出力成功後rename失敗の再表示（採用→可視記録＋`.shown`直接作成のfallback）
11. **fresh homeでrealpath ENOENT到達不能**（採用→最深既存ancestor基準の解決へ。確定バグだった）
12. lstat後のdirectory交換race（**棄却**: 同一uidの敵対プロセスはstate root硬化の有無に
    かかわらず利用者資産を任意に破壊できるため脅威モデル外。lstat＋owner＋mode検査で
    誤設定・非敵対事故は防げている。Node標準に*at系が無い点も棄却を支持）

### 4巡目（r4の確定バグ修正4件＋#5新機構への最終確認）

（完了後に追記）
