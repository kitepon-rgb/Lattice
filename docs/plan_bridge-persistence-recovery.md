# plan: bridge常駐の自己修復と可視化（2026-08-11 campaign）

- Status: Active
- 起点: 2026-08-11、`lattice.kitepon.dev`の全projectオフライン事故
- 関連: [ADR 0165](adr/0165-terminals-advertise-exactly-what-they-serve.md)（原因の不変Decision）・
  [配備記録](operations/lattice-kitepon-deployment.md)（実測とFOXで踏んだ罠）
- 工程正本: Lattice store（`plan_key: bridge-persistence-recovery`）。本書は散文と裁定を持ち、
  状態と依存はstoreだけが持つ。

## 背景

事故そのもの（端末が名乗る集合と配信する集合の二重計算）は0.57.1で根治済み。本campaignが扱うのは、
その復旧作業中に露出した**残り5件**である。オーナー裁定（2026-08-11）により、5件すべてを
「npmに載って全端末へ届くまで」を完了条件として扱う。手作業の復旧を完了と呼ばない。

## 目標

1. 常駐設定が半端な状態になっても、製品が正規経路だけで自己修復できる。
2. 端末が公開面から消えたことに、人が気づける。
3. 全端末が同じ配布経路で最新版を受け取る。

## 非目標（やらないこと）

- bridgeの配線（Cloudflare Tunnel → Caddy → hub）の変更。今回の事故と無関係で、触れば別のリスクを作る。
- hubのonline判定をprobe方式へ変えること。heartbeat + TTL 90秒は正常な設計であり、
  「offline表示が最大90秒遅れる」のはheartbeat方式に固有の性質であって欠陥ではない。
- WSL2へのbridge常駐。WSL2はLANから到達不能で、Windows native側に置く既存判断を維持する。
- Windows firewallへのrule追加。**不要と実測で確定済み**（inboundは元から通っている）。

## 既知の罠

- **SSH越しに起動したWindowsのprocessは、SSH sessionが閉じた瞬間に落ちる**（3回再現）。
  遠隔からできるのは常駐設定の修復までで、常駐の開始はオーナーの対話logon sessionを要する。
  受入を「起動できたか」で測ると、この罠に必ず騙される。
- **「繋がらない」の観測は、対象processが生きている同じ窓の中で取る。** 死んだlistenerへの
  接続失敗は経路遮断と同じ症状を出す。2026-08-11にこれでfirewallの誤診を1回出している。
- FOXの`@quolu/lattice`はregistry installではなく開発checkoutへのjunction。releaseは自動で届かない。
- publishは`prepublishOnly`がworking treeのcleanと既定ブランチ祖先を要求する。

## 検証方法

- 単体: `npm test`（局所）・`npm run check`。常駐系は`test/bridge-startup-folder.test.mjs`と
  `test/bridge-launch-agent.test.mjs`をfocused testに使う。
- 受入: **公開面の実応答だけで判定する**。`/projects/<id>/`が200を返すこと。
  一覧の「オンライン」表示は受入条件にしない（heartbeatはoutbound、配信はinboundで経路が別）。
- 配備: 各端末で`lattice bridge status --json`の`runtime.version`が対象版であること。

## ToDo

- [ ] bpr1-selfheal: 常駐設定の分裂状態を製品が自力で畳めるようにする（Windows/macOS両方・test込み）
- [ ] bpr2-doc-split: `docs/bridge-setup.md`へ新しいpersistence状態の読み方を追記する
- [ ] bpr3-adr: ADR 0166「復旧経路は復旧対象の状態に拒否されてはならない」を起草する
- [ ] bpr4-release: 0.57.2をrelease（CHANGELOG・bump・publish）し、Mac／WSL2へ配って実測する（H）
- [ ] bpr5-fox-install: FOXをregistry installへ切り替え、対話logonで常駐を起こして実測する（H）
- [ ] bpr6-offline-notice: 端末のonline→offline遷移を運用者へ届ける機構を設計・実装する（設計承認待ち）
- [ ] bpr7-kitepon-visibility: 停止中projectを公開一覧へ載せるかを裁定する（裁定待ち）
- [ ] bpr8-caveat: SSH session連動でWindows常駐が落ちる罠を罠DBへ記録する

## オーナー裁定待ち（着手前に必要）

- **bpr5**: FOXのjunction installをregistry installへ寄せてよいか（開発構成を変える）。
- **bpr6**: 通知の形（webhook POST先）と、そもそもこの形でよいか。
- **bpr7**: kitepon.devを「動いていないので出さない」のままにするか、停止中も載せる機能を足すか。
