# Lattice sensor の起動・catch-up コスト実測

- 取得日: 2026-07-25
- 種別: コンパイル記事（自前実測）
- 確度: 実測（本機 darwin 25.5.0 / Node v26.5.0、sensor 0.7.3-lattice.1）。他host・他OSは未検証。
- 目的: sensor の自前 watcher/reconcile を AIShell (macOS MCP) の workspace delta へ寄せる案の
  着手可否を、痛みの実測で決める。判断基準は「reconcile が数十msなら着手しない」。

## 先に確認した設計事実

`ChiselIndexer.sync()`（`sensor/src/extraction/index.ts:2483`）は git 非依存の filesystem reconcile。

1. `scanDirectoryAsync` でソースファイルを列挙
2. `(size, mtime)` の stat pre-filter で未変更を弾く（read も hash もしない）
3. 通過分だけ read + content hash で実変更を確認
4. DB にあって disk に無いものを削除

MCP 起動直後に `catchUpSync()` が走り、最初の tool call がその完了をゲートで待つ
（`sensor/src/mcp/engine.ts:322`）。

**帰結**: 「sensor 停止中の変更の取りこぼし」は設計上ほぼ発生しない。rename/delete も
`git pull`/`checkout` も次回 reconcile で拾う。設計上の穴は 1 つだけ ——
size と mtime を**両方**保ったまま内容が変わる書き込み（コード内コメントに明記済み）。

したがって当初の指標②「取りこぼし率」は測っても 0 になる。測るべきは reconcile の**時間**。

## 実測

計装は既存（`LATTICE_SENSOR_SYNTH_TIMINGS=1` で stderr に phase-timing が出る）。

### reconcile の内訳

| 対象 | source files | `sync-scan` | `sync-tracked-load` | 合計 |
|---|---|---|---|---|
| Lattice repo | 596 | 39ms | 3ms | **42ms** |
| 合成repo（自明な .mjs） | 10,000 | 51ms | 8ms | **59ms** |

**ファイル数 16.8倍で reconcile は 1.4倍**。per-file 限界コストは
`(51-39)ms / (10000-596) ≈ 1.3マイクロ秒/ファイル`。walk はほぼ平坦で、
固定コスト（`git ls-files` の spawn と列挙の立ち上げ）が支配する。

外挿すると 100,000 ファイルでも scan は 170ms 程度に留まる。

### プロセス全体の wall clock

| 局面 | wall | 備考 |
|---|---|---|
| node 起動のみ | 0.03s | baseline |
| cold start（Lattice, 596 files） | 3.73s | parse 支配 |
| cold start（aishell, Swift 中心） | 6.18s | parse 支配 |
| cold start（合成 10,000 files） | 2.56s | 自明なファイルなので parse が軽い |
| warm catch-up 無変更（Lattice） | 0.18s | うち reconcile 42ms |
| warm catch-up 無変更（aishell） | 0.17s | ファイル数が 1/2.5 でも同じ |
| warm catch-up 無変更（合成 10k） | 0.23s | うち reconcile 59ms |
| 20ファイル変更後の catch-up | 0.64s | 差分の parse が支配 |

warm catch-up の wall が 655 / 1,668 / 10,000 ファイルでほぼ一定（0.17〜0.23s）である点が重要。
reconcile 以外の固定費（Node 起動、WASM grammar 初期化、DB open）が大半を占める。

## 結論: 着手しない

AIShell の workspace delta が消せるのは上記 1〜2 の「列挙 + 全ファイル stat」だけであり、
実測で **42〜59ms**。判断基準「数十msなら着手しない」に該当する。

さらに、当初の狙いが期待していた効果は次のとおり成立しない。

- **「起動時のフルスキャン消滅」** — cold start は parse 支配であり、delta では消えない。
  消えるのは 2 回目以降の catch-up の walk だけ。
- **「大きい repo ほど効く」** — 実測で否定。walk は per-file 1.3マイクロ秒でほぼ平坦。
  repo が大きいほど支配的になるのは parse であって walk ではない。
- **「停止中の変更の確実な検知」** — 既に filesystem reconcile が担保している。

## 残る唯一の論点（速度ではなく正しさ）

size と mtime を両方保ったまま内容が変わる書き込みは、現行 reconcile が原理的に拾えない。
FSEvents ベースの delta ならこの穴は埋まる。ただし発火条件は
「内容変更 ∧ サイズ同一 ∧ mtime を以前の indexed 値へ復元」であり、
mtime を意図的に保存する in-place 編集がなければ起きない。
通常の editor 保存・`git checkout`・`git pull` はいずれも mtime を進めるため該当しない。

この 1 点のために macOS/arm64 専用依存を sensor の起動経路へ入れる価値はない、と判断する。
再検討する条件は次のいずれか。

- reconcile が実測で数百ms を超える repo が現れる（本測定の外挿では 10 万ファイル級でも届かない）
- mtime 保存型の in-place 編集が実運用に入り、取りこぼしが実際に観測される

## 再現手順

```
LATTICE_SENSOR_SYNTH_TIMINGS=1 node sensor/dist/bin/lattice-sensor.js sync . 2>&1 | grep phase-timing
```

CLI 経由（`lattice sensor sync . --json`）では phase-timing が stderr に出ないため、
sensor 自身の binary を直接叩く。
