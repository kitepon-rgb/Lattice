# Lattice RAG Index

- [npm-pack/npm-12-report-compatibility.md](npm-pack/npm-12-report-compatibility.md) — npm 12のpack JSON変更、Mac CI失敗のWindows再現、新旧形式の共通読込（2026-09-05・公式仕様＋実測）
- [npm-publishing/trusted-publishing.md](npm-publishing/trusted-publishing.md) — npm公開時の本人認証をOIDCへ置き換える条件と実公開による確認（2026-09-05・公式仕様）

- [parallel-ready-planning/parallel-ready-todo-research.md](parallel-ready-planning/parallel-ready-todo-research.md) — TODO DAG、競合、capacity、Codegraph boundary、seam-refactor、version barrierを統合した先行研究コンパイル記事（2026-07-15・確度はclaim別）
- [parallel-ready-planning/codegraph-portable-evidence.md](parallel-ready-planning/codegraph-portable-evidence.md) — Codegraph raw telemetryを再現可能なstructural projectionと分離するRC1実測・設計（2026-07-15・1.4.1実証）
- [parallel-ready-planning/frontier-audit-readjudication.md](parallel-ready-planning/frontier-audit-readjudication.md) — 監査指摘をコード再現・論理破綻・一次資料誤読へ限定して全件再裁定した親Decision記録（2026-07-15）
- [parallel-ready-planning/rc1-v3-phase-gate-results.md](parallel-ready-planning/rc1-v3-phase-gate-results.md) — green regression後も測定器交絡、test write脱落、digest-only evidenceを再現して因果結論をrejectしたPhase監査コンパイル（2026-07-15・実コード実証）
- [parallel-ready-planning/codegraph-artifact-identity-exclusion.md](parallel-ready-planning/codegraph-artifact-identity-exclusion.md) — immutable execution sourceがlive graphを汚染したRC2実測と、`codegraph.json` exclude／config identity bindingの設計（2026-07-16・Codegraph 1.4.1実証）
- [network-bridge/network-bridge-deployment-research.md](network-bridge/network-bridge-deployment-research.md) — opt-in Mac bridgeをDocker Caddy／Cloudflare Tunnelへ復旧可能に接続する配備順序とgate、LAN addressリテラルの陳腐化をssh逆トンネルで消す条件（2026-07-26・公式仕様＋対象環境実測）
- [sensor-startup/sensor-reconcile-cost-measurement.md](sensor-startup/sensor-reconcile-cost-measurement.md) — sensorのreconcileが596→10,000ファイルで42→59msにしか伸びずwalk置換の便益が無いことを示し、AIShell delta連携を不着手と裁定した実測（2026-07-25・本機実測）
- [sensor-startup/language-coverage-verification-20260803.md](sensor-startup/language-coverage-verification-20260803.md) — upstream 49c11fc取り込み後の41言語カバレッジ実測。33言語で依存辺まで動作・作るべき不足なしの裁定と範囲（2026-08-03・本機実測）
