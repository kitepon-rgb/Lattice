# RC1 v3 Phase gate evidence

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v3`
- Control: `lattice-rc1-closed-loop-v3` / Campaign `rc1-g-phase-audit-v3`
- Decision: [ADR 0016](../adr/0016-rc1-v3-phase-gate-rejection.md)
- outcome: `rejected_for_causal_acceptance`

## Gate result

RC1 v3はfull regressionを通過したが、独立反証とCriticが別経路のP1を再現したため、固定fixture内の
`supported_in_fixture`と1-wave dispatchabilityをrejectした。accepted production transformとdigest chainは保持し、
測定器・test boundary・保存preimageを修正するv4へ戻す。

## Full regression

- command: `npm run ci`（Phase Gで1回）
- result: 49 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo
- `npm run check`: green
- wall time: 6.46 s
- HEAD before／after: `88cae03ab2b94e3a8ba9495bb469d7d782d2eff6`
- tracked／untracked porcelain before／after: empty
- ignored-inclusive status digest before／after: `6a8740f181f5981b4c2263745e68e6efa8a9d2819280722f632226879ced622a`
- worktree list digest before／after: `9984d6f2d03acdc394ed1e36d703fa5299bdd21182fce9ed15e8fa7569c127bf`

既存disposable worktree 2件は削除せず、集合不変を確認した。full greenはmechanism regressionの証拠であり、
以下の実験識別性監査の代用にはしていない。

## Independent lanes

| lane | Worker Run | packet digest | routing | workspace |
|---|---|---|---|---|
| Find／independent refutation | `RC1-G-find-refutation-run-01-v3` | `36bcf05e394440b04720fa00e6033fd81a156bf167452a99fb0a37a86f620371` | `refuter` / `gpt-5.6-sol` / high | read-only contract、status差分0 |
| Critic | `RC1-G-critic-run-01-v3` | `fadba20136023b7abe916585554243d93f0a8c2f970ccb5724bb3ece58779968` | `refuter` / `gpt-5.6-sol` / high | read-only contract、status差分0 |

routingのrole／model／effort／developer instructionsは一致した。実効sandboxは親継承の`danger-full-access`であり
role TOMLのread-onlyと不一致だったため、Registryへ`readonly.enforceable=false`を明記し、Task `effect=read`、
`write_scope=[]`、Packet、子promptの4箇所でwriteを禁止した。両laneともtest、formatter、npm script、Codegraph mutationを
実行せず、開始／終了statusは空だった。

## Find → Dedup → Refutation → Critic → parent decision

- Find lane: dedup前7 → lane内dedup後6 → supported 3 / refuted 3 / overall reject
- Critic lane: 9 → supported 3 / refuted 6 / overall reject
- cross-lane入力: 16
- cross-lane dedup後: 11 finding family
- 親裁定: supported 5 / refuted 6

| ID | source finding | severity | parent verdict | evidence／因果経路 |
|---|---|---:|---|---|
| PG-01 | F01 | P1 | supported | `control-compiler`はshared conflictと4 unknownを構成し、`treatment-compiler`はcondition固有seamから別規則で0へする。conditionと測定器が共変。 |
| PG-02 | C01 | P1 | supported | 2 future TODOは同じtest expected objectを変更するが、manifest `tests`はwrite resourceへ入らず、conflict空から1 waveを作る。 |
| PG-03 | F02＋C02 | P1 | supported | control／treatmentのfresh outcomesはaggregate／per-query digestとsummaryだけで、portableまたはsanitized raw payload preimageがない。 |
| PG-04 | F03 | P2 | supported | `hypothesis_result`はnormal verdict／waveとnegative verdict／stateだけを検査し、他の成功条件を落とす。 |
| PG-05 | C03 | P3 | supported（bounded） | HEAD／status／ignored path集合は既存ignored fileのcontent-only mutationを検出しない。今回のfixture実害証拠はない。 |
| PG-06 | F04 | P3 | refuted | inputs、control-v2、transform-v2、compiled-v2の22 canonical digestとpatch SHA／bytesは再計算一致。 |
| PG-07 | C04 | P2 | refuted | plan input、manual evidence、query set、capacity、base、accepted patch digestは固定。測定器差とは別。 |
| PG-08 | F05＋C05＋C08 | P2 | refuted | accepted transform、execution evidence、patch、snapshot、control predecessor、plan v2のdigest chainは成立。 |
| PG-09 | F06＋C09 | P2 | refuted | shared-state negativeはstate conflict 1、`intentional_serial`、2 wavesを保持。test-write omissionは別finding。 |
| PG-10 | C07 | P2 | refuted | old plan、agent context、partial patch、interface assumptionの宣言上の失効は存在。runtime enforcementはRC1 non-goal。 |
| PG-11 | C06 | P2 | refuted with PG-05 exception | 通常成功経路はsensorを削除確認し、worktree／source visible status failureをsuccessへ丸めない。ignored content blind spotだけPG-05へ分離。 |

## Parent reproduction

- `src/control-compiler.mjs`のcontrol manifestはproposed seamごとに2 unknownを追加し、shared production anchor conflictを固定生成する。
- `src/treatment-compiler.mjs`のtreatment manifestはhard-coded seamをownershipへ使い、manual conflictだけからconflictを作る。
- 同compilerの成功predicateは宣言済み成功条件のsubsetしか検査しない。
- `channel-policy`と`label-policy`のoutcomeは、現`test/research-dispatch-record.test.mjs`の同じroutine expected objectを
  `queue→batch`と`:→/`へ別々に変える必要がある。
- control／treatment evidenceとrunner返却はfresh outcome payloadをdigestへ縮約し、artifactだけからpreimageを再構成できない。

この再現はユーザー指定の採用条件である非識別実験、実コード欠陥、一次artifact欠落、具体的安全経路に該当する。
野心、前例、価値、known refactor、read-only縮小、worth_itは裁定へ使っていない。

## Invalidated and retained artifacts

### Active conclusionとして失効

- comparisonの`hypothesis_result=supported_in_fixture`
- normal plan `rc1-treatment-v2`の1-wave dispatchability
- v3 Phase completion候補と、そのagent context／partial patch／interface assumption
- digest-only fresh evidenceを独立再現可能preimageとみなす解釈

### Historical mechanism evidenceとして保持

- accepted transformとraw patch
- behavior verifier receipt、post snapshot、cleanup receipts
- fixed inputとpredecessor digest chain
- shared-state negative control
- plan diffの宣言上のversion barrier
- v3 full CI 49 pass

## Required correction

v4はsingle boundary compiler、test ownershipを含むseam、固定black-box behavior oracle、full portable payloadとsanitized diagnostic
payloadの保存、全成功条件predicate、bounded source invariantを実装し、同じquery setでcontrol／treatmentを再発行する。
v4 correction前にObserver dogfoodへ進まない。

## Writer boundary

Phase監査・full CI・Control記録でLattice外repoへwriteしていない。dotagentsはorchestrate CLI／文書のread-only利用のみ、
Observer関連repoは不使用。remote作成、push、publishは実施していない。
