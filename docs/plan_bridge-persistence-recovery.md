# plan: bridge常駐の自己修復と可視化（2026-08-11 campaign）

- Status: Completed
- 起点: 2026-08-11、`lattice.kitepon.dev`の全projectオフライン事故
- 関連: [ADR 0165](adr/0165-terminals-advertise-exactly-what-they-serve.md)（原因の不変Decision）・
  [配備記録](operations/lattice-kitepon-deployment.md)（実測とFOXで踏んだ罠）
- 工程正本: Lattice store（`plan_key: bridge-persistence-recovery`）。本書は散文と裁定を持ち、
  状態と依存はstoreだけが持つ。

## 背景

事故そのもの（端末が名乗る集合と配信する集合の二重計算）は0.57.1で根治済み。復旧作業中に露出した
残件のうち、`bpr1`〜`bpr4`・`bpr7`・`bpr8`は完了し、`bpr6`はオーナー裁定で不要として工程から退役した。
公開面も永続PTYで復帰済みである。`bpr5`は、FOX固有のinstall・更新・Startup配線をLattice製品工程へ
二重計上していたため退役した。端末展開はdotagentsの工場機能が所有する。

## 目標

1. 常駐設定が半端な状態になっても、製品が正規経路だけで自己修復できる。
2. 生存端末をofflineと誤判定しない。通常の端末停止で表示が消えることは異常扱いしない。
3. 製品が提供する正規の常駐設定と診断だけで、異常状態から復旧できる。

## 非目標（やらないこと）

- bridgeの配線（Cloudflare Tunnel → Caddy → hub）の変更。今回の事故と無関係で、触れば別のリスクを作る。
- hubのonline判定をprobe方式へ変えること。heartbeat + TTL 90秒は正常な設計であり、
  「offline表示が最大90秒遅れる」のはheartbeat方式に固有の性質であって欠陥ではない。
- WSL2へのbridge常駐。WSL2はLANから到達不能で、Windows native側に置く既存判断を維持する。
- Windows firewallへのrule追加。**不要と実測で確定済み**（inboundは元から通っている）。
- FOX固有のinstall・更新・Startup配線。これは全ユーザー向け製品機能ではなく、dotagentsの工場展開が所有する。

## 既知の罠

- 通常のSSH sessionを閉じると、そのsessionで起動したWindows processも落ちる。ただし、aitermの
  永続PTYでSSH session自体を保てば遠隔起動を維持でき、2026-08-11に公開面の復帰まで実測済みである。
  Startup launcherはlogon時に一度だけ走るため、すでにlogon済みの端末を「オーナーの対話logon待ち」と
  記録しない。端末固有の配布経路是正はLattice工程へ戻さず、dotagents側で扱う。
- **「繋がらない」の観測は、対象processが生きている同じ窓の中で取る。** 死んだlistenerへの
  接続失敗は経路遮断と同じ症状を出す。2026-08-11にこれでfirewallの誤診を1回出している。
- FOX固有のjunction／registry選択をLatticeの製品工程へ戻さない。端末配布はdotagentsだけを正本とする。
- publishは`prepublishOnly`がworking treeのcleanと既定ブランチ祖先を要求する。

## 検証方法

- 単体: `npm test`（局所）・`npm run check`。常駐系は`test/bridge-startup-folder.test.mjs`と
  `test/bridge-launch-agent.test.mjs`をfocused testに使う。
- 受入: **公開面の実応答だけで判定する**。`/projects/<id>/`が200を返すこと。
  一覧の「オンライン」表示は受入条件にしない（heartbeatはoutbound、配信はinboundで経路が別）。
- 配備: 各端末で`lattice bridge status --json`の`runtime.version`が対象版であること。

## ToDo

- bpr1-selfheal: 常駐設定の分裂状態を製品が自力で畳めるようにする（完了・工程正本はLattice store）
- bpr2-doc-split: docs/bridge-setup.mdへ新しいpersistence状態の読み方を追記する（完了・工程正本はLattice store）
- bpr3-adr: ADR 0166「復旧経路は復旧対象の状態に拒否されてはならない」を起草する（完了・工程正本はLattice store）
- bpr4-release: 0.57.2をreleaseしMac／WSL2へ配って実測する（完了・工程正本はLattice store）
- bpr5-fox-install: FOX固有の配備はdotagents所有のため、Lattice製品工程から退役
- bpr6-offline-notice: オーナー裁定2026-08-10で打ち切り。工程から除外し再開しない
- bpr7-kitepon-visibility: 停止中projectを公開一覧へ載せるかを裁定する（完了・工程正本はLattice store）
- bpr8-caveat: SSH session連動でWindows常駐が落ちる罠を罠DBへ記録する（完了・工程正本はLattice store）

## 完了裁定

- Lattice側の製品修復、release、文書、Decision、知識還流は完了した。
- FOXを含む端末ごとの導入・更新・常駐配線・rollbackはdotagentsだけが所有する。
