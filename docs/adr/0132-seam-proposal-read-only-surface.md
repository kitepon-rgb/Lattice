# ADR 0132 — 切断候補をread-onlyで提案し、割り当ての不足をunknownとして返す

- Status: Accepted
- Date: 2026-07-26
- Relates: [ADR 0009](0009-rc1-control-boundary-compile-accepted.md)（RC1 boundary compile）・
  [ADR 0032](0032-rc2-bounded-graph-compiler-and-three-way-seam.md)（3-way seamとownership discovery）・
  [ADR 0036](0036-rc2-delivery-policy-witness-and-test-seam.md)（test seamとmanual design witness）・
  [ADR 0127](0127-todo-independence-projection.md)（独立性の記録面）・
  [ADR 0128](0128-todo-independence-operational-wiring.md)（着手時advisoryとseverability）・
  [ADR 0129](0129-gantt-independence-presentation.md)（工程表への独立性投影）・
  [ADR 0130](0130-lattice-describes-its-own-parallelism-surface.md)（案内文言の単一正本）

## Context

[PLAN.md](../../PLAN.md)の五層のうち第4層「Seam transformer」だけが未着地で、
`seam-candidate → code transform → re-analyze → new plan version`という製品の中心的主張が
実物になっていなかった。ADR 0128までで到達していたのは「conflictを検出し、symbol／path起因なら
`code_seam`と分類する」ところまでで、**どこで切るかの情報を製品は一切持っていなかった**。

さらに、その分類の入力自体が欠けていた。`lattice.todo_independence.v2`のconflictは
`{task_ids, resource_id, kind}`だけを持ち、`resource_id`はruntime front-endが合成した
`own-path-<hash>`である。**どのsymbol・どのpathが衝突したのかを記録から復元できない。**

実変換（隔離worktreeでの実行）と実行時hold→`seam_split`のtodoレーン配線は本ADRの非目標であり、
後続campaignが所有する。

## Decision

### 1. conflictはexact targetを保持する（`lattice.todo_independence.v3`）

artifactへ`conflict_resources: [{resource_id, kind, target}]`を新設し、`conflicts`は
`{task_ids, resource_id}`としてそれを参照する。`kind`は辞書側へ一本化する。

targetをconflictへ直書きしない。conflictは最大4,096件、targetは最大4,096 byte、保存上限は1 MiBで、
pair単位の反復は上限を不必要に食う。3 task以上が同一資源を争う場合も辞書は1件で済む。

同一schema名で二つのexact shapeを意味させないため版を上げる。既存validatorは余分fieldを拒否するので、
v2据置きの加算互換は成立しない。

### 2. 旧契約の記録と壊れた記録を区別する

既知の旧independence schemaを名乗り、版をまたいで不変なidentity fieldの型が揃っている記録だけを
legacy markerとして`coverage: superseded`へ落とし、再compileを案内する。旧契約の本体は再検証しない。

schema名だけの壊れた記録は従来どおり`INDEPENDENCE_ARTIFACT_INVALID`でfail closedする。
「壊れている」と「古い」に同じ顔をさせない。案内文言はguidance catalogへ専用codeを持ち、
planの改訂（witness migrationが要る）と契約の陳腐化（再compileだけでよい）に別の次の一歩を返す。

### 3. 提案の単位はconflict componentであり、切断手順は正本にしない（`lattice.seam_proposal.v1`）

提案の単位をconflict pairにしない。ADR 0036のRC2は、4 shared resourcesを3 ToDoが所有する状況
（resource単位のconflict recordは`4 × C(3,2) = 12`件）を**1つの3-way seam**で解いている。
pair単位では表現できない。`boundary_verdict.v1`はToDoをちょうど2件に固定しているため流用もしない。

切断のアルゴリズムを正本にしない。RC1/RC2の実績seamは元entryをcomposition facadeとして残しつつ
内部concernを分解し、shared testも分割している。「移動するsymbol集合」や
`extract_symbol | split_path`のようなenumではこの形が落ちる。正本は**変更前後のsurfaceと
その所有者**とし、変換戦略は下流adapterが選ぶ。

`seam_candidate | intentional_serial | unknown_requires_evidence`のsum typeで全conflictを覆い、
未分類も二重収載も許さない。acceptedでは残余conflictを空に強制し、state／effectを含むcomponentが
seam候補を名乗ることを拒否する。`proposal_id`はsource binding・compiled_at・digestを除いた
semantic keyから決定的に導き、意味identityと内容receiptを分ける。

### 4. 割り当てをcall graphから導出しない

caller／callee／impactのedgeからtask IDを自動付与しない。ADR 0009とADR 0032が明記するとおり、
RC1/RC2のproposed ownershipは**人が設計したmanual design witness**であって機械導出の実績ではない。
構造から正当に列挙できるのはcut skeleton（SCC、callee closure、module frontier、task固有test
frontier）までで、どのconcernがどのToDoのものかは意味判断である。

