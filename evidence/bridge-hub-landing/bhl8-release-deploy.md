# bhl8-release-deploy — 0.56.0 release と本番反映

## release
- 対象commit `46a93bf`（`origin/main`の祖先条件を充足）。`@quolu/lattice@0.56.0`をpublish。
  811 files / 7.4 MB tarball。registry latest = 0.56.0を実測確認。
- main worktreeは並行エージェント作業でdirtyだったため、対象commitのclean worktreeから出した。
  `sensor/node_modules`はsymlinkではなく実ディレクトリとしてcopy（`.gitignore`の`node_modules/`は
  末尾スラッシュでディレクトリにしか当たらず、symlinkはuntracked扱いでgateを塞ぐ）。

## 本番反映（192.168.1.2）
- `npm install -g @quolu/lattice@0.56.0`（0.54.0から更新）
- `~/.lattice/hub/public-visibility.json`をmode 0600で新規作成
  （hidden: smoketest-probe / smoketest terminal、display_names: lattice→Lattice、
  root-site-promotion→kitepon.dev）
- `sudo systemctl restart lattice-hub.service` → active、journalに
  `lattice.hub_daemon_started.v1` port 53943 を確認
- Mac端末: 0.56.0へ更新し`launchctl kickstart -k gui/<uid>/dev.kitepon.lattice.bridge`

## 受入（配信内容で判定。status codeでは判定しない）
- origin（172.18.0.1:53943、Host付き）: `/` `/projects/` `/en/` `/en/projects/` の4面すべてで
  マーカー文字列（特許出願済み / PATENT PENDING）を検出。
- 公開HTTPS: `/`と`/projects/`がJA landing（title「Lattice — 並列開発のschedulability compiler」）、
  `/en/`と`/en/projects/`がEN landing（title「Lattice — a schedulability compiler for parallel development」）。
- `/projects/lattice/` 200・従来の依存工程図（title「Lattice — Lattice 依存工程図」）。
- 公開一覧 = `["ChromeBlocker","iine","lattice","root-site-promotion"]`。`smoketest-probe`は不在。
  カード主見出しにLattice / kitepon.devの表示名が反映。
- `/projects/smoketest-probe/` は一覧非表示のまま503（配信元オフライン）で中継は生存＝hidden≠privateを実証。
- `name="robots"`: `/`・`/en/`・`/projects/lattice/`・`/projects/root-site-promotion/`で0件。

## 残り（carry over）
- `/projects/ChromeBlocker/`（Windows端末FOX配信）だけrobotsメタが残る。当該端末の
  `@quolu/lattice`はローカルcheckoutへのnpm linkであり、registry版へ差し替えるとオーナーの
  開発構成を変えるため触っていない。
