# Task notes v0.38.0 release plan（完了）

## 目的

ToDoへ蓄積した作業記憶を、追加コマンドを要求せず通常詳細、`todo start`、ローカルGantt右ペインへ
自動供給する機能を、公開文書・npm package・この端末の常駐実体まで一貫して届ける。

## 対象

- 英日README、CHANGELOG、製品思想、公開contract、Gantt設計仕様、文書案内を現行実装へ揃える。
- package versionを`0.38.0`へ上げ、配布物にtask notes実装とCLIが含まれることを検査する。
- `main`をpushし、そのcommitが`origin/main`の祖先になった後だけnpm publishする。
- 公開版をversion pinでglobal installし、bridge／dashboard常駐実体を再起動する。
- CLI、ローカルbridge、公開dashboardをsmokeし、結果をevidenceへ固定する。

## 工程

- [x] 関連文書とversionを更新する。
- [x] CIとpackage収載検査を通す。
- [x] release commitを`origin/main`へpushし、release commit gateを通す。
- [x] `@quolu/lattice@0.38.0`をnpmへpublishする。
- [x] 公開版をglobal installし、常駐実体を載せ替える。
- [x] CLI／ローカル／公開面をsmokeし、受入証拠を記録する。

## 受入条件

- `todo show`と成功する`todo start`が、note本文、来歴、訂正状態、head、overflow、全履歴導線を自動返却する。
- ローカルGanttの個別ToDo詳細だけが作業記録を表示し、公開serve／dashboardはnote本文を含まない。
- `npm run ci`と`npm pack --dry-run`が成功し、公開対象commitが`origin/main`の祖先である。
- npm registryとglobal CLIがともに`0.38.0`を返す。
- LaunchAgentのbridgeを再起動し、ローカルbridgeと`https://lattice.kitepon.dev/`が応答する。

## 非目標

task notes以外の新機能追加、Cloudflare tunnel設定変更、過去の履歴文書の書換え、stale write lock回復は行わない。
