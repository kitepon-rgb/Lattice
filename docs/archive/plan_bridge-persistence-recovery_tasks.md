# Lattice ToDo archive
Plan: bridge-persistence-recovery
Batch: bpr-cutover-20260811
Revision: 899e0a465193f6a6c7b5a7e4625b7444c0ff028d6198b4c0b6ca5801ba3ce9a3

- [ ] bpr1-selfheal: 常駐設定の分裂状態を製品が自力で畳めるようにする（Windows/macOS両方・test込み）
- [ ] bpr2-doc-split: `docs/bridge-setup.md`へ新しいpersistence状態の読み方を追記する
- [ ] bpr3-adr: ADR 0166「復旧経路は復旧対象の状態に拒否されてはならない」を起草する
- [ ] bpr4-release: 0.57.2をrelease（CHANGELOG・bump・publish）し、Mac／WSL2へ配って実測する（H）
- [ ] bpr5-fox-install: FOXをregistry installへ切り替え、対話logonで常駐を起こして実測する（H）
- [ ] bpr6-offline-notice: 端末のonline→offline遷移を運用者へ届ける機構を設計・実装する（設計承認待ち）
- [ ] bpr7-kitepon-visibility: 停止中projectを公開一覧へ載せるかを裁定する（裁定待ち）
- [ ] bpr8-caveat: SSH session連動でWindows常駐が落ちる罠を罠DBへ記録する
