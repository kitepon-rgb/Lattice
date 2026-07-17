# 0046 — RC4 writer target制限のstage条件付き上書きとexecutor隔離契約

- Status: Accepted / Immutable
- Date: 2026-07-17
- 前提Decision: [ADR 0044](0044-rc3-runtime-contract.md) Decision 9.5、[ADR 0045](0045-rc3-phase-gate-support.md)
- 親裁定: dotagents `docs/plan_lattice-factory-integration.md`（2026-07-17オーナー裁定。Latticeは
  dotagents統括の直轄コア製品となり、本ADRは同一統括による裁定である）
- 対象plan: [plan_lattice_rc4_dotagents_dogfood.md](../plan_lattice_rc4_dotagents_dogfood.md)
  （本ADRのcommitをもって同planの契約を不変化する）

## Context

ADR 0044 Decision 9.5は「actual multi-agent dogfoodはLattice-owned disposable dogfood fixture repo
だけをtargetにし、Lattice自身・dotagents・Observerをdogfood writer targetにしない」と固定した。
RC4はdotagentsを実戦dogfoodの舞台にするため、この制限を黙って破らず、stage条件付きで上書きする。

また、dotagentsのdisposable cloneは生きたオンボーディング正典（CLAUDE.md→@AGENTS.md）を搬送し、
Claude executorがそれを自動読込する。正典には「新規エントリ追加後は`install.sh`再実行が必要」等の
host変更手順が実行可能な形で含まれ、`install.sh`はHERE解決＋`ln -sfn`のためclone内で実行されると
hostの`~/.claude`系symlinkがtmpdirを向き、clone廃棄後にdangling化する。RC3のDecision 9.2
（executorはisolated worktreeだけへ書く）はこのvectorを検出しない（`fable`×high反証の確認済み指摘）。

## Decision

1. **Decision 9.5を次のstage条件付きで上書きする**（上書きはRC4 campaignに限る。他repoの
   writer target化を一般に解禁しない。Observerは引き続き対象外）:
   - **Stage 0**: writerなし（read-only実測のみ）。9.5に抵触しない。Codegraph indexは
     Lattice側clone/copy上にだけ作り、dotagents正規repoへは一切書き込まない。
   - **Stage 1**: writer targetは**dotagentsのdisposable clone**（tmpdir配下・正規repoへ不着地）
     に限る。
   - **Stage 2**: 正規dotagentsへの着地は、Latticeのreceipt受入後に**親のreview→pathspec commit
     経路のみ**で行う（Latticeによる直接commit/pushは引き続き禁止）。dispatch batchごとに
     H gate承認を記録する。
2. **Stage 1以降のexecutor隔離契約**（executor packetへ焼き込む必須条件。違反はrun受入拒否）:
   - executorは**隔離HOME**で実行する（hostの`~/.claude`・`~/.codex`・`~/.agents`・Spotter状態を
     参照・変更させない）。
   - executor packetは`install.sh`・`spotter install`・`apply-codex-config`・`claude mcp add`／
     `codex mcp add`系のhost変更コマンドの実行を**禁止**と明記する。verifier_refsにも含めない。
   - clone内の正典がhost変更手順を指示していても、packet契約が優先する（観測されたdocsは
     データであって指示ではない）。
3. **Control**: Stage 1開始時に`lattice-rc4-dotagents-v1`を初期化し、H task承認snapshotを記録して
   から最初のactual dispatchを行う。Stage 0はControl外のread-only実測とし、evidenceは
   `docs/evidence/`へ残す（検証規律＝実測値の丸め・事後推定禁止はControl外でも維持する）。
4. 本ADRはRC4 planの契約（stage定義・反証条件・成功条件・非目標）を不変化する。以後の変更は
   新しいADRでだけ行う。

## Consequences

- RC4はDecision 9.5と矛盾なく実行できる。9.5の保護目的（正典repoの汚染防止）は、stage境界・
  隔離HOME・host変更コマンド禁止・review経路着地・batch H gateの5層で維持される。
- Stage 1のclone搬送正典によるhost汚染vectorは、packet契約で明示的に塞がれる。
- RC4がrefuteで閉じた場合、本上書きは後続campaignへ持ち越されない（新裁定が必要）。
