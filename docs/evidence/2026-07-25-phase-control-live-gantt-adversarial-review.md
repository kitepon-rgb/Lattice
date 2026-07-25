# Phase `lattice-codegraph-removal` 敵対的検証

- 対象: plan `phase-control-live-gantt` / revision `rev-aaf251c169b577e1b85dbf35`（35 ToDo 全done、phase = `gate_ready`）
- 実施日: 2026-07-25
- 実施commit: `5ad3fb8`（= `origin/main`、公開版 0.12.11）
- 方針: 完了主張を殺しにいく。棄却できたものと、**殺せてしまったもの**を分けて記録する。

## 1. 実コードで再現した欠陥（4件・いずれも本waveで修理済み）

phaseの成果物に対して実際に再現した欠陥。すべてcharacterization testを先に置いてから修理した。

| # | 欠陥 | 再現 | 修理 |
|---|---|---|---|
| 1 | revisionでcarryされたdoneの`todo reopen`が`STORE_INCONSISTENT/invalid_reopen_binding`で常に失敗 | 0.12.9で再現。実storeのcarried done `lpg-001`で失敗、journal内doneの`lpg-029`は成功という対照を取得 | 0.12.10 |
| 2 | `todo status --json \| head`が未処理EPIPEでstack traceを出しexit 1 | 0.12.9で再現。修理前exit 1 + `Unhandled 'error' event`、修理後exit 0 + stderr空 | 0.12.10 |
| 3 | carried imported doneへの`evidence promote`が`invalid_evidence_promotion`で失敗（#1と同型） | characterization testで再現 | 0.12.11 |
| 4 | publish前検査がuntrackedを見ておらず、未commitファイルが公開tarballへ混入 | 0.12.10のpack試行で`src/todo-gantt-scope.mjs`が12.1kB混入（total files 729→退避後728） | 0.12.11 |

#1と#3は同一原因。`replay`はcarried doneを`plan_genesis`のdigestへ正しく束縛していたのに、
`resolveTargetedEvent`が`done`イベントだけを探していた。**replay側とresolve側で束縛規則が
食い違っていた**のが根であり、どちらも単独では正しく見えるため通常のtestで露見しなかった。

#4は release gate 自身の穴。gateのコメントが防ぐと宣言しているリスクが、
`--untracked-files=no`という指定で開いていた。

## 2. 反証を試みて棄却できた主張

| 対象task | 主張 | 検証 | 結果 |
|---|---|---|---|
| lpg-014 | 静的Gantt artifact status surface | 正常時`current` / html改竄→`GANTT_ARTIFACT_INVALID artifact_digest_mismatch` / html消去→`artifact_pair_incomplete` | **保つ** |
| lpg-023 | 旧runtime名の再混入gate | `src`・`bin`・`package.json`の`codegraph`参照を全数走査 → 0件 | **保つ** |
| lpg-021,022 | sensorは`./sensor/dist`からのみ起動 | `sensor-runtime.mjs:6`が`../sensor/dist/bin/lattice-sensor.js`固定。PATH／npx／外部SDKへのfallback経路なし | **保つ** |
| lpg-032 | 工程図rendererの線重複なし・非接触半円bridge | layout testの`assertNoCollinearOverlap`と bridge metadata assertion が現行コードでgreen | **保つ** |

## 3. 殺せてしまった主張（未解決・所有者裁定が要る）

### lpg-035「lattice.kitepon.devを復旧可能に公開し実到達を確認する」— 現時点で到達しない

```
$ curl -sD - https://lattice.kitepon.dev/
HTTP/2 502
server: cloudflare
error code: 502
```

Cloudflare edge自身の502＝tunnelのoriginが繋がっていない。切り分け結果:

```
このMacの唯一のIPv4      : 192.168.1.103
lattice bridge status   : enabled=true, listen=192.168.1.102:53939, recovery=null
192.168.1.102 の割当     : 0（どのinterfaceにも存在しない）
listen socket           : node PID 55350 が 192.168.1.102:53939 を保持（stale binding）
http://192.168.1.103:53939/ : 応答なし
192.168.1.2             : ping応答あり（LAN上は生存）
```

**原因**: DHCPリースでMacのLAN IPが`.102`→`.103`へ変わったが、bridgeはsetup時に取得した
**リテラルIPへ固定**されており、旧アドレスのlisten socketを保持したまま新アドレスでは待ち受けない。
上流（192.168.1.2のCaddy/Tunnel）は`.102:53939`を向いたままなので到達不能になる。

**二次的な問題（Lattice側のコード）**: `lattice bridge status`は`enabled: true`・`recovery: null`と
報告する。**listen中のアドレスが自ホストに存在するかを検査していない**ため、公開サービスの
停止を検知できない。これは環境変化ではなくLattice自身の観測欠落である。

**修理がこのrepo単独で閉じない理由**: Macを`.103`へ張り替えても、192.168.1.2側のupstreamが
`.102`を向いたままなので到達は回復しない。DHCP予約で`.102`を取り戻すか、上流の向き先を
変えるかの選択は所有者の環境裁定に属する。

**受理への含意**: phaseの完了条件のうち lpg-035 の「実到達を確認する」は、
**本検証時点で成立していない**。判断は所有者に委ねる。

## 4. 本検証が確認していない範囲（正直な限界）

- lpg-033/034（dashboard自動起動、setup wizardのport排他bind）は再検証していない。
- lpg-026〜030（multi-epoch run store、executor hold、seam split、実競合fixture）は
  既存testのgreenを確認しただけで、独立した敵対fixtureを新規に組んでいない。
- lpg-010「実browser受入」は再実施していない。

これらを「検証済み」と読まないこと。
