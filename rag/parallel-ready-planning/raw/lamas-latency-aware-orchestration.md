Learning Latency-Aware Orchestration for Parallel Multi-Agent Systems
XiShi,MengxinZheng,QianLou
UniversityofCentralFlorida
|     | xi320101@ucf.edu, |     |     | mengxin.zheng@ucf.edu, |     |     |     | qian.lou@ucf.edu |     |     |     |
| --- | ----------------- | --- | --- | ---------------------- | --- | --- | --- | ---------------- | --- | --- | --- |
Abstract
|     |     |     |     |     |     | Method |     | ParallelExecution |     | DifficultyAwareness |     |
| --- | --- | --- | --- | --- | --- | ------ | --- | ----------------- | --- | ------------------- | --- |
|     |     |     |     |     |     | AnyMAC |     | Sequential        |     | Query-level         |     |
6202 naJ 51  ]AM.sc[  1v06501.1062:viXra
Multi-agent systems (MAS) enable complex SeqCV Sequential Query-level
reasoningbycoordinatingmultipleagents,but
|     |     |     |     |     |     | EvoAgentX |     | Parallel |     | Task-level |     |
| --- | --- | --- | --- | --- | --- | --------- | --- | -------- | --- | ---------- | --- |
oftenincurhighinferencelatencyduetomulti-
|     |     |     |     |     |     | Aflow |     | Parallel |     | Task-level |     |
| --- | --- | --- | --- | --- | --- | ----- | --- | -------- | --- | ---------- | --- |
stepexecutionandrepeatedmodelinvocations, AgentDropout Sequential Task-level
severelylimitingtheirscalabilityandusability
|                            |     |     |     |                 |     | G-designer |     | Sequential |     | Query-level |     |
| -------------------------- | --- | --- | --- | --------------- | --- | ---------- | --- | ---------- | --- | ----------- | --- |
| intime-sensitivescenarios. |     |     |     | Mostexistingap- |     |            |     |            |     |             |     |
|                            |     |     |     |                 |     | MaAS       |     | Sequential |     | Query-level |     |
proachesprimarilyoptimizetaskperformance LAMaS(Ours) Parallel Query-level
| and inference |     | cost, and | explicitly | or  | implic- |     |     |     |     |     |     |
| ------------- | --- | --------- | ---------- | --- | ------- | --- | --- | --- | --- | --- | --- |
itlyassumesequentialexecution,makingthem Table 1: Comparison of MAS frameworks. Parallel
lessoptimalforcontrollinglatencyunderpar- Executionindicateswhethertheimplementationsup-
| allel | execution. | In this | work, | we investigate |     |     |     |     |     |     |     |
| ----- | ---------- | ------- | ----- | -------------- | --- | --- | --- | --- | --- | --- | --- |
portssimultaneousagentexecutiontoreducewall-clock
thelearning-basedorchestrationofmulti-agent latency(Parallel)orenforcesserializedexecution(Se-
systemswithexplicitlatencysupervisionunder quential). DifficultyAwarenessclassifiesmethodsinto
parallelexecution. WeproposeLatency-Aware Task-level(optimizingastatictopologyfortheentire
Multi-agentSystem(LAMaS),alatency-aware dataset)andQuery-level(dynamicallyadjustingtheex-
| multi-agent |     | orchestration | framework |     | that en- |     |     |     |     |     |     |
| ----------- | --- | ------------- | --------- | --- | -------- | --- | --- | --- | --- | --- | --- |
ecutiongraphforeachspecificinputinstance).
| ables | parallel | execution          | and | explicitly     | opti- |     |     |     |     |     |     |
| ----- | -------- | ------------------ | --- | -------------- | ----- | --- | --- | --- | --- | --- | --- |
| mizes | the      | critical execution |     | path, allowing |       |     |     |     |     |     |     |
thecontrollertoconstructexecutiontopology (Hongetal.,2023)havedemonstratedthatorches-
graphswithlowerlatencyunderparallelexecu-
tratingmultiplespecializedagents—whethercoop-
tion. Ourexperimentsshowthatourapproach
|         |          |             |     |           |      | eratively | or competitively—can |     |     | significantly | sur- |
| ------- | -------- | ----------- | --- | --------- | ---- | --------- | -------------------- | --- | --- | ------------- | ---- |
| reduces | critical | path length |     | by 38–46% | com- |           |                      |     |     |               |      |
passthecapabilitiesofmonolithicmodels.
paredtotheSOTAbaselineformulti-agentar-
|     |     |     |     |     |     | While | pioneering | frameworks |     | established | this |
| --- | --- | --- | --- | --- | --- | ----- | ---------- | ---------- | --- | ----------- | ---- |
chitecturesearchacrossmultiplebenchmarks
whilemaintainingorevenimprovingtaskper- foundation, early MAS approaches were con-
formance, highlighting the importance of ex- strainedbytheirrelianceonlabor-intensivemanual
plicitly optimizing for latency under parallel engineeringforagentprofilingandcommunication
executionwhendesigningefficientmulti-agent
|          |     |         |           |             |     | topologies. | Toaddressthisscalabilitybottleneck, |     |         |         |       |
| -------- | --- | ------- | --------- | ----------- | --- | ----------- | ----------------------------------- | --- | ------- | ------- | ----- |
| systems. | The | code is | available | at https:// |     |             |                                     |     |         |         |       |
|          |     |         |           |             |     | the field   | has progressively                   |     | shifted | towards | auto- |
github.com/xishi404/LAMaS.git.
|     |     |     |     |     |     | mated multi-agent |            | design, | employing     |     | algorithms |
| --- | --- | --- | --- | --- | --- | ----------------- | ---------- | ------- | ------------- | --- | ---------- |
|     |     |     |     |     |     | to search         | foroptimal | agent   | orchestration |     | without    |
1 Introduction
humanintervention.
LargeLanguageModel(LLM)-basedagentshave Crucially, however, this gain in collective in-
achieved remarkable strides in diverse domains, telligence often incurs a substantial cost in terms
rangingfromcollaborativesoftwaredevelopment of inference latency. As systems scale to include
toopen-endedworldexploration(Qianetal.,2024; moreagentsandcomplexinteractionsteps,theac-
Wang et al., 2023). Building upon the success of cumulated response time becomes a prohibitive
individual agents, recent research highlights that bottleneck(Chen et al., 2025). This latency issue
Multi-Agent Systems (MAS) can further extend severely limits the deployment of MAS in time-
cognitiveboundariesthroughdisciplinedcollabo- sensitivescenarios—suchasinteractiveassistants
ration. SeminalworkssuchasCAMEL(Lietal., andreal-timedecision-making—whererapidfeed-
2023),AutoGen(Wuetal.,2024),andMetaGPT back is as essential as reasoning accuracy.(Kang

Figure1: (Left):BuildingblocksforLAMaS;(Right):WorkflowillustrationofLAMaS.Theorchestratorgenerates
alayer-wiseexecutiongraph,whereoperatorswithinthesamelayerexecuteinparallel. Redarrowsindicatethe
criticalexecutionpath.
etal.,2025) ically employ cost penalties (e.g., total token us-
Existingmulti-agentorchestrationframeworks age)oredge-leveldropouttoconstraincomplexity.
|     |     |     |     |     | This explicitly | or implicitly | assumes | that latency |
| --- | --- | --- | --- | --- | --------------- | ------------- | ------- | ------------ |
typicallyfallintooneofthreecategories,eachfac-
ingdistinctlimitationsregardinglatencyandeffi- is driven by the total inference cost (Latency ∝
(cid:80)
| ciency: |     |     |     |     | Cost | ).  |     |     |
| ------- | --- | --- | --- | --- | ---- | --- | --- | --- |
node
|     |     |     |     |     | Crucially, | whilethisassumptioneffectivelyre- |     |     |
| --- | --- | --- | --- | --- | ---------- | --------------------------------- | --- | --- |
Strictly Sequential Orchestration. Recent duces computational overhead, it does not guar-
works,suchasAnyMACandSeqCV(Wangetal., antee latency reduction in parallel environments,
2025a;Yaoetal.,2025),modelagentinteractions wherelatencyisdeterminedbythecriticalexecu-
| aslinearchains. |     | Whilethesemethodsincorporate |     |     |           |                                      |     |     |
| --------------- | --- | ---------------------------- | --- | --- | --------- | ------------------------------------ | --- | --- |
|                 |     |                              |     |     | tionpath. | Withoutexplicitsupervisiononthecrit- |     |     |
per-query awareness to adjust chain length, their icalpath,thesecontrollersmaytendtogenerate
strict sequential nature imposes an inherent “narrow and deep” topologies—minimizing total
constraintonreasoningthroughput. Byenforcing nodecountbutnotnecessarilyreducingexecution
linear dependencies, these approaches limit the depth. Asaresult,thepotentiallatencygainsavail-
potential to fully exploit complex, non-linear ablethrough“wideandshallow”parallelstructures
reasoningpatterns. Thisrestrictionpreventsthem mightremainunder-explored.
| from leveraging |     | a core advantage | of multi-agent |     |     |     |     |     |
| --------------- | --- | ---------------- | -------------- | --- | --- | --- | --- | --- |
systems: decomposing tasks to enable parallel StaticCoarse-grainedParallelism. Approaches
|           |              |                    |               |      | such as Aflow | and EvoAgentX  | (Zhang      | et al.,  |
| --------- | ------------ | ------------------ | ------------- | ---- | ------------- | -------------- | ----------- | -------- |
| execution | (Anthropic,  | 2025).             | Consequently, | they |               |                |             |          |
|           |              |                    |               |      | 2024b; Wang   | et al., 2025b) | incorporate | parallel |
| may be    | less optimal | for time-sensitive | scenarios     |      |               |                |             |          |
whereconcurrentprocessingiscrucialforreducing execution but operate at a coarse-grained, task-
wall-clocklatency. level granularity. They typically optimize a sin-
|     |     |     |     |     | glestatictopologyforanentiredataset. |     |     | Thislack |
| --- | --- | --- | --- | --- | ------------------------------------ | --- | --- | -------- |
DAG-based Architectures with Cost-Centric ofper-querydifficultyawarenessrestrictsflexible
Optimization. Recent frameworks like MaAS, resourceallocation: thesystemmaypotentiallyal-
locateexcessresourcesviacomplexparallelstruc-
| AgentDropout, |     | and G-designer | (Zhang | et al., |     |     |     |     |
| ------------- | --- | -------------- | ------ | ------- | --- | --- | --- | --- |
2025; Wang et al., 2025c; Zhang et al., 2024a) turesfortrivialqueries,whilesimplerstaticgraphs
have evolved to support Directed Acyclic Graph might not provide sufficient reasoning depth for
| (DAG) topologies, |     | theoretically | enabling | paral- | complexinstances. |     |     |     |
| ----------------- | --- | ------------- | -------- | ------ | ----------------- | --- | --- | --- |
lelism. However, we observe that their optimiza- To address these limitations, we propose a
tion objectives generally prioritize resource effi- Latency-AwareMulti-AgentArchitectureSearch
ciencyoverexecutionspeed. Thesemethodstyp- framework that treats inference latency as a first-

class optimization objective. Building upon the MAScandecomposecomplexproblemsintoman-
probabilisticsupernetformulation,weintroducea ageablesubtasks,significantlyextendingthecogni-
novelrewardmechanismthatexplicitlypenalizes tiveboundariesofindividualmodels. Earlyframe-
theCriticalExecutionPath(CP)—thelongestse- works such as CAMEL(Li et al., 2023), Auto-
quenceofdependentagentinteractionsinthecom- Gen(Wu et al., 2024), and MetaGPT(Hong et al.,
putation graph. Unlike previous approaches that 2023) demonstrated the potential of role-playing
optimizeforthesumofallagentcosts,ourmethod andcollaborativeproblem-solving. However,these
assigns learning signals based on the topological pioneering approaches primarily rely on static,
depthofthereasoningprocess. Thisdrivesthecon- hand-crafted topologies or predefined communi-
trollertodiscoverhighlyparallelarchitecturesthat cationprotocols. Suchmanualengineeringisnot
reducelatencywithoutsacrificingreasoningdepth onlylabor-intensivebutalsostrugglestoadaptto
| oraccuracy. |     |     |     |     |     | querieswithvaryingdifficultylevelsanddomains, |     |     |     |     |     |
| ----------- | --- | --- | --- | --- | --- | --------------------------------------------- | --- | --- | --- | --- | --- |
Weevaluateourapproachonthreecomplexrea- limitingtheirscalabilityindiversereal-worldsce-
| soningbenchmarks: |     | GSM8K(Cobbeetal.,2021), |     |     |     | narios. |     |     |     |     |     |
| ----------------- | --- | ----------------------- | --- | --- | --- | ------- | --- | --- | --- | --- | --- |
HumanEval(Chen,2021),andMATH(Hendrycks
et al., 2021). Empirical results demonstrate that AutomatedDesignofAgenticSystems Toover-
ourlatency-supervisedformulationreducesthecrit- cometherigidityofmanualdesigns,theresearch
ical path length by 38.0%–46.1% compared to communityhasshiftedtowardsAutomatedAgen-
MaAS(Zhangetal.,2025),thecurrentstate-of-the- ticSystemDesign(AutomicAgentOptimization).
art for multi-agent architecture search. Crucially, This paradigm treats the agent orchestration pro-
this efficiency gain is achieved with comparable cessasasearchoroptimizationproblem. Recent
orevensuperiortaskperformance. Thesefindings researchinmulti-agentorchestrationhasexplored
establishlatency-awarelearningasavitaldesign variousstrategiestooptimizereasoningstructures.
principle for building efficient, production-ready Sequentialadaptiveframeworks,suchasAnyMAC
| multi-agentsystems. |     |     |     |     |     | andSeqCV(Wangetal.,2025a;Yaoetal.,2025), |     |     |     |     |     |
| ------------------- | --- | --- | --- | --- | --- | ---------------------------------------- | --- | --- | --- | --- | --- |
Ourcontributionsarethreefold: utilizedepthpenaltiesorearlypruningtodynam-
|                       |            |     |                   |             |     | ically adjust   | chain | length         | based  | on query | diffi- |
| --------------------- | ---------- | --- | ----------------- | ----------- | --- | --------------- | ----- | -------------- | ------ | -------- | ------ |
| • ProblemFormulation. |            |     | Weidentifyafunda- |             |     |                 |       |                |        |          |        |
|                       |            |     |                   |             |     | culty; however, |       | their strictly | linear | nature   | inher- |
| mental                | limitation | of  | existing          | multi-agent | or- |                 |       |                |        |          |        |
entlyboundstheirabilitytoleverageparallelexecu-
| chestrationmethods: |     |     | optimizingaccuracyand |     |     |                          |     |     |                        |     |     |
| ------------------- | --- | --- | --------------------- | --- | --- | ------------------------ | --- | --- | ---------------------- | --- | --- |
|                     |     |     |                       |     |     | tionforlatencyreduction. |     |     | Tosupportnon-linearde- |     |     |
costaloneisinsufficienttocontrolexecution
pendencies,approacheslikeMaAS,AgentDropout,
latencyunderparallelexecution.
|           |     |         |        |            |     | and G-designer |     | (Zhang      | et al., | 2025; Wang | et al.,  |
| --------- | --- | ------- | ------ | ---------- | --- | -------------- | --- | ----------- | ------- | ---------- | -------- |
|           |     |         |        |            |     | 2025c; Zhang   | et  | al., 2024a) |         | introduce  | Directed |
| • Method. | We  | propose | LAMaS, | a latency- |     |                |     |             |         |            |          |
aware multi-agent orchestration framework Acyclic Graph (DAG) topologies via early-stop
thatenableslayer-wiseparallelexecutionby orstructuraldropout. Whilethesemethodsallow
|          |             |     |                 |           |        | for complex | structures, |     | they       | typically | prioritize |
| -------- | ----------- | --- | --------------- | --------- | ------ | ----------- | ----------- | --- | ---------- | --------- | ---------- |
| removing | unnecessary |     | execution       | dependen- |        |             |             |     |            |           |            |
|          |             |     |                 |           |        | resource    | efficiency  | by  | penalizing | total     | inference  |
| cies and | learning    | to  | favor execution |           | graphs |             |             |     |            |           |            |
withshortercriticalpaths. cost or node count, which focuses on cumulative
computationratherthanthecriticalexecutionpath,
• Evaluation. Experiments across multiple potentially leaving the latency benefits of paral-
| benchmarks | show | that | LAMaS | reduces | the |           |           |                 |     |             |     |
| ---------- | ---- | ---- | ----- | ------- | --- | --------- | --------- | --------------- | --- | ----------- | --- |
|            |      |      |       |         |     | lel depth | reduction | under-explored. |     | Conversely, |     |
criticalpathlengthby38–46%comparedto
frameworkssuchasAflowandEvoAgentX(Zhang
therepresentativemulti-agentbaselineMaAS, etal.,2024b;Wangetal.,2025b)explicitlyincorpo-
while maintaining or improving task perfor- rateparallelexecutionmechanismsbutoperateata
mance.
|     |     |     |     |     |     | coarse-grained, |     | task-levelgranularity. |     | Thisstatic |     |
| --- | --- | --- | --- | --- | --- | --------------- | --- | ---------------------- | --- | ---------- | --- |
naturelimitstheirflexibility,astheymayallocate
2 Relatedwork
uniformcomputationalresourcesacrossallqueries
LLM-Based Multi-Agent Systems Recent ad- ratherthandynamicallyadjustingcomplexitybased
vancements in Large Language Models (LLMs) onquerydifficulty. Incontrast,ourworkbridges
havecatalyzedthetransitionfromsingle-agentap- thesegapsbyintroducinganorchestrationframe-
plicationstoMulti-AgentSystems(MAS).Byfa- workthatexplicitlyoptimizesthecriticalexecution
cilitatingcollaborationamongspecializedagents, pathwhilemaintainingquery-levelflexibility.

3 Methodology
|     |     |     |     |     |     |     | 3.3 | LatencyModeling |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --------------- | --- | --- | --- | --- | --- |
Undertrueparallelexecution,operatorswithinthe
3.1 DefinitionsandParallelExecution
samelayerhavenodatadependenciesandcanbe
Webrieflyclarifythenotionsofoperators,layers,
|     |     |     |     |     |     |     | executedconcurrently. |     |     | LetLdenotethesetoflay- |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --------------------- | --- | --- | ---------------------- | --- | --- | --- |
and critical execution paths used throughout this ers,andletO denotethesetofoperatorsexecuted
ℓ
| work, following |     | the | definitions | in  | MaAS(Zhang |     | inparallelatlayerℓ. |     |     |     |     |     |     |
| --------------- | --- | --- | ----------- | --- | ---------- | --- | ------------------- | --- | --- | --- | --- | --- | --- |
etal.,2025). Anagenticoperatoristhebasicexe- Theend-to-endlatencyisdeterminedbythecrit-
| cutionunitofamulti-agentsystem. |     |     |     |     | Eachoperator |     |     |     |     |     |     |     |     |
| ------------------------------- | --- | --- | --- | --- | ------------ | --- | --- | --- | --- | --- | --- | --- | --- |
icalpath:
| representsacompositeagentinvocationthatmay   |     |     |     |     |     |     |     |     |     | (cid:88) |     |     |     |
| -------------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | -------- | --- | --- | --- |
|                                              |     |     |     |     |     |     |     |     | T = | maxt(o), |     |     | (1) |
| involvemultipleLLMcallsandexternaltoolusage, |     |     |     |     |     |     |     |     |     | o∈O      | ℓ   |     |     |
ℓ∈L
andistreatedasanatomicnodeduringexecution.
wheret(o)denotestheexecutiontimeofoperator
| We adopt | the | operator | set provided |     | in the | MaAS |     |     |     |     |     |     |     |
| -------- | --- | -------- | ------------ | --- | ------ | ---- | --- | --- | --- | --- | --- | --- | --- |
o.
implementation,withoutmodifyingoperatordefi-
Incontrast,theexecutioncostaccumulatesaddi-
nitionsorinternalbehaviors.
tivelyacrossalloperators:
Operatorsareorganizedintodiscretelayers.
At
| each layer,     | a   | subset    | of operators |     | is selected | by     |     |     |     |          |          |     |     |
| --------------- | --- | --------- | ------------ | --- | ----------- | ------ | --- | --- | --- | -------- | -------- | --- | --- |
|                 |     |           |              |     |             |        |     |     |     | (cid:88) | (cid:88) |     |     |
|                 |     |           |              |     |             |        |     |     | C = |          | c(o),    |     | (2) |
| the controller. |     | To enable | effective    |     | parallel    | execu- |     |     |     |          |          |     |     |
ℓ∈Lo∈O
| tionacrosslayers,weremoveunnecessaryoperator |     |         |        |      |             |     |     |     |     |     | ℓ   |     |     |
| -------------------------------------------- | --- | ------- | ------ | ---- | ----------- | --- | --- | --- | --- | --- | --- | --- | --- |
| dependencies                                 |     | present | in the | MaAS | implementa- |     |     |     |     |     |     |     |     |
wherec(o)measurestokenusageormonetarycost.
| tion. Refinement |     | operators |     | (e.g., | self-refinement |     |     |                  |     |         |      |             |      |
| ---------------- | --- | --------- | --- | ------ | --------------- | --- | --- | ---------------- | --- | ------- | ---- | ----------- | ---- |
|                  |     |           |     |        |                 |     |     | This distinction |     | implies | that | latency and | cost |
andself-consistency)inMaASoftentakeasinput
divergeunderparallelexecution.
theoutputsofotheroperatorswithinthesamelayer,
whichimplicitlyenforcessequentialexecutionand 3.4 ControllerBackbone
| introduces | synchronization |     |     | barriers. | We  | instead |     |     |     |     |     |     |     |
| ---------- | --------------- | --- | --- | --------- | --- | ------- | --- | --- | --- | --- | --- | --- | --- |
FollowingtheformulationinMaAS(Zhangetal.,
| design                   | refinement | operators |                      | to directly | consume    |     |                              |       |           |             |     |               |        |
| ------------------------ | ---------- | --------- | -------------------- | ----------- | ---------- | --- | ---------------------------- | ----- | --------- | ----------- | --- | ------------- | ------ |
|                          |            |           |                      |             |            |     | 2025),                       | we    | model the | multi-agent |     | system        | search |
| the outputs              | from       | the       | previous             | layer,      | decoupling |     |                              |       |           |             |     |               |        |
|                          |            |           |                      |             |            |     |                              |       | agentic   | supernet—a  |     |               |        |
|                          |            |           |                      |             |            |     | space                        | as an |           |             |     | probabilistic | di-    |
| intra-layerdependencies. |            |           | Thischangeeliminates |             |            |     |                              |       |           |             |     |               |        |
|                          |            |           |                      |             |            |     | rectedacyclicgraph(DAG).LetO |       |           |             |     | denotetheset  |        |
artificialsynchronizationconstraintsandallowsop-
|     |     |     |     |     |     |     | ofcandidateagenticoperators. |     |     |     | Thecontrollerfunc- |     |     |
| --- | --- | --- | --- | --- | --- | --- | ---------------------------- | --- | --- | --- | ------------------ | --- | --- |
eratorswithinthesamelayertoexecuteinparallel.
|     |     |     |     |     |     |     | tions | as a | policy network |     | that | sequentially | con- |
| --- | --- | --- | --- | --- | --- | --- | ----- | ---- | -------------- | --- | ---- | ------------ | ---- |
Underthislayer-wiseparallelexecutionsetting,
|     |     |     |     |     |     |     | structstheexecutiontopologyG |     |     |     |     | bysamplingoper- |     |
| --- | --- | --- | --- | --- | --- | --- | ---------------------------- | --- | --- | --- | --- | --------------- | --- |
wedefinethecriticalpathasthesequenceformed
atorslayer-by-layer.
| by the | slowest | operator | at each | layer. | Intuitively, |     |     |     |     |     |     |     |     |
| ------ | ------- | -------- | ------- | ------ | ------------ | --- | --- | --- | --- | --- | --- | --- | --- |
Formally,theprobabilityofgeneratingaspecific
theend-to-endexecutionlatencyisdeterminedby
|     |     |     |     |     |     |     | topologyG |     | isfactorizedautoregressively: |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --------- | --- | ----------------------------- | --- | --- | --- | --- |
themaximumexecutiontimeamongoperatorsin
| eachlayer,accumulatedacrosslayers. |     |     |     |     |     |     |     |     |     | L   |     |     |     |
| ---------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
(cid:89)
|     |     |     |     |     |     |     |     | P (G|x) | =   | π   | (V | | x,G ), | (3) |
| --- | --- | --- | --- | --- | --- | --- | --- | ------- | --- | --- | ---- | ------ | --- |
|     |     |     |     |     |     |     |     | θ       |     | θ   | ℓ    | 1:ℓ−1  |     |
3.2 ProblemSetting
ℓ=1
Weconsideraquery-dependentmulti-agentsystem
|     |     |     |     |     |     |     | wherexistheinputquery,V |     |     |     | ⊆   | O isthesubsetof |     |
| --- | --- | --- | --- | --- | --- | --- | ----------------------- | --- | --- | --- | --- | --------------- | --- |
ℓ
(MAS)thatdynamicallycomposesasetofopera- operatorsselectedatlayerℓ,andG represents
1:ℓ−1
tors to solve an input problem. Given a query x, thehistoryofinstantiatedoperators.
the system constructs a multi-layer computation To enable parallel execution within each layer,
| graph. | At each | layer, | multiple | operators |     | may be |     |     |     |     |     |     |     |
| ------ | ------- | ------ | -------- | --------- | --- | ------ | --- | --- | --- | --- | --- | --- | --- |
thecontrolleremploysathreshold-basedsampling
selected and executed in parallel. Each operator mechanism rather than a simple top-1 selection.
correspondstoacallablemodule(e.g.,generation, Specifically,foreachcandidateoperatoro ∈ O at
| refinement, | verification), |     | typically |     | involving | one |     |     |     |     |     |     |     |
| ----------- | -------------- | --- | --------- | --- | --------- | --- | --- | --- | --- | --- | --- | --- | --- |
layerℓ,thecontrollerpredictsanactivationscore
ormorecallstoalargelanguagemodel(LLM)or s usingaquery-awareMLP.ThesubsetV isde-
|                |     |     |     |     |     |     | o                                           |     |     |     |     |     | ℓ   |
| -------------- | --- | --- | --- | --- | --- | --- | ------------------------------------------- | --- | --- | --- | --- | --- | --- |
| externaltools. |     |     |     |     |     |     | terminedbycollectingoperatorswiththehighest |     |     |     |     |     |     |
Our goal is to learn a controller that optimizes scoresuntiltheircumulativeconfidenceexceedsa
taskaccuracywhilejointlyminimizingexecution
thresholdτ:
costandend-to-endlatencyunderparallelexecu-
(cid:88)
| tion. |     |     |     |     |     |     |     | V = | {o | o ∈ | top-k(O), |     | s > τ}. | (4) |
| ----- | --- | --- | --- | --- | --- | --- | --- | --- | -------- | --------- | --- | ------- | --- |
|       |     |     |     |     |     |     |     | ℓ   |          |           |     | o       |     |

|     |     |     |     |     |     | 4 Experiments |     |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | ------------- | --- | --- | --- | --- | --- | --- |
Thismechanismallowsthearchitecturetodynami-
callyadjustitswidth(parallelism)anddepth(rea-
|                                        |     |     |     |     |       | 4.1 ExperimentalSetup |     |     |                     |     |     |     |
| -------------------------------------- | --- | --- | --- | --- | ----- | --------------------- | --- | --- | ------------------- | --- | --- | --- |
| soningsteps)basedonthequerydifficulty. |     |     |     |     | Ifthe |                       |     |     |                     |     |     |     |
|                                        |     |     |     |     |       | Benchmarks&Tasks.     |     |     | Weevaluateourmethod |     |     |     |
Early-Exitoperatorisselected,thegenerationter-
minatesimmediately(Zhangetal.,2025). onthreebenchmarksspanningtwotaskcategories,
followingthesametrainingandevaluationsplitsas
|     |     |     |     |     |     | MaAS(Zhangetal.,2025). |     |     |     | Forcodegeneration, |     |     |
| --- | --- | --- | --- | --- | --- | ---------------------- | --- | --- | --- | ------------------ | --- | --- |
3.5 RewardDesign
weuseHUMANEVAL,whichmeasuresfunctional
| Foreachquery,thesystemproduces: |         |           |      | ataskscore |        |                              |     |        |          |                 |           |      |
| ------------------------------- | ------- | --------- | ---- | ---------- | ------ | ---------------------------- | --- | ------ | -------- | --------------- | --------- | ---- |
|                                 |         |           |      |            |        | correctness                  | of  | Python | programs |                 | generated | from |
| S ∈ {0,1},                      | a total | execution | cost | C (as      | in the |                              |     |        |          |                 |           |      |
|                                 |         |           |      |            |        | naturallanguagedescriptions. |     |        |          | Formathematical |           |      |
MaAS),alatencyproxyT˜.
|     |     |     |     |     |     | reasoning, | we  | use GSM8K |     | and | MATH, | which |
| --- | --- | --- | --- | --- | --- | ---------- | --- | --------- | --- | --- | ----- | ----- |
Wedefinetheglobalrewardas:
consistofgrade-schoolandcompetition-levelmath
problemsrequiringmulti-stepreasoning.
|     | R = S | −λ C | −λ T, |     | (5) |     |     |     |     |     |     |     |
| --- | ----- | ---- | ----- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
c t
|     |     |     |     |     |     | Baselines. |     | Wecompareourmethodagainstsev- |     |     |     |     |
| --- | --- | --- | --- | --- | --- | ---------- | --- | ----------------------------- | --- | --- | --- | --- |
where λ and λ are weighting coefficients. The eralrepresentativebaselines. MaAS(Zhangetal.,
|     | c t |     |     |     |     |     |     |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
costtermispreservedexactlyasintheMaASob- 2025) serves as the primary baseline, using the
| jective. |     |     |     |     |     | learnedorchestrationpolicywithoutexplicitlymod- |            |          |     |     |              |     |
| -------- | --- | --- | --- | --- | --- | ----------------------------------------------- | ---------- | -------- | --- | --- | ------------ | --- |
|          |     |     |     |     |     | eling or                                        | optimizing | latency. |     | We  | additionally | in- |
3.6 Critical-Path-AwareCreditAssignment cludeseveralfixed-topologystrategies,including
|     |     |     |     |     |     | Generate, | which | directly | produces |     | an  | answer in |
| --- | --- | --- | --- | --- | --- | --------- | ----- | -------- | -------- | --- | --- | --------- |
Applyingthegloballatencypenaltyuniformlyto
alloperatorsintroducesacreditassignmenterror a single step, Gen-CoT(Wei et al., 2022), which
generatesanexplicitchain-of-thoughtbeforepro-
| under parallel | execution. | Only | operators |     | on the |        |           |         |     |               |     |     |
| -------------- | ---------- | ---- | --------- | --- | ------ | ------ | --------- | ------- | --- | ------------- | --- | --- |
|                |            |      |           |     |        | ducing | the final | answer, | and | CoT*5+SC(Wang |     |     |
criticalpathdetermineend-to-endlatency.
etal.,2022),whichrunsmultiplechains-of-thought
Foreachlayerℓ,weidentifythecriticaloperator:
|     |      |              |     |     |     | in parallel  | and | then            | samples | answer |      | with self- |
| --- | ---- | ------------ | --- | --- | --- | ------------ | --- | --------------- | ------- | ------ | ---- | ---------- |
|     |      |              |     |     |     | consistency. |     | These baselines |         | cover  | both | learned    |
|     | o∗ = | argmaxt˜(o), |     |     | (6) |              |     |                 |         |        |      |            |
ℓ
|     |     | o∈O |     |     |     | multi-agent |     | system | orchestration |     | and | heuristic |
| --- | --- | --- | --- | --- | --- | ----------- | --- | ------ | ------------- | --- | --- | --------- |
ℓ
|     |     |     |     |     |     | prompting | strategies |     | with | varying | trade-offs | be- |
| --- | --- | --- | --- | --- | --- | --------- | ---------- | --- | ---- | ------- | ---------- | --- |
wheret˜(o)denotesthelatencyproxyofoperatoro.
tweenaccuracy,cost,andlatency.
Weassignoperator-levelrewardsas:
|      |          |      |            |       |     | EvaluationMetrics          |                                   |                             | Weevaluateallmethodsus- |     |       |     |
| ---- | -------- | ---- | ---------- | ----- | --- | -------------------------- | --------------------------------- | --------------------------- | ----------------------- | --- | ----- | --- |
|      | (cid:40) |      |            |       |     | ingthreemetrics:           |                                   | taskperformance,APIcost,and |                         |     |       |     |
|      | S −λ     | C −λ | T˜, ifo    | = o∗, |     |                            |                                   |                             |                         |     |       |     |
|      |          | c t  |            |       |     |                            |                                   |                             |                         |     |       |     |
| R(o) | =        |      |            | ℓ     | (7) | latency.                   | Fortaskperformance,wereportpass@1 |                             |                         |     |       |     |
|      | S −λ     | c C, | otherwise. |       |     | on HUMANEVAL,andaccuracyon |                                   |                             |                         |     | GSM8K | and |
MATH.APIcostismeasuredasthetotalmonetary
| This | ensures that | latency | penalties | are | applied |          |      |          |     |         |       |      |
| ---- | ------------ | ------- | --------- | --- | ------- | -------- | ---- | -------- | --- | ------- | ----- | ---- |
|      |              |         |           |     |         | cost (in | USD) | incurred | by  | LLM API | calls | when |
onlytobottleneckoperators.
|     |     |     |     |     |     | evaluatingthefulltestset. |        |      |                     | Measuringwall-clock |     |         |
| --- | --- | --- | --- | --- | --- | ------------------------- | ------ | ---- | ------------------- | ------------------- | --- | ------- |
|     |     |     |     |     |     | latency                   | of LLM | APIs | is straightforward, |                     |     | but the |
3.7 LearningObjectiveandNormalization
|     |     |     |     |     |     | resultsvarywidelyinpractice. |     |     |     | Inparticular,under |     |     |
| --- | --- | --- | --- | --- | --- | ---------------------------- | --- | --- | --- | ------------------ | --- | --- |
Thecontrolleristrainedusingpolicygradientop- parallelexecution,latencyisstronglyaffectedby
|             | Letτ                          |     |     |     |     | transientqueuingdelays,ratelimiting,andfluctu- |     |     |     |     |     |     |
| ----------- | ----------------------------- | --- | --- | --- | --- | ---------------------------------------------- | --- | --- | --- | --- | --- | --- |
| timization. | denotethetrajectoryofoperator |     |     |     |     |                                                |     |     |     |     |     |     |
selections. Thelossfunctionis: atingnetworkconditions,whichmakeswall-clock
|     |          |     |     |     |          | latency     | an unreliable |           | signal   | for optimization |              | and |
| --- | -------- | --- | --- | --- | -------- | ----------- | ------------- | --------- | -------- | ---------------- | ------------ | --- |
|     | (cid:34) |     |     |     | (cid:35) |             |               |           |          |                  |              |     |
|     |          |     |     |     |          | comparison. |               | To obtain | a stable | and              | reproducible |     |
−E (cid:88)
| L(θ) | =     | R(o)logπ |     | (o | x) | . (8) |         |          |     |       |               |     |       |
| ---- | ----- | -------- | --- | ------- | ----- | ------- | -------- | --- | ----- | ------------- | --- | ----- |
|      | τ∼π θ |          | θ   |         |       | latency | measure, | we  | adopt | a token-based |     | proxy |
o∈τ
|     |     |     |     |     |     | criticalpathlength(CPlen). |     |     |     | Specifically,wede- |     |     |
| --- | --- | --- | --- | --- | --- | -------------------------- | --- | --- | --- | ------------------ | --- | --- |
finethelatencyproxyT˜
| Toreducevariance,weemployarunningbase-    |          |           |         |     |          |        |     |          | as  |       |      |       |
| ----------------------------------------- | -------- | --------- | ------- | --- | -------- | ------ | --- | -------- | --- | ----- | ---- | ----- |
| lineusingexponentialmovingaverages(EMA)of |          |           |         |     |          |        |     | (cid:88) |     |       |      |       |
|                                           |          |           |         |     |          | CP_len | =   | max(N    |     | (o)+γ | ·t   | (o)), |
|                                           |          |           |         |     |          |        |     |          | out |       | tool |       |
| the reward                                | mean and | variance. | Rewards |     | are nor- |        |     | o∈O      | ℓ   |       |      |       |
ℓ∈L
| malizedusingEMAstatisticsratherthanper-batch |     |     |     |     |     |     |     |     |     |     |     | (9) |
| -------------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
normalization, which is unstable for small batch where N denotes the number of output tokens
out
| sizes. |     |     |     |     |     | generatedbythelanguagemodel,t |     |     |     |     | denotesthe |     |
| ------ | --- | --- | --- | --- | --- | ----------------------------- | --- | --- | --- | --- | ---------- | --- |
tool

wall-clockexecutiontimeofexternaltools(insec- Comparisonwithfixed-topologybaselines. Ta-
onds),andγisascalingfactor. Here,Ldenotesthe ble 3 further compares LAMaS against several
setoflayersandO denotestheoperatorsexecuted fixed-topology prompting strategies. Single-step
ℓ
at layer ℓ. For each layer, we select the operator orshallowreasoningbaselines,suchasGenerate
thatproducesthelongestoutput(measuredbythe and Gen-CoT, achieve shorter critical paths but
numberofgeneratedtokensplusscaledtoolexecu- consistentlyunderperformintaskaccuracyacross
tion time), and sum this quantity across layers to datasets. Conversely,CoT*5+SCimprovesaccu-
obtainthelengthofthecriticalexecutionpath. racybyaggressivelysamplingmultiplereasoning
|     |     |     |     |     |     | paths, but | incurs | substantially |     | higher | cost | with- |
| --- | --- | --- | --- | --- | --- | ---------- | ------ | ------------- | --- | ------ | ---- | ----- |
Implementation details. We use the closed- out corresponding latency benefits. In contrast,
sourceLLMgpt-4o-mini-0718(OpenAI,2024), LAMaS occupies a more favorable region in the
accuracy–latencyspace,maintainingstrongperfor-
| accessedviaAPIswiththetemperaturesetto1. |     |     |     |     | In  |     |     |     |     |     |     |     |
| ---------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
ourimplementation,thelatencypenaltycoefficient mancewhileavoidingunnecessarilylongcritical
is set to λ = 0.005. Note that this value is nor- paths. Thissuggeststhatlearnedorchestrationen-
t
malizedbyaconstantfactorof50intheobjective ablesmoreeffectiveuseofparallelexecutionthan
fixedheuristics,balancingreasoningdepthandex-
functiontoalignthemagnitudewithotherreward
| terms. | Wesettoolscalingfactorγ |     |     | = 50,mapping |     | ecutionefficiency. |     |     |     |     |     |     |
| ------ | ----------------------- | --- | --- | ------------ | --- | ------------------ | --- | --- | --- | --- | --- | --- |
onesecondoftoolexecutiontimeto50virtualto-
|     |     |     |     |     |     | Accuracy–latency |     |     | trade-off. | To  | further | illus- |
| --- | --- | --- | --- | --- | --- | ---------------- | --- | --- | ---------- | --- | ------- | ------ |
kens. Followingthesameimplementationsettings
|     |     |     |     |     |     | trate how | latency | awareness |     | affects | the | learned |
| --- | --- | --- | --- | --- | --- | --------- | ------- | --------- | --- | ------- | --- | ------- |
asMaAS,thenumberoflayersintheagenticsuper-
|                                       |     |                                  |     |     |        | orchestration, |           | Figure | 2 visualizes |            | the accuracy– |       |
| ------------------------------------- | --- | -------------------------------- | --- | --- | ------ | -------------- | --------- | ------ | ------------ | ---------- | ------------- | ----- |
| netissettoL                           |     | = 4, thecostpenaltycoefficientis |     |     |        |                |           |        |              |            |               |       |
|                                       |     |                                  |     |     |        | latency        | trade-off | on     | HUMANEVAL    |            | by sweeping   |       |
| settoλ                                | =   | 3,thesamplingtimesaresettoK      |     |     | = 4,   |                |           |        |              |            |               |       |
|                                       | c   |                                  |     |     |        | the latency    | weight    |        | λ . As λ     | increases, |               | LAMaS |
| andtheactivationthresholdissettothres |     |                                  |     |     | = 0.3. |                |           |        | t            | t          |               |       |
progressivelyshortensthecriticalexecutionpath,
tracingasmoothtrade-offcurvebetweentaskper-
4.2 ResultAnalysis
|     |     |     |     |     |     | formance | and | latency. | Compared |     | to the | MaAS, |
| --- | --- | --- | --- | --- | --- | -------- | --- | -------- | -------- | --- | ------ | ----- |
LAMaSenablesflexiblecontroloverexecutionla-
| We  | analyze | the experimental |     | results | from three |     |     |     |     |     |     |     |
| --- | ------- | ---------------- | --- | ------- | ---------- | --- | --- | --- | --- | --- | --- | --- |
tencywhilepreservingcompetitiveaccuracy.
| perspectives: |     | comparison | with | the MaAS, | com- |     |     |     |     |     |     |     |
| ------------- | --- | ---------- | ---- | --------- | ---- | --- | --- | --- | --- | --- | --- | --- |
parisonwithfixed-topologybaselines,andtheac-
4.3 AblationAnalysis
| curacy–latency |     | trade-off | under | different | latency |                                             |     |     |     |     |     |     |
| -------------- | --- | --------- | ----- | --------- | ------- | ------------------------------------------- | --- | --- | --- | --- | --- | --- |
| weights.       |     |           |       |           |         | Weexaminewhetherthelatencyreductionachieved |     |     |     |     |     |     |
byLAMaScanbeattributedsolelytoenablingpar-
Comparison with MaAS. Table 2 compares allelexecution,independentoflatency-awareop-
LAMaS with the MaAS under the same agen- timization. To this end, we consider an ablation
tic architecture space, with unnecessary opera- variantthatremovesintra-layeroperatordependen-
tor dependencies removed to allow parallel exe- ciestoallowparallelexecution,butsetsthelatency
cution. Acrossallthreebenchmarks,LAMaScon- weighttozeroduringtraining. Thisvariantthere-
sistentlyachievessubstantialreductionsincritical- foresharesthesameexecutionstructureasLAMaS,
butdoesnotexplicitlyoptimizeforlatency.
pathlength,indicatingsignificantlyshortersequen-
tial dependencies under parallel execution. On TheresultsaresummarizedinTable4. Across
GSM8K, LAMaS reduces the average critical- allthreebenchmarks,removingintra-layerdepen-
path length by 38% while maintaining compara- denciesaloneisinsufficienttoachievethelatency
ble accuracy. On HUMANEVAL, the reduction reductionsobservedinLAMaS.On GSM8K and
exceeds 40%, with only a modest decrease in HUMANEVAL, the variant without latency opti-
pass@1. OnthemorechallengingMATHbench- mizationexhibitssubstantiallylongercritical-path
lengthcomparedtoLAMaS,despiteoperatingun-
mark,LAMaSnearlyhalvesthecritical-pathlength
andslightlyimprovesaccuracyoverMaAS.These der the same parallel execution setting. Notably,
resultsdemonstratethatintroducinglatencyaware- thisvariantalsoincurshighercost,suggestingthat
ness effectively reshapes the learned multi-agent thelearnedorchestrationcontinuestofavordeeper
system toward architectures with shorter critical ormoreredundantexecutionpatternswhenlatency
executionpaths,withoutfundamentallydegrading isnotexplicitlyconsidered.
| taskperformance. |     |     |     |     |     | On the | MATH | benchmark, |     | disabling |     | latency |
| ---------------- | --- | --- | --- | --- | --- | ------ | ---- | ---------- | --- | --------- | --- | ------- |

|     |     | Dataset |     | Method | Score(%)↑ | CPlen↓ | ∆CP(%) |     |     |
| --- | --- | ------- | --- | ------ | --------- | ------ | ------ | --- | --- |
|     |     |         |     | MaAS   | 93.13     | 1474.6 | –      |     |     |
GSM8K
|     |     |     |     | LAMaS | 93.37 | 913.5  | -38.0 |     |     |
| --- | --- | --- | --- | ----- | ----- | ------ | ----- | --- | --- |
|     |     |     |     | MaAS  | 93.00 | 1810.8 | –     |     |     |
HumanEval
|     |     |     |     | LAMaS | 92.11 | 1042.7 | -42.4 |     |     |
| --- | --- | --- | --- | ----- | ----- | ------ | ----- | --- | --- |
|     |     |     |     | MaAS  | 51.23 | 2218.5 | –     |     |     |
MATH
|     |     |     |     | LAMaS | 52.26 | 1195.8 | -46.1 |     |     |
| --- | --- | --- | --- | ----- | ----- | ------ | ----- | --- | --- |
Table2: ComparisonbetweenLAMaSandtheMaAS.∆CPdenotestherelativereductioninaveragecritical-path
lengthwithrespecttoMaAS.CPlenmeasurethesumofoutputlengthofalloperatorsonthecriticalpathandserve
asalatencyproxy.
Dataset Method Score(%)↑ Cost↓ CPlen↓ Method Score(%)↑ Cost↓ CPlen↓
|           | LAMaS      | 93.37               | 0.88 | 913.5     |     |                        |       |                  |             |
| --------- | ---------- | ------------------- | ---- | --------- | --- | ---------------------- | ----- | ---------------- | ----------- |
|           |            |                     |      |           |     | LAMaS                  | 92.11 | 0.10             | 1042.7      |
|           | Generate   | 92.80               | 0.31 | 405.2     |     |                        |       |                  |             |
|           |            |                     |      |           |     | w/oCPCredit            | 91.60 | 0.12             | 1197.5      |
| GSM8K     | Gen-CoT    | 92.23               | 0.32 | 345.8     |     |                        |       |                  |             |
|           | CoT*5+SC   | 92.99               | 1.96 | 488.3     |     |                        |       |                  |             |
|           |            |                     |      |           |     | Table 5: Ablation      | study | on critical-path | (CP) credit |
|           | MaAS       | 93.13               | 0.56 | 1474.6    |     |                        |       |                  |             |
|           | LAMaS      | 92.11               | 0.10 | 1042.7    |     | assignmentonHumanEval. |       |                  |             |
|           | Generate   | 88.55               | 0.07 | 797.9     |     |                        |       |                  |             |
| HumanEval | Gen-CoT    | 90.08               | 0.07 | 734.5     |     |                        |       |                  |             |
|           | CoT*5+SC   | 90.84               | 0.37 | 952.5     |     |                        |       |                  |             |
|           | MaAS       | 93.00               | 0.08 | 1810.8    |     |                        |       |                  |             |
|           | LAMaS      | 52.26               | 0.99 | 1195.8    |     |                        |       |                  |             |
|           | Generate   | 50.00               | 0.32 | 1030.4    |     |                        |       |                  |             |
| MATH      | Gen-CoT    | 47.74               | 0.33 | 989.3     |     |                        |       |                  |             |
|           | CoT*5+SC   | 50.35               | 2.05 | 1220.6    |     |                        |       |                  |             |
|           | MaAS       | 51.23               | 0.37 | 2218.5    |     |                        |       |                  |             |
| Table 3:  | Comparison | with fixed-topology |      | baselines |     |                        |       |                  |             |
acrossthreebenchmarks.
| Dataset | Method | Score(%)↑ | Cost↓ | CPlen↓ |     |     |     |     |     |
| ------- | ------ | --------- | ----- | ------ | --- | --- | --- | --- | --- |
|         | LAMaS  | 93.37     | 0.88  | 913.5  |     |     |     |     |     |
GSM8K
|     | w/olatency | 92.92 | 1.73 | 1215.9 |     |     |     |     |     |
| --- | ---------- | ----- | ---- | ------ | --- | --- | --- | --- | --- |
|     | LAMaS      | 92.11 | 0.10 | 1042.7 |     |     |     |     |     |
HumanEval
|     | w/olatency | 91.60 | 0.21 | 1629.3 |     |                            |     |           |               |
| --- | ---------- | ----- | ---- | ------ | --- | -------------------------- | --- | --------- | ------------- |
|     |            |       |      |        |     | Figure 2: Accuracy–latency |     | trade-off | on HumanEval. |
|     | LAMaS      | 52.26 | 0.99 | 1195.8 |     |                            |     |           |               |
MATH
w/olatency 48.97 0.45 1342.1 Markersizeindicatesaveragecost. Bluepointscorre-
spondtoLAMaSunderdifferentlatencypenaltycoeffi-
cientλ
| Table 4:            | Ablation | results comparing | without | latency- |     | t   |     |     |     |
| ------------------- | -------- | ----------------- | ------- | -------- | --- | --- | --- | --- | --- |
| awareoptimization(λ |          | =0).              |         |          |     |     |     |     |     |
t
ponentbyapplyingthelatencypenaltyuniformly
optimizationleadstobothdegradedaccuracyand toalloperatorsleadstoworselatencyandperfor-
longer critical paths. While this variant reduces mancecomparedtoLAMaS,indicatingthatcritical-
cost,itfailstoachievefavorabletrade-offsbetween path-awarecreditassignmentprovidesadditional
| performance | and | latency, indicating | that | parallel |     | benefits. |     |     |     |
| ----------- | --- | ------------------- | ---- | -------- | --- | --------- | --- | --- | --- |
executionalonedoesnotguidethelearnedpolicy
|     |     |     |     |     |     | 4.4 CaseStudy |     |     |     |
| --- | --- | --- | --- | --- | --- | ------------- | --- | --- | --- |
towardefficientorchestration.
Overall,theseresultsshowthatenablingparal- WepresentacasestudytoillustratehowLAMaS
lelexecutionisinsufficientforreducinglatencyin differsfromtheoriginalMaASinexecutionbehav-
learned multi-agent systems. Explicitly incorpo- iorunderthesameinput.
rating latency awareness during training plays a Figure 3 compares the layer-wise execution
criticalroleinshapingthelearnedorchestrationto-
structuresofMaASandLAMaS.InMaAS(Zhang
wardshortercriticalpathsunderparallelexecution. et al., 2025), operators within each layer are exe-
We additionally ablate the critical-path credit cutedsequentiallyduetointra-layerdependencies.
assignment on HumanEval. Removing this com- Incontrast,LAMaSexecutesmultipleoperatorsin

andlatencybehaviorunderparallelexecutionmore
carefully,beyondtraditionalaccuracy-centricand
cost-centricoptimization.
Limitations
|     |     |     |     |     |     | Real-world | latency | is     | influenced | by    | system  | and   |
| --- | --- | --- | --- | --- | --- | ---------- | ------- | ------ | ---------- | ----- | ------- | ----- |
|     |     |     |     |     |     | hardware   | factors | beyond | the        | scope | of this | work. |
Wefocusonlearninglatency-efficientorchestration
atthealgorithmiclevel,leavingtheintegrationwith
system-leveloptimizationstofuturework.
References
Figure3: Casestudy. Redarrowshighlightthecritical Anthropic.2025. Howwebuiltourmulti-agentresearch
executionpath,formedbytheslowestoperatorateach
|     |     |     |     |     |     | system. | Accessed: | 2026-01-06. |     |     |     |     |
| --- | --- | --- | --- | --- | --- | ------- | --------- | ----------- | --- | --- | --- | --- |
layer.
JinyuanChen,JiuchenShi,QuanChen,andMinyiGuo.
|     |     |     |     |     |     | 2025. | Kairos: | Low-latencymulti-agentservingwith |     |     |     |     |
| --- | --- | --- | --- | --- | --- | ----- | ------- | --------------------------------- | --- | --- | --- | --- |
parallelwithinthesamelayer,enablingbroaderex- sharedllmsandexcessiveloadsinthepubliccloud.
arXivpreprintarXiv:2508.06948.
plorationwithoutintroducingadditionalsequential
dependencies.
|     |     |     |     |     |     | MarkChen.2021. |     | Evaluatinglargelanguagemodels |     |     |     |     |
| --- | --- | --- | --- | --- | --- | -------------- | --- | ----------------------------- | --- | --- | --- | --- |
As a result, LAMaS concentrates exploration trainedoncode. arXivpreprintarXiv:2107.03374.
| within fewer | layers | while | maintaining | a   | shorter |             |        |           |     |          |           |     |
| ------------ | ------ | ----- | ----------- | --- | ------- | ----------- | ------ | --------- | --- | -------- | --------- | --- |
|              |        |       |             |     |         | Karl Cobbe, | Vineet | Kosaraju, |     | Mohammad | Bavarian, |     |
criticalexecutionpath.
MarkChen,HeewooJun,LukaszKaiser,Matthias
|     |     |     |     |     |     | Plappert, | Jerry | Tworek, | Jacob | Hilton, | Reiichiro |     |
| --- | --- | --- | --- | --- | --- | --------- | ----- | ------- | ----- | ------- | --------- | --- |
5 Conclusion
|            |         |             |               |     |     | Nakano,  | and  | 1 others. | 2021.     | Training | verifiers |     |
| ---------- | ------- | ----------- | ------------- | --- | --- | -------- | ---- | --------- | --------- | -------- | --------- | --- |
|            |         |             |               |     |     | to solve | math | word      | problems. | arXiv    | preprint  |     |
| This paper | studies | multi-agent | orchestration |     | un- |          |      |           |           |          |           |     |
arXiv:2110.14168.
| der parallel | execution, | where | execution |     | latency |     |     |     |     |     |     |     |
| ------------ | ---------- | ----- | --------- | --- | ------- | --- | --- | --- | --- | --- | --- | --- |
becomes a critical factor that cannot be reliably DanHendrycks,CollinBurns,SauravKadavath,Akul
Arora,StevenBasart,EricTang,DawnSong,andJa-
controlledbyoptimizingaccuracyandcostalone.
|                                           |          |             |         |     |       | cobSteinhardt.2021. |     |          | Measuringmathematicalprob- |       |          |     |
| ----------------------------------------- | -------- | ----------- | ------- | --- | ----- | ------------------- | --- | -------- | -------------------------- | ----- | -------- | --- |
| While many                                | existing | multi-agent | systems |     | focus |                     |     |          |                            |       |          |     |
|                                           |          |             |         |     |       | lem solving         |     | with the | math dataset.              | arXiv | preprint |     |
| onimprovingtaskperformanceorreducingtoken |          |             |         |     |       | arXiv:2103.03874.   |     |          |                            |       |          |     |
usage,theyoftenimplicitlyassumesequentialexe-
SiruiHong,MingchenZhuge,JonathanChen,Xiawu
cutionandoverlooklatencybehaviorunderparallel
Zheng,YuhengCheng,JinlinWang,CeyaoZhang,
execution.
|     |     |     |     |     |     | Zili Wang, | Steven | Ka  | Shing | Yau, Zijuan | Lin, | and |
| --- | --- | --- | --- | --- | --- | ---------- | ------ | --- | ----- | ----------- | ---- | --- |
Weenablelayer-wiseparallelexecutioninproba-
|     |     |     |     |     |     | 1others.2023. |     | Metagpt: | Metaprogrammingfora |     |     |     |
| --- | --- | --- | --- | --- | --- | ------------- | --- | -------- | ------------------- | --- | --- | --- |
bilisticagenticsupernetsbyremovingunnecessary multi-agentcollaborativeframework. InTheTwelfth
|           |              |     |             |          |     | International |     | Conference | on  | Learning | Representa- |     |
| --------- | ------------ | --- | ----------- | -------- | --- | ------------- | --- | ---------- | --- | -------- | ----------- | --- |
| execution | dependencies | and | introducing | latency- |     |               |     |            |     |          |             |     |
tions.
| aware training | to guide | the | learned | orchestration. |     |     |     |     |     |     |     |     |
| -------------- | -------- | --- | ------- | -------------- | --- | --- | --- | --- | --- | --- | --- | --- |
Under this setting, the system learns to shorten HaoKang,QingruZhang,HanCai,WeiyuanXu,Tushar
the critical execution path during parallel execu- Krishna, Yilun Du, and Tsachy Weissman. 2025.
|     |     |     |     |     |     | Win fast | or  | lose slow: | Balancing | speed | and | accu- |
| --- | --- | --- | --- | --- | --- | -------- | --- | ---------- | --------- | ----- | --- | ----- |
tionwithoutsubstantialdegradationintaskperfor-
|     |     |     |     |     |     | racy in | latency-sensitive |     | decisions | of  | llms. | arXiv |
| --- | --- | --- | --- | --- | --- | ------- | ----------------- | --- | --------- | --- | ----- | ----- |
mance.
preprintarXiv:2505.19481.
Ourexperimentalresultsshowthatwhentrain-
|                |          |      |          |     |       | Guohao      | Li, Hasan | Hammoud,    |         | Hani  | Itani, Dmitrii |        |
| -------------- | -------- | ---- | -------- | --- | ----- | ----------- | --------- | ----------- | ------- | ----- | -------------- | ------ |
| ing objectives | consider | only | accuracy | and | cost, |             |           |             |         |       |                |        |
|                |          |      |          |     |       | Khizbullin, |           | and Bernard | Ghanem. | 2023. |                | Camel: |
learnedmulti-agentsystemsdonotautomatically
|                                        |     |     |     |     |         | Communicative              |     | agents | for" | mind" exploration |     | of  |
| -------------------------------------- | --- | --- | --- | --- | ------- | -------------------------- | --- | ------ | ---- | ----------------- | --- | --- |
| minimizelatencyunderparallelexecution. |     |     |     |     | Explic- |                            |     |        |      |                   |     |     |
|                                        |     |     |     |     |         | largelanguagemodelsociety. |     |        |      | AdvancesinNeural  |     |     |
itlyincorporatinglatencyintothetrainingobjective InformationProcessingSystems,36:51991–52008.
enablesthesystemtoconsistentlyshortenthecriti-
|     |     |     |     |     |     | OpenAI.2024. |     | GPT-4omini: | advancingcost-efficient |     |     |     |
| --- | --- | --- | --- | --- | --- | ------------ | --- | ----------- | ----------------------- | --- | --- | --- |
calexecutionpathacrossmultiplebenchmarks.
|     |     |     |     |     |     | intelligence. |     | https://openai.com/index/ |     |     |     |     |
| --- | --- | --- | --- | --- | --- | ------------- | --- | ------------------------- | --- | --- | --- | --- |
Wehopethisworkencouragesfutureresearchon
gpt-4o-mini-advancing-cost-efficient-intelligence/.
multi-agentsystemstoconsiderexecutionstructure Accessed: 2026-01-06.

ChenQian,WeiLiu,HongzhangLiu,NuoChen,Yufan Architecting multi-agent communication topolo-
Dang,JiahaoLi,ChengYang,WeizeChen,Yusheng gies via graph neural networks. arXiv preprint
| Su,XinCong,and1others.2024.             |     |     |     | Chatdev: |     | Com-   | arXiv:2410.11782. |     |     |     |     |     |     |
| --------------------------------------- | --- | --- | --- | -------- | --- | ------ | ----------------- | --- | --- | --- | --- | --- | --- |
| municativeagentsforsoftwaredevelopment. |     |     |     |          |     | InPro- |                   |     |     |     |     |     |     |
JiayiZhang,JinyuXiang,ZhaoyangYu,FengweiTeng,
ceedingsofthe62ndAnnualMeetingoftheAssocia-
XionghuiChen,JiaqiChen,MingchenZhuge,Xin
| tionforComputationalLinguistics(Volume1: |     |     |     |     |     | Long |     |     |     |     |     |     |     |
| ---------------------------------------- | --- | --- | --- | --- | --- | ---- | --- | --- | --- | --- | --- | --- | --- |
Cheng,SiruiHong,JinlinWang,and1others.2024b.
Papers),pages15174–15186.
|     |     |     |     |     |     |     | Aflow: | Automating | agentic | workflow |     | generation. |     |
| --- | --- | --- | --- | --- | --- | --- | ------ | ---------- | ------- | -------- | --- | ----------- | --- |
Guanzhi Wang, Yuqi Xie, Yunfan Jiang, Ajay Man- arXivpreprintarXiv:2410.10762.
| dlekar,                               | Chaowei | Xiao, | Yuke     | Zhu, Linxi | Fan,         | and   |               |          |          |     |             |     |     |
| ------------------------------------- | ------- | ----- | -------- | ---------- | ------------ | ----- | ------------- | -------- | -------- | --- | ----------- | --- | --- |
|                                       |         |       |          |            |              |       | A Operatorset |          |          |     |             |     |     |
| AnimaAnandkumar.2023.                 |         |       | Voyager: |            | Anopen-ended |       |               |          |          |     |             |     |     |
| embodiedagentwithlargelanguagemodels. |         |       |          |            |              | arXiv |               |          |          |     |             |     |     |
|                                       |         |       |          |            |              |       | We adopt      | the same | operator | set | implemented |     | in  |
preprintarXiv:2305.16291.
|     |     |     |     |     |     |     | the MaAS | codebase(Zhang |     | et  | al., 2025) | without |     |
| --- | --- | --- | --- | --- | --- | --- | -------- | -------------- | --- | --- | ---------- | ------- | --- |
SongWang,ZhenTan,ZihanChen,ShuangZhou,Tian- modification. Eachoperatorcorrespondstoapre-
longChen,andJundongLi.2025a. Anymac:Cascad- defined reasoning or execution primitive used to
ingflexiblemulti-agentcollaborationvianext-agent
|             |                                |     |     |     |     |     | constructexecutiongraphs. |     |     | Webrieflysummarize |     |     |     |
| ----------- | ------------------------------ | --- | --- | --- | --- | --- | ------------------------- | --- | --- | ------------------ | --- | --- | --- |
| prediction. | arXivpreprintarXiv:2506.17784. |     |     |     |     |     |                           |     |     |                    |     |     |     |
theirfunctionalitybelowforcompleteness.
XuezhiWang,JasonWei,DaleSchuurmans,QuocLe,
|     |     |     |     |     |     |     | • Generate. |     | Abasicgeneratorthatdirectlypro- |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ----------- | --- | ------------------------------- | --- | --- | --- | --- |
EdChi,SharanNarang,AakankshaChowdhery,and
ducestextorcodewithoutadditionalreason-
| DennyZhou.2022. |     | Self-consistencyimproveschain |     |     |     |     |     |     |     |     |     |     |     |
| --------------- | --- | ----------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
of thought reasoning in language models. arXiv ing or post-processing. It invokes the LLM
preprintarXiv:2203.11171. onceandisprimarilyusedforsimplegenera-
tiontasks.
| Yingxu Wang,                 | Siwei      | Liu, | Jinyuan              | Fang,           | and | Zaiqiao |                |     |     |                  |     |         |     |
| ---------------------------- | ---------- | ---- | -------------------- | --------------- | --- | ------- | -------------- | --- | --- | ---------------- | --- | ------- | --- |
| Meng.2025b.                  | Evoagentx: |      | Anautomatedframework |                 |     |         |                |     |     |                  |     |         |     |
|                              |            |      |                      |                 |     |         | • GenerateCoT. |     | A   | chain-of-thought |     | genera- |     |
| forevolvingagenticworkflows. |            |      |                      | InProceedingsof |     |         |                |     |     |                  |     |         |     |
the2025ConferenceonEmpiricalMethodsinNat- tor that prompts the LLM to perform step-
uralLanguageProcessing: SystemDemonstrations, by-step reasoning. For mathematical tasks
| pages643–655. |       |        |       |       |      |       | (e.g.,    | MATH, | GSM8K),    |       | it includes | explicit |       |
| ------------- | ----- | ------ | ----- | ----- | ---- | ----- | --------- | ----- | ---------- | ----- | ----------- | -------- | ----- |
|               |       |        |       |       |      |       | reasoning |       | exemplars, | while | for         | code     | tasks |
| Zhexuan       | Wang, | Yutong | Wang, | Xuebo | Liu, | Liang |           |       |            |       |             |          |       |
Ding,MiaoZhang,JieLiu,andMinZhang.2025c. (e.g.,HumanEval),ituseslightweightreason-
| Agentdropout: |     | Dynamicagenteliminationfortoken- |     |     |     |     |             |     |                           |     |     |     |     |
| ------------- | --- | -------------------------------- | --- | --- | --- | --- | ----------- | --- | ------------------------- | --- | --- | --- | --- |
|               |     |                                  |     |     |     |     | ingprompts. |     | ThisoperatorinvokestheLLM |     |     |     |     |
efficientandhigh-performancellm-basedmulti-agent
once.
| collaboration. | arXivpreprintarXiv:2503.18891. |     |     |     |     |     |                     |     |     |     |                    |     |     |
| -------------- | ------------------------------ | --- | --- | --- | --- | --- | ------------------- | --- | --- | --- | ------------------ | --- | --- |
|                |                                |     |     |     |     |     | • MultiGenerateCoT. |     |     | A   | diversity-oriented |     |     |
JasonWei,XuezhiWang,DaleSchuurmans,Maarten
CoTgeneratorthatproducesmultiplecandi-
Bosma,FeiXia,EdChi,QuocVLe,DennyZhou,
and1others.2022. Chain-of-thoughtpromptingelic- date solutions in parallel. It generates three
| its reasoning | in  | large | language | models. | Advances |     |     |     |     |     |     |     |     |
| ------------- | --- | ----- | -------- | ------- | -------- | --- | --- | --- | --- | --- | --- | --- | --- |
independentchain-of-thoughtsolutions,yield-
inneuralinformationprocessingsystems,35:24824–
|     |     |     |     |     |     |     | ing a | set of | candidate | responses |     | for | down- |
| --- | --- | --- | --- | --- | --- | --- | ----- | ------ | --------- | --------- | --- | --- | ----- |
24837.
streamaggregation.
| Qingyun | Wu, Gagan  | Bansal, | Jieyu | Zhang,         | Yiran | Wu,    |               |     |                    |     |     |          |     |
| ------- | ---------- | ------- | ----- | -------------- | ----- | ------ | ------------- | --- | ------------------ | --- | --- | -------- | --- |
|         |            |         |       |                |       |        | • ScEnsemble. |     | A self-consistency |     |     | ensemble |     |
| Beibin  | Li, Erkang | Zhu,    | Li    | Jiang, Xiaoyun |       | Zhang, |               |     |                    |     |     |          |     |
ShaokunZhang,JialeLiu,and1others.2024. Au- operator that selects the most consistent an-
togen: Enablingnext-genllmapplicationsviamulti-
|                      |     |     |          |            |     |         | swer | from | multiple | candidate | solutions. |     | All |
| -------------------- | --- | --- | -------- | ---------- | --- | ------- | ---- | ---- | -------- | --------- | ---------- | --- | --- |
| agent conversations. |     |     | In First | Conference |     | on Lan- |      |      |          |           |            |     |     |
candidatesareformattedasdiscreteoptions,
guageModeling.
|     |     |     |     |     |     |     | andthe | LLMis | promptedto |     | selectthe |     | most |
| --- | --- | --- | --- | --- | --- | --- | ------ | ----- | ---------- | --- | --------- | --- | ---- |
YuYao,YiliaoSong,YianXie,MengdanFan,Mingyu
consistentone,followingtheself-consistency
| Guo, and                              | Tongliang | Liu. | 2025. | Can | dependencies |       | principle. |     |     |     |     |     |     |
| ------------------------------------- | --------- | ---- | ----- | --- | ------------ | ----- | ---------- | --- | --- | --- | --- | --- | --- |
| inducedbyllm-agentworkflowsbetrusted? |           |      |       |     |              | InThe |            |     |     |     |     |     |     |
Thirty-ninthAnnualConferenceonNeuralInforma- • SelfRefine. A refinement operator that ana-
tionProcessingSystems.
lyzesanexistingsolutiontoidentifyerrorsor
GuibinZhang,LuyangNiu,JunfengFang,KunWang, suboptimal reasoning and generates an im-
| LeiBai,andXiangWang.2025.        |     |     |     | Multi-agentarchi- |               |     |        |          |      |          |     |         |     |
| -------------------------------- | --- | --- | --- | ----------------- | ------------- | --- | ------ | -------- | ---- | -------- | --- | ------- | --- |
|                                  |     |     |     |                   |               |     | proved | version. | This | operator |     | invokes | the |
| tecturesearchviaagenticsupernet. |     |     |     |                   | arXivpreprint |     |        |          |      |          |     |         |     |
LLMonce.
arXiv:2502.04180.
|     |     |     |     |     |     |     | • EarlyStop. |     | A placeholder |     | operator | that | im- |
| --- | --- | --- | --- | --- | --- | --- | ------------ | --- | ------------- | --- | -------- | ---- | --- |
GuibinZhang,YanweiYue,XiangguoSun,Guancheng
mediatelyterminatestheexecutionworkflow.
| Wan, Miao | Yu, | Junfeng | Fang, | Kun | Wang, | Tian- |     |     |     |     |     |     |     |
| --------- | --- | ------- | ----- | --- | ----- | ----- | --- | --- | --- | --- | --- | --- | --- |
long Chen, and Dawei Cheng. 2024a. G-designer: ItdoesnotinvoketheLLM.

| Task-SpecificOperators. |               |     | FollowingMaAS,we |               |     |
| ----------------------- | ------------- | --- | ---------------- | ------------- | --- |
| also employ             | task-specific |     | operators        | for different |     |
benchmarks.
| • CustomCodeGenerate |     |     | (HumanEval). |     | A   |
| -------------------- | --- | --- | ------------ | --- | --- |
lightweightcodegeneratorthatproducescan-
| didate | code | solutions | without | execution | or  |
| ------ | ---- | --------- | ------- | --------- | --- |
testing.
| • Test(HumanEval). |     |     | Atest-drivenrefinement |     |     |
| ------------------ | --- | --- | ---------------------- | --- | --- |
operatorthatexecutesgeneratedcodeanditer-
ativelyimprovesitbasedonfailurefeedback.
Uponfailure,theoperatorgeneratesarevised
| solution | using | reflective | prompts | and retries |     |
| -------- | ----- | ---------- | ------- | ----------- | --- |
uptothreetimes.
• Programmer(MATH/GSM8K).Acodeex-
| ecution | operator |     | that generates | Python | pro- |
| ------- | -------- | --- | -------------- | ------ | ---- |
grams,executestheminanisolatedenviron-
ment,anditerativelyrefinesthecodebasedon
executionfeedback.
<!-- 出典: https://arxiv.org/pdf/2601.10560 | 取得日: 2026-07-15 | 取得方法: MarkItDown（PDF、bytes確認） | 確度: 中（2026年preprint。critical-path token proxyの著者実験で、実wall-clock評価ではない） -->