witnessのtask固有anchorが候補を一意に束縛できない場合は`semantic_owner_binding_missing`等の
typed unknownへ送る。1候補の失敗を`intentional_serial`へ昇格させない——探索の不完備はunknownであり、
`intentional_serial`を名乗れるのは現行契約で切断不能なstate／effect conflictが残ることを
証拠で示した場合だけとする。

これは安全側への逃げではなく、証拠が足りないという事実の報告である（PLAN.md原則5）。

### 5. 競合規則を簡略化せず、sensor evidenceを合成しない

提案後ownershipの検証は、`owns`だけを書き換えて済ませない。共有pathを2つの新pathへ分けても、
両ToDoのwitnessの`writes`に旧pathが残れば`undeclared_write_overlap`で`BOUNDARY_UNKNOWN`になる。
`reads`／`writes`／`resources`／`state_effects`／`affected_tests`まで含む完全なvirtual witnessを
要求し、write×writeのprefix overlap、read×write、bare shared resource、state／effect、
dynamic unknown、query drift、affected-test driftを実装と同じ規則で導出する。
実`compileRuntimePlanV1`との一致は実在surfaceのfixtureでtestに固定する。

存在しないpathへ`ready`のsensor outcomeを合成してcompileを通さない。現行契約ではprovenanceが
`sensor`として出るため、それはhypothetical評価ではなく**sensor evidenceの捏造**である。
新surfaceは抽出仮説として分離する。

sensorのsymbol lookupは存在しない要求名を近い別symbolへfuzzy解決しうるので、返却名とpathの
exact一致を要求し、不一致・空結果・operation間のpath不一致はresolvedへ昇格させない。

### 6. 公開面はread-only投影であり、生成と分ける

`todo seam-proposal compile`が実sensorとclean worktreeを要求して記録を生成し、
`todo seam-proposal`はsensorを引かず記録とHEAD照合だけで投影する（`lattice.seam_proposal_projection.v1`）。
independence面と同じく、artifactはplan versionディレクトリへ並置してmanifestへ登録せず、
witness setと記録から再生成できるhost localの投影として扱う。

投影は返す前にvalidatorを通す。記録が無い状態を「競合が無い」「対象なし」と読ませない。
工程表では争っている資源をexact targetで見せ、**なぜ提案できないか**（typed unknownのkindと
対象ToDo）まで読めるようにする。実データではほとんどのcomponentがunknownになる以上、
そこが読めない表示は事実を隠すことになる。

## Consequences

本ADRの範囲では、提案は**構造証拠**であって意味的独立やbehavior preservationの証明ではない。
実変換を行っていないため、提案が実際に並列化を解放するかは未検証である。

初回の実データ実行（[docs/evidence/2026-07-26-seam-proposal-first-real-run.md](../evidence/2026-07-26-seam-proposal-first-real-run.md)）は、
このrepoの実conflict 1件に対して`unknown_requires_evidence`を返した。片方のToDoは宣言した境界の
全部が係争中のfileで、固有anchorを持たないためである。判定は正しいが、**人はToDoのtitleを読めば
分け方を即断できる**。情報は存在するのに、typedな入口が無い。

## Open questions

以下は本ADRでは裁定せず、実データの蓄積後に別途裁定する。

1. **task intent bindingを持つか。** witnessのclosed fieldにはconcern・outcome・case IDが無い。
   typedな`task_intent_binding`を足せば今回のケースは`seam_candidate`へ到達しうるが、宣言の手間が
   増え、「宣言の誠実さが判定の上限」という性質がさらに前面に出る。足さない場合、割り当ては
   RC1/RC2と同じく人がcandidate specで与える運用になる。
2. **複数の非劣位候補をどう持つか。** v1はdecisionあたり`seam_candidate`が単数で、incomparableな
   候補集合を表現できない。当面は該当時にunknownへ落として候補本体を失う。実データで該当ケースが
   出てから`candidate_set`を持つv2を起こす。
3. **`verification`のdigestを契約側で締めるか。** producerは再導出可能な値を入れて照合関数を
   提供するが、契約自体は任意のdigestを受理する。`bounded-seam.mjs`のcaller assertion問題と同型で、
   受け皿を締めるか、検証済みであることを別のtyped fieldで表すかを裁定する必要がある。
4. **新規fileだけを作るToDoの独立性をどう判定するか。** 存在しないpathのownsはsensor unbound／
   path_absentのdynamic unknownになり、graph全体が`BOUNDARY_UNKNOWN`へ落ちる。実測では
   `affected docs/evidence/`が`unresolved`を返し、末尾`/`のprefix形でも束縛されない。新module追加・
   新doc作成・新test追加といった実開発ToDoのかなりの割合が判定対象外になる。AGENTS.mdのbootstrap
   例外は初回scaffoldだけを覆っており、この一般ケースを覆っていない。
