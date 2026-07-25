# ADR 0126 — 決定論的scripted adapter controllerを配布する

- Status: Accepted
- Date: 2026-07-25
- Extends: [ADR 0125](0125-public-runtime-adapter-registry-cli.md)
  （公開adapter registry）
- Preserves: [ADR 0064](0064-runtime-hold-public-bridge.md)
  （managed supervisor、controller protocol、中央write gate）

## Context

0.12.24で`lattice run adapter register`を公開しても、npm配布物には
`lattice.adapter_controller_bootstrap.v1`を受けてcontroller socketをlistenするprocessが無かった。
そのため公開CLIは`ADAPTER_NOT_REGISTERED`を越えるが、controller endpoint不在で停止した。

さらに現物を再読すると、controller protocolの`observe` responseはterminal receipt本文ではなく
`payload_digest`だけを持つ。managed daemonにはepoch 1のready frontierをcontrollerへrouteする入口も無く、
controller binaryだけを追加しても`run activate`後の実dispatchとreceipt受理は発生しない。
validatorへreceipt fieldを足す変更は既存wireを破壊し、controllerがrun eventを直接書く変更はsupervisor所有境界を
破壊する。

## Decision

1. `bin/lattice-scripted-adapter.mjs`をnpm bin
   `lattice-scripted-adapter`として配布する。実装本体は
   `src/runtime-scripted-adapter-controller.mjs`に置く。
2. host binary起動では既存の実行image再観測を維持する。Node scriptを登録する公開入力は
   `binary_path`を現在のNode executable、`argv`の先頭を配布された
   `bin/lattice-scripted-adapter.mjs`とする。shebang scriptをnative executableとして偽装しない。
3. controllerはfd 3からbootstrapをJSON 1 documentとして読み、run／session nonce／固定relative socket ref／
   bootstrap self digestを照合する。handshake responseのdescriptor、capabilities、heartbeat、
   process start identity、nonce digest、全自己digestは既存validatorのexact contractに従う。
4. controllerは`dispatch, observe, inventory, barrier, rebind, prepare, activate, release, revoke`の
   closed setだけを受理し、各requestを`validateControllerRequest`へ通す。未知schema、余剰field、
   registration差替え、packet／lease／gateの帰属不一致は
   `lattice.scripted_adapter_error.v1`としてtypedに失敗し、connectionを閉じる。成功responseは
   `validateControllerResponse`が受理できるexact documentだけとする。
5. `prepare`はstaged leaseとpacketを保持するだけで作業を開始しない。`release`で既存
   `armStagedWriteLease`を使いarmed v2へ遷移し、`dispatch`直前に
   `supervisor/write-gate.json`を再読してrun／epoch／generation／barrier／lease集合を照合する。
6. scripted作業はpacketの`scope.writes`に列挙された昇順一意pathだけを対象とする。repo外、
   `.git`／`.lattice`、symlink祖先、非regular targetを拒否する。各pathへpacket digest、
   context content digest、TODO、pathだけから作るcanonical JSONを書き、base treeに存在したpathを
   `modified`、存在しなかったpathを`added`としてreceiptへ記録する。receiptのhandle、worktree ID、
   checkpoint、本文、自己digestは時刻・乱数を含まず、同じpacketとbase treeから同じbytesになる。
7. terminal receipt本文は
   `controllers/<controller-id>/receipts/<payload-digest>.json`へ0600のcanonical regular fileとして
   永続化する。`observe.payload_digest`はその本文のartifact digestである。supervisorだけが固定pathを
   再読し、canonical bytes、`validateExecutorReceipt`、artifact digestを再検証してruntime engineへ渡す。
   controllerはrun eventを直接変更しない。
8. epoch 1で配布scripted controllerのbinをlaunch argvへ明示したmanaged runだけを、
   activation commit後にsupervisorが駆動する。ready frontierごとにbarrier、staged lease発行、
   prepare、全controller ready、release barrier、中央gate commitを行い、その後だけ既存runtime
   engineを介してdispatch、terminal observe、receipt adjudicationを行う。dispatch eventにはcontroller
   registration、controller session nonce、write lease、Direct OS observation bindingを追加する。
   同じ`adapter_kind`を名乗る任意controller、他adapter、read-only CLIへこの経路を暗黙適用しない。
9. controller directoryは0700、socketとreceiptは0600に固定する。AF_UNIX path長へ一時repoのabsolute
   prefixを混入させないため、listenと接続にはbootstrapの固定relative socket refを使う。
10. controller IDとsession nonceだけは起動sessionの一意性に必要な乱数を使う。receiptとwrite bytesへ
    wall-clock、request ID、controller ID、session nonce、乱数を混入させない。

## Consequences

- npm配布物と公開CLIだけで、cleanな隔離Git repoの`run activate`から実write、terminal receipt再読、
  `receipt_accepted`、`run close`まで到達する。
- protocol validatorは変更しない。本文をdigestだけのwireへ無理に埋めず、固定sidecarをsupervisorが
  再検証するため、controller自己申告だけでreceiptを受理しない。
- scripted作業はcodeとして意味のある編集を生成するadapterではない。protocol、gate、dispatch、
  receipt受理を決定論的に実測する参照実装である。
- supervisor起動失敗時はcontroller stderr末尾をboundedに診断へ含める。失敗を
  `controller exited`だけへ丸めず、typed controller codeを公開CLIの失敗理由まで運ぶ。

## 非目標

- 初回駆動を第三者controllerへ広げない。Decision 8のgateは配布binをlaunch argvへ
  明示したmanaged runだけに効く。**これは能力の出し惜しみではなく、実dispatchの所有者は
  hostであるという製品契約（`hostがagent生成と実dispatchを所有する`）の維持である。**
  同梱の参照実装だけは、公開CLIだけでE2Eが成立するよう自動で駆動する。
  ただしfile名で中核挙動を分岐させる形は恒久設計として弱い。**正しい形は
  `lattice.runtime_adapter_capabilities.v2`でcontrollerが初回駆動の受入を宣言し、
  supervisorが宣言だけを見て判断することである。** v1はexact key・全boolean固定のため
  in-place拡張できず（ADR 0044）、schema versionを上げる別裁定を要する。本ADRでは採らない。
- `isolated-worktree`又は`actual-agent`をscriptedへfallbackさせない。
- controller protocolのerror response schemaを一般化しない。
- staged leaseでprocess又はwriteを開始しない。
- random IDやwall-clockをreceiptの決定性へ持ち込まない。
