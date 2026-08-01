# sensor-awareness-hooks — 終端監査記録（terminal-audit phase）

- 記録: 2026-08-02 / Control `sensor-awareness-hooks-20260801`
- 監査人: Codex旗艦×high（campaign無関与の独立session・read-only）
- 裁定: claude-fable-parent（accept）

## 判定: accept可（Red 0件・全5観点green）

| 観点 | 結果 | 要点 |
|---|---|---|
| 公開物の実在と中身 | green | registry 0.40.0 tarball SHA-1一致・`hooks-cli.mjs`のSHA-256がrepo HEADと一致・registry版で4 subcommand help／install→status→冪等→uninstall／emit初回表示・重複抑止まで実動 |
| 証拠連鎖 | green | plan verify exit 0・P0〜P7全task doneの pinned blob SHA-256一致・HEADから到達可能（P2はhistorical blobとして到達確認） |
| 正典整合 | green | docs/01「hooks導線」と実装・help・46テストの間でschema／error code／state／timeout key／回収周期（receipt 30s・claim 1h・shown 7d）全token一致 |
| 逸脱申告の整合 | green | ADR 0152の申告（worker-run代替・実HOMEインシデント・Windows unsupported・Throughline/Caveat切り出し・r5からの3逸脱）がstore note・各証跡と相互一致。隠された逸脱の検出なし |
| 回帰 | green | `npm test` 1280/1280 pass・fail 0（hooks 46件含む）。監査によるrepo/実HOME変更なし |

## 位置づけ

Lattice工程機構のterminal-audit gate（0.36.0導入・ADR 0148）に対する正規の監査完了。
campaign本体の完了裁定は [ADR 0152](../adr/0152-sensor-awareness-hooks-campaign-completion.md)。
