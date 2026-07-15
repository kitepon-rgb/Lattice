# RC1 native implementation routing

- 実施日: 2026-07-15
- 対象Control: `lattice-rc1-closed-loop-v2`
- native hard／soft inflight limit: 親を含め4。
- 観測時running: 親1。下記2 agentはrouting smoke完了後idle。

## RC1-B Codegraph adapter

- agent path: `/root/rc1_codegraph_adapter`
- role: `implementer`
- model: `gpt-5.6-terra`
- effort: `medium`
- developer instructions: applied
- `verify-codex-agent-routing implementer /root/rc1_codegraph_adapter`: routing-check OK

## RC1-C isolation runner

- agent path: `/root/rc1_isolation_runner`
- role: `implementer`
- model: `gpt-5.6-terra`
- effort: `medium`
- developer instructions: applied
- `verify-codex-agent-routing implementer /root/rc1_isolation_runner`: routing-check OK

## Sandboxと受入境界

両agentの実効sandboxはrole TOMLの`workspace-write`期待に対して`danger-full-access`だった。routing判定はrole、model、
effort、developer instructionsが一致したためOKだが、sandbox差を能力昇格へ読み替えない。

各workerは親が作る別々のdetached worktreeだけを書き、Packetで許可した非交差path以外を編集しない。
branch切替、commit、push、merge、rebase、reset、stash、他者変更のrevert、current Lattice worktreeの編集、
Lattice外repoの編集を禁止する。親がWorker Report、実diff、scope、focused gateを再確認してから採否を裁定する。
