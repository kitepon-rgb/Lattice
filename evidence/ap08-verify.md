# ap08 補遺: 実v5 CLIと実hookの突き合わせ

done 済みの ap08 で「未確認」として残した項目を、手が空いた時間で潰した記録。
`evidence/ap08.md` は done 時の blob digest で固定されているので書き換えず、別ファイルとして残す。

## 何が未確認だったか

`evidence/ap08.md` の「未確認・残っているもの」に、こう書いた。

> **実際のSessionStart INFOでの目視は未取得。** smokeで文字列は固定したが、installed CLIがv5を
> 返すのはpublish後なので、実セッションで札が出るのを見るのはpublish後になる。

smoke test が突き合わせているのは「hookのpython」と「shell fixtureが吐く固定JSON」であって、
**実際のLattice CLIが吐くv5と突き合わせてはいない**。つまり ap03 の実装と私の検証の間に、
誰も渡っていない継ぎ目が1本残っていた。

## どう潰したか

installed CLI（0.46.2・v4）を待つ必要はなかった。repo内buildを`lattice`という名でPATHへ置けば、
publish前でも実v5 CLIと実hookを直結できる。

```sh
printf '#!/bin/sh\nexec node /Users/kite/Developer/Lattice/bin/lattice.mjs "$@"\n' > shim/lattice
```

hookは`/Users/kite/Developer/dotagents/bin/lattice-gantt-hook.sh`をそのまま起動した。
入力は実際のSessionStartと同じ`{"session_id", "source":"startup", "cwd"}`。

### 1. 本repo（監査待ち0件）

```
INFO: Lattice工程表: file:///Users/kite/Developer/Lattice/.lattice/generated/gantt.html。
現在地: active=audit-pending-surface/ap04（lattice statusのnext_actionを監査待ちへ向ける）;
next-ready=なし。校正状態: reconciled=6, unreconciled=27。工程正本は Lattice store、…
```

- schema v5 を受理し「対応範囲外」へ落ちない。**publish時の破断が実物で否定された。**
- 監査待ち0件なので札は出ない（陰性）。

### 2. gate_ready の実store（陽性）

一時repoに phase無しplan（task A→B）を作り、両方doneにして暗黙 terminal-audit Phase を
gate_ready にした。CLIの実出力:

```json
"audit_pending": [{"plan_key":"audited","phase_id":"terminal-audit","phase_status":"gate_ready",
"implicit":true,"required_evidence_slots":["terminal-audit"],
"next_commands":["lattice todo phase review --plan audited --phase terminal-audit --reason <text>",
"lattice todo phase close-unaudited --plan audited --phase terminal-audit --reason <text>"]}]
```

同じstoreへ実hookを通した結果:

```
INFO: Lattice工程表: 未生成（…）。現在地: active=なし; next-ready=なし。
校正状態: reconciled=0, unreconciled=1。監査待ち1件: audited/terminal-audit（gate_ready）。
未監査は未完了です。工程正本は Lattice store、…
```

**`active=なし; next-ready=なし` でありながら発話している。** これが `has_guidance()` の眼目で、
改修前ならここは無音で終了し、AIには「工程からの通知が何も無い＝残作業なし」としか見えなかった。

- ap03のentry形（exact 6キー）が、私が room [14] で宣言し消費側へ焼いた形と実物で一致している。
- hinanoの`auditPendingNextCommands`が返すフル形コマンドが、私の`next_commands`検証（非空・
  16384字以内のstring配列）をそのまま通っている。3人の宣言が実物で噛み合った。

### 3. accept相当の後（陰性）

同じstoreで`todo phase close-unaudited`を実行してから再度hookを通した。

```
bytes=0
```

監査が閉じれば札も発話も消える。監査待ちが「消えない常在の警告」になっていないことの確認。

## 何が確認できて、何がまだか

| 継ぎ目 | 状態 |
| --- | --- |
| ap03のv5出力 ↔ dotagents hookの検証器 | **実物で確認** |
| ap03のv5出力 ↔ hookのINFO表示 | **実物で確認**（陽性・陰性の両方） |
| 全task done時にhookが沈黙しない | **実物で確認** |
| installed CLI（0.46.2）でのSessionStart | 未確認。publish後にしか取れない。ここは変わらず残る |
| projection / saga と実v5 CLI | 未確認。両者はexact pinなのでv5を要求し、smokeではなくunit testで固定済み |

3行目までは publish を待たずに取れた。逆に言うと、smokeだけを根拠に「動く」と書いていたら、
この3本は誰にも渡られないまま publish を通っていた。

## 後片付け

一時storeは`$TMPDIR/ap08-gate-ready-*`。fixtureスクリプトはscratchpadに置いてrepoへは入れていない
（本repoのtestとして残す価値があるなら ap06 の担当が実storeで書く方が筋が良い。私の判断で
test suiteへ足すのは ap06 の受入条件へ勝手に入り込むことになるのでやらない）。
`LATTICE_DASHBOARD_AUTOSTART=0` を付けて回したので、常駐daemonは起こしていない。
