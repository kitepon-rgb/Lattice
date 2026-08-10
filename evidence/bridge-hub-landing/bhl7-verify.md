# bhl7-verify — ローカル実測とfull gate

## 実行環境
`LATTICE_HUB_RUNTIME_DIR=<tmp> LATTICE_HUB_PORT=8787 LATTICE_HUB_ALLOWED_HOSTS=127.0.0.1 node bin/lattice-hub.mjs`。
偽端末4件を`/__lattice/hub/register`へPOST（lattice/chromeblocker=FOX、root-site-promotion=KaitonoMacBook-Air.local、
smoketest-probe=smoketest）。`public-visibility.json`で`smoketest-probe`を隠し、display_namesを
`root-site-promotion→kitepon.dev` / `lattice→Lattice` / `chromeblocker→ChromeBlocker`に設定。

## 実測結果

- 4面応答: `/` 200 / `/projects/` 200 / `/en/` 200 / `/en/projects/` 200。
- JSON投影: `["chromeblocker","lattice","root-site-promotion"]` — `smoketest-probe`は不在。
- 主従入替: カード主見出しが表示名（ChromeBlocker / Lattice / kitepon.dev）、従が「配信元: FOX」等のホスト名。
- **visibility hot-reload（再起動なし）**: 稼働中に`chromeblocker`を`hidden_project_ids`へ追記 →
  即座に`["lattice","root-site-promotion"]`。差し戻すと3件へ復帰。hub再起動なし。
- **hidden ≠ private**: `/projects/smoketest-probe/`は一覧から消えた状態でも503（配信元オフライン。
  偽portのため到達不能だがproxy経路自体は生存＝404ではない）。
- 幅8構成（JA/EN × 340/394/612/760）を実寸Chromiumでフルページ撮影（`shots/`）。
  340px実測で`scrollWidth 325 <= innerWidth 340`＝横overflowなし。カード段組は720px以下で1列へ落ちる。

## gate

`npm run ci` exit 0、`ℹ pass 1664 / ℹ fail 0`（test + sensor test + syntax + cli-surface +
open-questions + reachability + todo-store）。
