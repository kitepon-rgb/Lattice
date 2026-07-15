# ADR 0016: RC1 v3の因果結論をPhase gateでrejectする

- 状態: Accepted
- 日付: 2026-07-15
- 対象plan: `lattice-research-campaign-1-v3`
- 対象Control: `lattice-rc1-closed-loop-v3` / RC1-G
- supersedes: ADR 0015の`hypothesis_result=supported_in_fixture`とRC1完了候補。transform、artifact identity、version barrierの個別受入は維持する。

## Context

RC1-Fは固定fixtureでproduction seamを作り、同じplan input、manual evidence、query set、capacity、base SHAへbindした
control／treatment artifactを生成した。normalの記録値はwrite conflict `1→0`、unknown `4→0`、minimum feasible waves
`2→1`、negativeはstate conflict 1／2 wavesであった。

Phase Gの独立refuterと独立Criticは、artifact内部整合とは別に、schedulabilityの因果結論を識別できるかを実コードで監査した。
親も該当source、fixture TODO outcome、test、machine artifactを再読した結果、v3の成功判定を維持できない。

## Decision

### 1. v3の因果結論をrejectする

`lattice.rc1.control_treatment_comparison.v1`の`hypothesis_result=supported_in_fixture`をactiveな研究結論として採用しない。
理由は次の独立した欠陥である。

1. controlとtreatmentが別compilerを使い、control側はshared write conflictと4 unknownを構成し、treatment側は
   hard-coded seam ownershipから0 conflict／0 unknownを構成する。compiler選択がconditionと共変し、accepted transformだけの
   効果を識別できない。
2. 両future TODOはproduction moduleだけでなく、同じcharacterization testの同じexpected objectも変更する。v3 manifestは
   affected testを実行対象として列挙するだけでwrite boundaryへ含めず、実patchの競合を落として1 waveを生成した。
3. fresh Codegraph runはaggregate digestとsummaryだけを保存し、canonical portable outcome payloadまたはsanitized diagnostic
   preimageを保存していない。独立監査者がexact resolutionとportable digestをartifactだけから再計算できない。
4. machine-readableな成功predicateがverdict、wave、negative stateだけを検査し、write conflict、unknown、hard precedence、
   behavior receipt、predecessor、invalidationの破損を取りこぼす。

既存ignored fileのcontent-only mutationをHEAD／status／ignored path集合比較が検出しない点も具体的なbounded safety gapとして
supportedとする。ただし今回のfixture sourceが実際に変更された証拠ではなく、v3の因果反証とは分離する。

### 2. 生き残ったmechanism evidenceを保持する

次はPhase監査で反証されていないため、削除・書換えずv4のpredecessor候補として保持する。

- accepted transform `09ef275af54cf4bc4bbd65e08750be6ab22f7febe4d800b3be16548408a4a30d`とpatch
  `acefad450f77906d21e1712c710c1ed91e199d9607d7c6703e8378abeb1f92af`は、固定behaviorを保ってproduction moduleを分離した。
- plan input、manual evidence、query set、capacity、base SHA、verifier、accepted patchのdigest bindingは一致する。
- shared-state negativeはstate conflictを保持し、path-only判定に対する局所negativeとして有効である。
- transform execution evidence、raw patch、post snapshot、control predecessor、plan diffのdigest chainは成立する。
- old plan、agent context、partial patch、interface assumptionの4種を宣言上失効するversion barrierは成立する。
- full `npm run ci`は49 pass / 0 fail / 0 skip、syntax check greenであり、通常成功経路のsensor／worktree cleanupもgreenである。

これらは「production seam変換機構が動いた」証拠であり、「future TODO全体が1 waveでdispatchable」の証拠へ昇格しない。

### 3. v4 correctionのhard dependency

RC1を完了扱いせず、active planを`lattice-research-campaign-1-v4`へ全再compileする。v4は少なくとも次を直列hard dependencyにする。

1. pre／postを同じ関数・同じ規則で測るsingle boundary compilerを作り、ownership、unknown、conflictをCodegraph portable
   evidence、fixed candidate spec、manual evidenceの同じ演算から導出する。
2. future TODOのtest write ownershipをboundaryへ含める。production seamと同時にtest architectureもconcern別へ分け、共有composition
   verifierはfuture TODOがwriteしないstable contractへする。変換されたtestだけをbehavior oracleにしない。
3. 各fresh runのfull canonical portable outcome payloadとsanitized diagnostic payloadを保存し、aggregate digest、per-query digest、
   compiled artifact setへbindする。絶対path／volatile telemetryはplan identityから分離する。
4. success条件を一項目ずつexact predicateへし、各条件だけを壊すnegative testでfalse supportを拒否する。
5. source invariantのclaimを検査範囲どおりに型付けし、少なくともprotected source／test scope内の既存ignored content driftを検出する。

## Rejected alternatives

- **full CI greenなのでv3をacceptする:** regression consistencyは測定器交絡とTODO boundary欠落を識別しない。
- **testを実行資源だけとして扱う:** outcome変更TODOが同じexpected valueを更新する実patchを無視する。
- **数値だけ正しいのでcausal wordingを弱める:** planの1-wave dispatchability自体がtest write競合で反証されている。
- **v3 artifactを全削除する:** transform binding、negative state、version barrierという反証済みでないmechanism evidenceを失う。
- **Observer dogfoodへ進んで外部妥当性で埋める:**内的妥当性を直す前の外部repo投入は交絡を増やす。

## Consequences

- ADR 0015は当時のRC1-F受入記録としてimmutableに残るが、研究結論は本ADRが上書きする。
- v3 plan、comparison、plan v2、execution evidenceはhistorical artifactとして保持し、active dispatch predecessorにはしない。
- v4 correction完了までObserver dogfoodとdotagents工場統合を開始しない。
- Latticeだけをwriter scopeとし、dotagents／Observer関連repoはread-only、remote作成・push・publishは禁止を維持する。
