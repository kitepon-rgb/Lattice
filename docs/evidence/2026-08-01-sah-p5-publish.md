# sah-p5-publish — 公開証跡（sensor-awareness-hooks campaign）

- 記録: 2026-08-01 / Control `sensor-awareness-hooks-20260801`
- H承認: オーナーGO受領（publish・端末反映・smokeを含む同一wave承認）

## release

| 項目 | 結果 |
|---|---|
| release commit | `ff6fa8c`（正典化＋0.40.0 bump）— origin/main着地済みを祖先gateが機械検証 |
| release gate | `verify:release-commit` green。**初回publishはtodo start由来のdirty treeをgateが正しく拒否**→store収容後のclean treeで通過（gateの実効性が実地で確認された） |
| npm publish | `+ @quolu/lattice@0.40.0`（registry `time.modified` 2026-08-01T14:54:52Z） |

## 対象端末への反映と公開後smoke（この端末）

| 項目 | 結果 |
|---|---|
| global install | `@latest`はdist-tag伝播ラグで一度0.39.3のまま→`@0.40.0`明示で解決。`lattice --version`=0.40.0 |
| `hooks install --host claude` | `wired`。status: wired / exec_ok / matched 1 / foreign 0。canonicalはglobal install先の絶対path。backup自動作成 |
| `hooks install --host codex` | `wired`。status: wired / exec_ok |
| 実settings検証 | UserPromptSubmit 4entry（既存3件保持＋lattice 1件追加）・JSON valid |
| emit実発火 | 契約どおりのINFO 1行（sensor index持ちrepo・session×repo 1回） |

## 残H（オーナー操作待ち）

- **Codex hook trust**: `~/.codex/hooks.json` 変更後のtrust承認はCodex側UI（`/hooks`）での
  人手操作。承認まではCodex sessionで導線hookが発火しない可能性がある。

## rollback

端末: `lattice hooks uninstall --host <host>`（自entryのみ除去・backup残存）。
registry: `npm i -g @quolu/lattice@0.39.3` で前版へ。
