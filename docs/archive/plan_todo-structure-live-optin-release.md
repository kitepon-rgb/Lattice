# plan: ToDo構造HEAD観測修理の公開

- Status: Complete
- Lane: 統括（version、remote main、npm、global install、常駐面、公開smokeの多段受入）
- Owner: Codex親
- Started: 2026-08-12
- Implements: [plan_todo-structure-live-optin.md](plan_todo-structure-live-optin.md)
- Approval: [v0.58.1 H承認](../evidence/2026-08-12-v0.58.1-live-optin-release-approval.md)

## 目的

commit済みのToDo構造HEAD観測修理を、同じrelease commitからremote main、npm、Mac global CLI、
Lattice dashboard／bridgeへ届け、Peertable実工程で公開版CLIの判定を確認する。

## 非目標

- Peertable既存WIPのcommit、整理、受理を行わない。
- hub protocolやサーバー配線を変更しない。
- npm unpublish、force push、履歴巻き戻しをrollbackへ使わない。

## 工程

- [x] **lr01 — release candidateを固定する**
  - 恒久承認をAGENTS.mdへ限定付きで正本化する。
  - CHANGELOG、package version、lockfileを0.58.1へ揃える。
  - focused test、`npm run ci`、production dependency audit、pack内容を確認する。
  - `npm run ci`はproduct 1,757／1,757、Sensor、静的・公開面・store gateを含めexit 0。
    root／Sensor production auditは0。packは826 files、SHA-1 `8f7f1965…`。
- [x] **lr02 — 既定ブランチとnpmへ届ける（H）**
  - release commitを`origin/main`へfast-forward pushし、祖先gate通過後だけpublic publishする。
  - 事前packとregistry tarballのSHA-1を照合する。
  - `50f559e472687b4ee726150f3e7ad88941fef81a`を`origin/main`へ着地後、0.58.1をpublic publish。
    registry SHA-1は事前packと一致し、`latest`も0.58.1。
- [x] **lr03 — global installと公開面を実測する（H）**
  - 公開versionをMacへversion pinでglobal installし、dashboard登録とbridgeを再起動する。
  - CLI、bridge heartbeat、公開dashboard、Peertable構造compileをsmokeする。
  - global CLI、dashboard health、bridge runtimeは0.58.1。heartbeat accepted、公開HTTP 200。
    Peertable保存projectionはfresh consistent、一時再現環境のcompileもconsistent／finding 0。
- [x] **lr04 — 証拠と受理Decisionを固定する**
  - 受入matrix、公開操作、rollbackをevidenceへ記録し、不変ADRで受理する。
  - [公開証跡](../evidence/2026-08-12-v0.58.1-live-optin-release.md)と
    [ADR 0170](../adr/0170-v0-58-1-live-optin-release-is-accepted.md)へ固定した。

## 受入条件

1. `origin/main`、npm `latest`、Mac global CLI、常駐bridgeが0.58.1へ揃う。
2. npm事前packとregistry tarballのSHA-1が一致する。
3. 公開dashboardがHTTP 200を返し、bridge heartbeatがaccepted、runtime driftが空である。
4. 公開版CLIによるPeertable `k1`の構造compileが`consistent`、`fresh`、finding 0を返す。
5. 異常時はMacを0.58.0へ戻してdashboard／bridgeを再起動できる。

## 既知の罠

- publish worktreeはuntracked symlinkを含めてもdirty gateで止まる。clean release worktreeを使う。
- node_modulesの参照先を実dir化する時、tree全体へ`cp -L`しない。内部の`.bin/*` symlinkまで展開されて
  相対参照が壊れる。外側symlinkだけ`realpath`で解き、参照先を通常`cp -R`して内部symlinkを保持する。
- `latest`の伝播よりversion pinを優先し、導入物を曖昧にしない。
- status codeだけで配備を受理せず、bridge version／heartbeatと公開HTMLの内容を確認する。
