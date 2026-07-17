# RC4 Stage 0 — compile判定の親裁定とStage 0 gate（改良後sensor・後半測定）

- Date: 2026-07-17
- 前半: [batch定義](2026-07-17-rc4-stage0-batch.md)・[witness実測](2026-07-17-rc4-stage0-witness-cost.md)
  （改良前sensorでAFFECTED_TEST_DRIFT停止＝「conflict/wave判定・unknown率・見逃し0確認は未実施」で持ち越し）
- 本測定: L2改良後sensor（`1.4.1-lattice.1`・Lattice `a3ada30`ビルド）で持ち越し分を消化する
- target: dotagents clone `c3640f4`（凍結不要合意どおりHEAD追従。正規repoへの書込ゼロ、
  `codegraph init`はclone上のみ）。sensor実行はNode 24（homebrew `node@24`）＝Node 25+ hard-blockを
  env迂回なしで通す正攻法
- 検証規律: 実測値のみ。丸め・事後推定なし。未達は未達と書く

## 1. 観測品質の前提確認（HEAD `c3640f4`・真値grep再検証つき）

真値はADR 0048 Decision 1の方法論（推移的import閉包＋定数畳み込み動的import、辺ごとgrep実在検証）で
本HEADに対し再導出した。O4以降の新testも閉包に入る。

| ターゲット | 真値 | 観測 | 判定 |
|---|---|---|---|
| `lib/orchestrate/control-record.mjs` | 7件（直接3＋`loadControl()`動的2＋推移3、重複除去後7。rate-selector/quota系はO4でのimport連鎖） | 7件 | **exact（FP0/FN0）** |
| `bin/orchestrate-run.mjs` | 6件（helpers `spawnOrchestrate`のspawn辺→helpers importer 6 test） | 6件 | **exact（FP0/FN0）** |
| `lib/orchestrate/executor-adapters.mjs` | 3件（静的2＋top-level動的import 1） | 3件 | **exact（FP0/FN0）** |

shell経由の結合（`tests/hooks/smoke.sh`・`tests/install/clean-home.sh`・`tests/skills/smoke.sh`）は
(c2)クラス＝親plan裁定どおり不可視のまま（再燃条件はStage 1実測）。index構築は1,511 nodes/8,604 edges・534ms。

## 2. 測定設計: 2 request構成

front-end実読で**unknownはrequest全体をBOUNDARY_UNKNOWNへ落とす**（node単位の分離なし）と確定したため、
batch 6件を1 requestに混ぜるとconflict/wave判定が一切観測できない。そこで:

- **request A**（T1+T2+T4・dispatchable候補・capacity 2）: conflict/wave判定の裁定用
- **request B**（T1〜T6全件・capacity 2）: unknown分類の妥当性の裁定用

これはscripted campaign（RC3-H）の「同一base・template同一・注入のみ可変」解釈の踏襲。

## 3. witness束縛の作法（3回のcompile試行で確定した実測知見）

1. **交差するwrite pathは両TODOがownsで所有主張する**。片側だけ・両側なしは
   `undeclared_write_overlap`＝方向を推測せずunknownへfail closed（1回目の失敗機序）。
2. **各owns entryはcovering query束縛が必須**。無いと`codegraph_unbound`（2回目の失敗機序。
   ownsを増やすと束縛も増やす）。
3. **同一own targetのcovering queryは全witnessで単一query_id**。別idはQUERY_DRIFT（ambiguous）。
   共有ownは同じqueryを両TODOが参照する。
4. **affected束縛はwitnessの`affected_tests`1本とexact比較**されるため実質1 witness 1本。
   追加ownの裏付けは`path` expect＋structure query（`codegraph query <filePath>`はfile nodeを
   filePath exactで返すことを実測確認）。

試行記録: 1回目BOUNDARY_UNKNOWN（作法1）→2回目BOUNDARY_UNKNOWN（作法2）→3回目dispatchable。
witness初稿コストはStage 0前半の実測（17〜36秒/件）から変わらず、今回の追加コストは
作法学習（front-end実読＋2失敗）が支配的＝Stage 1では本節の作法で再発しない。

## 4. request Aのcompile結果と親裁定（1件ずつ）

`lattice plan compile` exit 0・**dispatchable**（wall-clock 0.78s、compile本体0.6s台）。

plan: conflicts 3件・precedence 0・waves `[[T1,T4],[T2]]`（minimum_feasible_waves=2）。

| # | 判定 | 内容 | 親裁定 |
|---|---|---|---|
| 1 | conflict | T1×T2 shared own write（`tests/orchestrate/control-record.test.mjs`） | **妥当**（真の共有write） |
| 2 | conflict | T1 write `lib/orchestrate/control-record.mjs` × T2 read同 | **妥当**（T2のresume-check改善はlib挙動へ依存） |
| 3 | conflict | T2 write `bin/orchestrate-run.mjs` × T1 read同 | **妥当** |
| 4 | wave | `[T1,T4]`並列→`[T2]`（2 waves） | **妥当・過剰serialなし**（T4独立を正しく並列化。serial chain長2が下限） |
| 5 | 非conflict | T1がT4のaffected test（CR test）をwriteするが衝突扱いしない | **妥当**（isolated worktree実行＋receipt drift検出の担当領分。witnessモデルの見逃しではない） |

**見逃し0件を確認**（即refute条件は非成立）: 独立grepでT1×T4・T2×T4の結合候補を全数照合
——executor-adapters.testはhelpers非import・spawnOrchestrate不使用、write集合の交差なし。
planが落とした実在結合は0。

## 5. request Bのcompile結果と親裁定

**BOUNDARY_UNKNOWN**（期待どおり・失敗ではない）。unknown内訳:

- T3: 宣言`cross_repo_write`（ServerManager主体）＋md own `codegraph_empty` — **妥当**
  （repo境界外writeはwitnessで表現できないというStage 0期待値のtyped実証）
- T5/T6: 宣言`external_repo_write`（OpenCClaw還流先）＋queue md own `codegraph_empty` — **妥当**
  （markdown＝call graph非可視の盲点題材が、黙殺でなくtyped unknownとして現れた）
- T1/T2/T4: unknown 0 — **妥当**

unknown分類一致率: **6/6**（unknown期待クラス3件が全てunknown、dispatchable候補3件が全て非unknown）。

### Stage 1 packet設計への帰結

unknownのwhole-request gatingにより、**unknown期待クラスのTODOをdispatchable batchへ混載しない**
（request分割で扱う）ことをStage 1のrequest構成規則とする。

## 6. 発見した非クリティカル欠陥（maintenance queue行き）

- `lattice plan compile`のCLI errorは`code`/`message`のみで`detail`（unknown内訳・drift mismatches）を
  落とす。診断にはlib直呼びが必要だった。fail closed自体は正しく、P0/P1非該当
  → RC4 plan maintenance queueへ記録。

## 7. Stage 0 gate裁定（witnessコスト閾値・unknown率・判定一致率 → Stage 1 target）

- **witnessコスト閾値**: Stage 1受入は「witness総コスト（初稿＋照合）1 TODOあたり≤3分」かつ
  「AFFECTED_TEST_DRIFT起因のwitness写経0件」。根拠: 前半実測17〜36秒/件＋改良後sensorで
  drift照合60秒/周が消滅（L2比較evidence）・本測定でもdrift 0。
- **unknown率**: dispatchable系batchはunknown率0を受入条件とする。unknown期待クラス
  （cross-repo・外部還流・md主体）は分類一致100%を維持し、request分割で並走させる。
- **判定一致率**: affected exact（FP0/FN0）・conflict裁定妥当率100%・過剰serial 0・見逃し0を維持。
  見逃し>0は即refute（親plan既定どおり）。
- **Stage 1 target裁定**: dispatchable 3 TODO（交差2組＋独立1、`control-record.mjs`級巨大file交差を
  含む）×capacity 2×2 wavesを最小構成に、L4（隔離HOME・disposable clone・H承認後）の
  閉ループへ進む。witness作法は§3、request構成規則は§5を焼き込む。

## 8. 限界（正直な記録）

- 本測定はcompile判定まで。dispatch〜receipt閉ループはStage 1（L4）の正規の場（L2比較evidenceの
  裁定を維持）。
- 単一batch・単一repo・親が実装熟知の条件下。witness作法（§3）の一般化はStage 1で再検証する。
- T1のTODO実体（finalization archive衝突）はADR 0060系の消化で一部staleの可能性があるが、
  凍結不要合意どおり「判定のstale化はそれ自体を実測記録」として扱い、witnessは現HEADの
  ファイル実体に対して正直に作成した。
