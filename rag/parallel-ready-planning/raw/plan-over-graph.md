|     | Plan-over-Graph: |     |     |     | Towards | Parallelable |     | LLM | Agent |     | Schedule |     |     |
| --- | ---------------- | --- | --- | --- | ------- | ------------ | --- | --- | ----- | --- | -------- | --- | --- |
ShiqiZhang1,#,XinbeiMa1,#,ZouyingCao1,ZhuoshengZhang1,HaiZhao1,†
1ShanghaiJiaoTongUniversity
zsq259@sjtu.edu.cn, sjtumaxb@sjtu.edu.cn, zhaohai@cs.sjtu.edu.cn,
Abstract
Task example:
In a busy urban construction project, multiple sites must be coordinated to
LargeLanguageModels(LLMs)havedemon- build the "Core Area" as quickly and cost-effectively as possible. The
project begins at three sites: "Infrastructure", "Elevated", and "Residen-
strated exceptional abilities in reasoning for tial", each with different tasks. The "Infrastructure Area" takes 3 days and
5202 beF 02  ]IA.sc[  1v36541.2052:viXra task planning. However, challenges remain costs 1 to proceed to the "Bridge Area"...The project team can select the
under-explored for parallel schedules. This most efficient route based on resources and progress.
| paperintroducesanovelparadigm,plan-over- |     |     |     |     |     |     |     |     | (5, 1) |     |     | (2, 1) |     |
| ---------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | ------ | --- | --- | ------ | --- |
graph,inwhichthemodelfirstdecomposesa
|     |     |     |     |     |     |     |     | Residential   |     | City Center |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | ------------- | --- | ----------- | --- | --- | --- |
(1, 1)
| real-lifetextualtaskintoexecutablesubtasks |            |     |             |     |             |     |          |           |               |     |        | Core Area |     |
| ------------------------------------------ | ---------- | --- | ----------- | --- | ----------- | --- | -------- | --------- | ------------- | --- | ------ | --------- | --- |
|                                            |            |     |             |     |             |     |          | ((33,, 1) |               |     | (2, 1) |           |     |
| and                                        | constructs |     | an abstract |     | task graph. | The |          |           |               |     |        |           |     |
| modelthenunderstandsthistaskgraphasin-     |            |     |             |     |             |     | Elevated |           | Building Area |     |        |           |     |
Facilities Area
put and generates a plan for parallel execu- (3, 1) (4, 1) (8, 1)
| tion. | To  | enhance | the | planning | capability | of  |     |     |     |     |     |     |     |
| ----- | --- | ------- | --- | -------- | ---------- | --- | --- | --- | --- | --- | --- | --- | --- |
(15, 1)
|          |     |          |         |     |           |        | Infrastructure |     | Bridge Area | Road Area |     |     |     |
| -------- | --- | -------- | ------- | --- | --------- | ------ | -------------- | --- | ----------- | --------- | --- | --- | --- |
| complex, |     | scalable | graphs, |     | we design | an au- |                |     |             |           |     |     |     |
tomatedandcontrollablepipelinetogenerate
syntheticgraphsandproposeatwo-stagetrain-
|     |         |              |     |     |              |      | Figure                       | 1: An | example | of our | task:                | from a | realistic |
| --- | ------- | ------------ | --- | --- | ------------ | ---- | ---------------------------- | ----- | ------- | ------ | -------------------- | ------ | --------- |
| ing | scheme. | Experimental |     |     | results show | that |                              |       |         |        |                      |        |           |
|     |         |              |     |     |              |      | textualquerytoaparallelplan. |       |         |        | Theplanisrepresented |        |           |
ourplan-over-graphmethodsignificantlyim-
|        |      |             |     |     |                |     | asagraph. | Edgesareavailablerules,andResidential, |     |     |     |     |     |
| ------ | ---- | ----------- | --- | --- | -------------- | --- | --------- | -------------------------------------- | --- | --- | --- | --- | --- |
| proves | task | performance |     | on  | both API-based |     |           |                                        |     |     |     |     |     |
Elevated,andInfrastructurearetheinitialsources,Core
| LLMsandtrainableopen-sourcedLLMs. |     |         |     |       |            | By  |           |         |     |             |        |     |         |
| --------------------------------- | --- | ------- | --- | ----- | ---------- | --- | --------- | ------- | --- | ----------- | ------ | --- | ------- |
|                                   |     |         |     |       |            |     | being the | target. | The | solid edges | denote | the | optimal |
| normalizing                       |     | complex |     | tasks | as graphs, | our |           |         |     |             |        |     |         |
planundertheconstraintoftimeconsumption.
| method                         |     | naturally | supports | parallel | execution, |     |     |     |     |     |     |     |     |
| ------------------------------ | --- | --------- | -------- | -------- | ---------- | --- | --- | --- | --- | --- | --- | --- | --- |
| demonstratingglobalefficiency. |     |           |          |          | Thecodeand |     |     |     |     |     |     |     |     |
data are available at https://github.com/ cialfortasksrequiringintricateworkflowsandpre-
|     |     |     |     |     |     |     | cise action | interfaces, |     | such | as UI | control | (Hong |
| --- | --- | --- | --- | --- | --- | --- | ----------- | ----------- | --- | ---- | ----- | ------- | ----- |
zsq259/Plan-over-Graph.
etal.,2023;Wuetal.,2024;Zhangetal.,2024a)
| 1   | Introduction |     |     |     |     |     | andsoftwareengineering(Yangetal.,2024c). |     |           |           |     |                 |     |
| --- | ------------ | --- | --- | --- | --- | --- | ---------------------------------------- | --- | --------- | --------- | --- | --------------- | --- |
|     |              |     |     |     |     |     | Despite                                  | the | inspiring | progress, |     | the parallelism |     |
Thecommendableprogressinlargelanguagemod-
|     |     |     |     |     |     |     | of the | plan remains |     | under-explored. |     | Multi-step |     |
| --- | --- | --- | --- | --- | --- | --- | ------ | ------------ | --- | --------------- | --- | ---------- | --- |
els(OpenAI,2023;Templetonetal.,2024;Yang
agenticframeworksgenerallydefaulttoblocking
etal.,2024a)hasfacilitatedtheimpressivecapabil-
|     |     |     |     |     |     |     | pipelines, | where | each | step | waits until | the | previ- |
| --- | --- | --- | --- | --- | --- | --- | ---------- | ----- | ---- | ---- | ----------- | --- | ------ |
ityofagentsforcomplicated,interactivetasks(Yao
ousonestocomplete,regardlessofwhetheritde-
etal.,2022b,a;Xietal.,2024;Maetal.,2024;Yang
pendsontheiroutcome(Wuetal.,2024;Gouetal.,
| etal.,2024b). |     | Recentlystudieshavedemonstrated |     |     |     |     |     |     |     |     |     |     |     |
| ------------- | --- | ------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
2024). Thereasoningcapabilitiesofagentsaresig-
| that | generating | a   | plan before |     | execution | enhances |     |     |     |     |     |     |     |
| ---- | ---------- | --- | ----------- | --- | --------- | -------- | --- | --- | --- | --- | --- | --- | --- |
nificantlystimulatedbyChain-of-Thoughts(CoT)
agents’performance,referredtoastheplan-then-
|         |           |         |       |         |         |             | (Wei et | al., 2023), | enabling |          | them | to divide     | and |
| ------- | --------- | ------- | ----- | ------- | ------- | ----------- | ------- | ----------- | -------- | -------- | ---- | ------------- | --- |
| execute | framework |         | (Zhao | et al., | 2024;   | Hao et al., |         |             |          |          |      |               |     |
|         |           |         |       |         |         |             | conquer | a complex   | task.    | Although |      | the reasoning |     |
| 2023a;  | Liu       | et al., | 2023; | Zhang   | et al., | 2023; Lin   |         |             |          |          |      |               |     |
structureisexpandedtotreesandgraphs(Yaoetal.,
| et al., | 2024a). | Planning |     | integrates | global | knowl- |     |     |     |     |     |     |     |
| ------- | ------- | -------- | --- | ---------- | ------ | ------ | --- | --- | --- | --- | --- | --- | --- |
2023;Bestaetal.,2024;Zhouetal.,2024),theac-
edge,enablingoverallcoherenceratherthanjustlo-
|     |     |     |     |     |     |     | tionsforsub-tasksaretakensequentially. |     |     |     |     | However, |     |
| --- | --- | --- | --- | --- | --- | --- | -------------------------------------- | --- | --- | --- | --- | -------- | --- |
caloptimality(Qiaoetal.,2024;Ruanetal.,2024).
thesesub-taskscanruninparallelifindependentof
Planningbreaksdowncomplextasksintosubtasks
|     |     |     |     |     |     |     | eachother. | Whilerecentstudieshaveexploredthe |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ---------- | --------------------------------- | --- | --- | --- | --- | --- |
assingle-stepoperations,whichisespeciallycru-
|                     |     |     |     |     |     |     | time efficiency                         |     | of asynchronous |     | execution, |     | gaps |
| ------------------- | --- | --- | --- | --- | --- | --- | --------------------------------------- | --- | --------------- | --- | ---------- | --- | ---- |
| #Equalcontribution. |     |     |     |     |     |     | remainwhenappliedtoreal-worldscenarios. |     |                 |     |            |     |      |
1

Thispaperdivesintoparallelisminplanningfor etal.,2022). Planninginvolvesdevelopinganac-
agentsconsideringcomplextaskgraphs,astheex- tionsequencebeforeexecution,leveragingglobal
ample shown in 1. We propose a new paradigm, knowledgeofthetaskandenvironmenttosuggesta
plan-over-graph, where the agent first explores logicallyconsistenttrajectory(Huangetal.,2024).
rulesandextractsagraph,thenplansonthegraphic Planningdecomposesacomplextaskandselects
structure under global consumption constraints. a feasible trajectory based on global knowledge
For this novel method, we construct a dataset of (Valmeekam et al., 2023; Wang et al., 2023; Wu
complextasksthatinvolveparallelsub-tasks. Each et al., 2024). Searching strategies are applied to
sample is initialized with a connected directed explore the optimal plan, such as depth-/breadth-
acyclic graph, annotated with source and target firstsearchandMonteCarlotreesearch(Yaoetal.,
nodes,alongwithfeasiblesolutionsandtheoptimal 2023;Zhouetal.,2024;Qietal.,2024;Zhaoetal.,
solution. Thesegraphsarefurthercontextualized 2024). Whenenvironmentalfeedbacksupplements
withappropriatescenariosbypromptinganLLM perceptionheavilyandupdatesthetaskknowledge,
to generate a textual description, finally forming planninginvolvesreflectiontorefinethetrajectory
realistictaskdescriptionsinnaturallanguage. incrementally(Shinnetal.,2024). Aworldmodel
We further improve our plan-over-graph or a reward model integrates global knowledge
paradigm with a trainable scheme. As the scale and predicts the environment states or estimates
ofgraphsexpands,graphcomprehensionremains rewards(Haoetal.,2023b;Qiaoetal.,2024).
a challenge for agents (Fatemi et al., 2023; Chen
2.2 LLMonGraphs
et al., 2024; Luo et al., 2024; Dai et al., 2024),
leadingtotheperformancebottleneck. Hence,we Asrealisticintricatechallengescanbeformedas
conduct a two-stage training strategy on abstract graphs,recentstudiesexploretheLLMs’capabili-
graphs. During inference, the agent is prompted tiesforreasoningwithgraphs. Graph-of-Thought
toextracttextualqueriestographsandthenplans (Bestaetal.,2024;Ningetal.,2024)firstproposes
overthegraphwiththetrainedadapter. Ourresults totransformtheproblemthinkingintoanarbitrary
aremeasuredbycomprehensivemetricsincluding graph to enable the generation, aggregation, and
success rate, optimal accuracy, feasible accuracy, refiningofsub-tasks. Yaoetal.(2024)alsoextract
andefficiency. Experimentsachievesignificantper- deductivetripletsfromcontextsandbuildgraphs.
formance advancement on both API-base LLMs Knowledgegraphssupportfaithfulnessandinfer-
and open-sourced LLMs. We further analyze the ence transparency for knowledge-intensive tasks
impactofgraphstructuresscalability,demonstrate (Luoetal.,2023;Sunetal.,2024;Wenetal.,2023).
how parallel execution improves time efficiency, Linetal.(2024b)combinesgraphswithnaturallan-
andidentifycommonerrorsintaskplanning. guagepromptsforreasoningaboutasynchronous
Ourcontributionscanbesummarizedasfollows: plansinreal-lifetasks,instructingmodeltoeither
◦ We present plan-over-graph for planning by reason based on a given graph or to generate a
enablingparallelismofsub-tasks,andconstructa graphthemselvesandthenreasonaboutit.
datasetofcomplextaskgraphs. However,itisdemonstratedthatthecapabilities
◦ We enhance plan-over-graph by training on ofgraphreasoningandunderstandingdecreaseas
task graphs and achieve significant improvement thescaleandcomplexityofgraphsincrease. Em-
acrossLLMs. pirical studies have observed a “comprehension
◦ We analyze that our approach achieves plan- collapse”phenomenonasthegraphsizeincreases
(Suietal.,2023;Caoetal.,2024). DARG(Zhang
ning efficiency and maintains robustness across
etal.,2024b)evaluatesLLMs’reasoningcapability
bothdiversemodelsandgraphtopology.
ongraphsandalsoreportsaperformancedecrease
2 RelatedWork withincreasingcomplexityofgraphs.
Differentfromexistingwork,ourpaperfurther
This section introduces the background of agent providesamoreformalandscalabledefinitionof
planningandgraphunderstandingofLLMs. theplanningtask’sgraphstructure,whichcaptures
theinherentcomplexitiesanddependenciesofthe
2.1 PlanningforLLM-basedAgents
task. Our planning-over-graph offers a general
Autonomousagentsthatinteractwithanenviron- framework, independent of the specific nature of
menttosolvecomplextasks(Yaoetal.,2022a;Fan the task. Additionally, we demonstrate the effec-
2

tiveness of this approach by training models on complexgraphtopologies,suggestingunresolved
thesegraphs,achievingsignificantimprovements challengesinstructuralreasoning. (ii)Thescaleof
inperformance. thecurrentlyconsideredgraphisstillverylimited.
WorFBench(Qiaoetal.,2025)consideredgraphs
3 Preliminary: ProblemStatement with majority nodes in the range of 2 to 10 steps.
|     |     |     |     |     |     | AsyncHow | (Lin | et al., | 2024b) | most | of the | graph |
| --- | --- | --- | --- | --- | --- | -------- | ---- | ------- | ------ | ---- | ------ | ----- |
Thissectionformalizestheproblemofplanningon
complexity|V|+|E|arealsobetween10and20.
taskgraphsandpresentsapreliminaryanalysisto
identifythekeychallenges. Consideringtheselimitations,wedesignanex-
|     |     |     |     |     |     | periment | for a | pilot study. | We  | construct |     | 100 ran- |
| --- | --- | --- | --- | --- | --- | -------- | ----- | ------------ | --- | --------- | --- | -------- |
3.1 FormulationofPlanning dom graphs with 10, 30, 50 nodes and ask LLM
Planning requires an agent to decompose a high- to find the shortest path as the solution. Table 1
level task description into executable subtasks, showstheaccuracyoffeasiblepathsandoptimal
|                                          |           |       |                    |     |           | paths, where              | the | performance |     | decreases         |     | sharply |
| ---------------------------------------- | --------- | ----- | ------------------ | --- | --------- | ------------------------- | --- | ----------- | --- | ----------------- | --- | ------- |
| scheduletheirexecutionunderdependencies, |           |       |                    |     | op-       |                           |     |             |     |                   |     |         |
|                                          |           |       |                    |     |           | asthenodenumberincreases. |     |             |     | Especially,andthe |     |         |
| timize                                   | for time, | cost, | or multi-objective |     | criteria, |                           |     |             |     |                   |     |         |
andfinallyachievethegoal. Formally,givenatask optimalrateof50-nodegraphsisonly6%.
| description,themodelgeneratesaplanP |     |     |     |     | bysolv- |           |     |              |     |              |     |     |
| ----------------------------------- | --- | --- | --- | --- | ------- | --------- | --- | ------------ | --- | ------------ | --- | --- |
|                                     |     |     |     |     |         | NodeCount |     | OptimalRate↑ |     | SuccessRate↑ |     |     |
ingthetuple⟨G,Ω⟩,whereGdenotesthecomplex
taskandΩdenotestheglobalcriteria.
|                                     |            |      |             |     |           | 10  |     | 29.0 |     |     | 79.0 |     |
| ----------------------------------- | ---------- | ---- | ----------- | --- | --------- | --- | --- | ---- | --- | --- | ---- | --- |
| Any                                 | high-level | task | description | can | be repre- | 30  |     | 16.0 |     |     | 35.0 |     |
| sentedasaDirectedAcyclicGraph(DAG), |            |      |             |     |           | 50  |     |      | 6.0 |     | 10.0 |     |
G = (T,E), T = {t ,t ,...,t }, (1) Table1: Llama-3.1-8B-Instructonrandomgraphs.
|     |     |     | 1   | 2   | n   |     |     |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
whoseverticesareconstrainedbytheprecedence This empirical evidence demonstrates that the
|     |     |     | e,g.,t | ≺   | t meanst |     |     |     |     |     |     |     |
| --- | --- | --- | ------ | --- | -------- | --- | --- | --- | --- | --- | --- | --- |
relationshipformedbyedges. i j i core bottleneck lies in planning competence on
mustprecedet . OnefeasibleplanP isasubgraph graphtopologyundercomplexconstraints. These
j
ofGthatsatisfiesG,P ⊂ G. findingsinspireustoprioritizeunderstandingca-
Inrealisticscenarios,therearecriteriaforcon- pabilities on complex graphs with constraints to
straints like execution time. We formally define enhancetheplanningtask.
aglobalfunctionΩ,wheretheoptimalplanmini-
|     |     |     |     |     |     | 4 Methodology: |     | Plan-over-Graph |     |     |     |     |
| --- | --- | --- | --- | --- | --- | -------------- | --- | --------------- | --- | --- | --- | --- |
mizesΩwhileachievingthetask,
|     |     | P = | argminΩ. |     |     |                                      |     |     |     |     |     |       |
| --- | --- | --- | -------- | --- | --- | ------------------------------------ | --- | --- | --- | --- | --- | ----- |
|     |     | opt |          |     | (2) | Weproposetheplan-over-graphparadigm. |     |     |     |     |     | Given |
P
|     |              |     |         |         |          | a textual   | query, | the LLM | is       | prompted | to    | gather |
| --- | ------------ | --- | ------- | ------- | -------- | ----------- | ------ | ------- | -------- | -------- | ----- | ------ |
| The | measurements |     | examine | whether | the pre- |             |        |         |          |          |       |        |
|     |              |     |         |         |          | information | and    | build   | the task | graph.   | Then, | the    |
dictedplanisoptimaloratleastfeasible,andalso
|                                    |           |     |         |        |               | task graph | is input, | on    | which | we have | the          | model |
| ---------------------------------- | --------- | --- | ------- | ------ | ------------- | ---------- | --------- | ----- | ----- | ------- | ------------ | ----- |
| computethemetricsofglobalcriteria. |           |     |         |        | Specifically, |            |           |       |       |         |              |       |
|                                    |           |     | Pˆ      |        |               | perform    | planning. | Then, | we    | focus   | on enhancing |       |
| given each                         | predicted |     | plan on | a test | dataset D,    |            |           |       |       |         |              |       |
thegraphunderstandingfortheplanstage.
| three kinds     | of  | metrics                      | to evaluate | its | helpfulness: |        |           |         |     |     |      |         |
| --------------- | --- | ---------------------------- | ----------- | --- | ------------ | ------ | --------- | ------- | --- | --- | ---- | ------- |
|                 |     |                              |             |     |              | In the | following | Section | 4.1 | and | 4.2, | we pro- |
| (i)OptimalRate: |     | Theproportionofoptimalplans, |             |     |              |        |           |         |     |     |      |         |
poseadataconstructionmethodtoacquirealarge
|     | OR  | = |Pˆ | = P |/|D|. |     | (3) |        |                 |     |       |      |                |     |
| --- | --- | ----- | ---------- | --- | --- | ------ | --------------- | --- | ----- | ---- | -------------- | --- |
|     |     |       | opt        |     |     | amount | of controllable |     | graph | data | automatically. |     |
(ii) Success Rate: The proportion of plans that Then, we design a training pipeline with these
|     |     |     |     |     |     | graphdata(Section4.3). |     |     | Finally,wecombinethese |     |     |     |
| --- | --- | --- | --- | --- | --- | ---------------------- | --- | --- | ---------------------- | --- | --- | --- |
successfullyachievethegoal.
|     |     |       |             |     |     | two steps     | to form                      | the | plan-over-graph |     | paradigm |     |
| --- | --- | ----- | ----------- | --- | --- | ------------- | ---------------------------- | --- | --------------- | --- | -------- | --- |
|     | SR  | = |Pˆ | ∈ {P}|/|D|. |     | (4) |               |                              |     |                 |     |          |     |
|     |     |       |             |     |     | forinference. | Ouroverallframeworkisshownis |     |                 |     |          |     |
Figure2.
(iii)ThevaluesofconsideredglobalcriteriaΩ.
4.1 AbstractTaskFormulation
3.2 ChallengesofPlanning
Existingexplorationsleavetwocriticallimitations. First,weredefinetheplanningtaskongraphstruc-
(i)Understandinggraphsiscurrentlyabottleneck ture. Without the loss of generality, we consider
in complex task planning for LLMs. Lin et al. timeandcostlimitsforΩ,theplanneedstomini-
(2024b) has shown that even with explicit graph mizemakespanortotalcost.
representations,thereisstillahugegapinhandling Task Graph. We define rules, R = {r }, that
i
3

RAGs
Goal
1
Extract
SFT
Annotated
Tree-based 1
Textual DPO Plan
Query ≻
Random
Initial Source (a) (b) (c)
Figure2: Theoverviewofourframework. (a)showsthedatasynthesispipeline;(b)showsourtrainingprocess;(c)
displaystheplan-over-graphparadigm.
allowparallelexecutiononagraph. Foreachnode Accordingtoourgraphdefinition,theΩismea-
suredbyTimeEfficiency(TE)andCostEfficiency
r = (S,t,τ,c). (5)
(CE)asfollows:
A rule states that after S is satisfied, t can be
n
executedwiththerequiredtimeτ andcostc. 1 (cid:88) Ω time (P i )
TE = ,
Query. Aqueryincludingpriorknowledgeand n Ω time (P opt )
i=1
(11)
ultimategoalcanbedenotedastheinitialnodeset n
1 (cid:88) Ω cost (P i )
andthetargetnodeas CE = .
n Ω (P )
cost opt
i=1
q = (I,t ), (6)
target
Thetimeandcostratiosoffailedplansareassigned
Plan. TheoverallplanP isasetofseveralsub
4asapenalty.
plans,eachdenotedas
4.2 DataSimulation
p = (S,t,D), p ∈ D ⇐⇒ t ∈ S (7)
j i j i
Followingourdefinitionabove,wedesignanauto-
where S and t are the preceding vertices and the
mated,controllable,andscalablepipelinetogener-
subtask,determiningaruler ∈ R. D capturesthe
atesyntheticdata,whichconsistsofthefollowing
dependenciesbetweensub-plans.
steps:
Criteria Here, we define the two considered
◦GenerateaconnectedDAG.Twodistinctgraph
global criteria, time consumption and cost. Sub-
structuresareemployed: (i)RandomDAGs. (ii)To
tasks that are independent of each other can be
betterconformtothehierarchicalstructureinreal-
executedinparallel. Inotherwords,p onlyneeds
i ityandavoidalargenumberofshortcutsinrandom
to wait for its dependency to end before starting
graph,wealsoconstructatree-basedstructure. We
execution. Theendtimeoftheexecutionofp can
i firstconstructatreewithadepthconstraintofno
beexpressedas:
morethan4,andthen,asmallnumberofancestral
End_time(p i ) =
p
m
j∈
a
D
x
i
(End_time(p j ))+τ pi , andcrossedgesareaddedtointroduceadditional
dependenciesandenrichthegraphstructure. The
Ω (P) = max(End_time(p)).
time edges are all directed to the root. The structural
p∈P
(8) trade-offsbetweenthesetwographrepresentations
areanalyzedinSection6.1. Thegraphisensured
Theglobalcostisdefinedasthesumofthecost
tobeconnected,meaningthereexistsatleastone
valuesofallsubtasks:
pathfromtheinitialverticestothetarget.
(cid:88)
Ω cost (P) = c p . (9) ◦Definerules. Foreachnon-headsubtasktin
p∈P theDAG,itspredecessorverticesarerandomlypar-
Weconsiderthetimeconsumptionasthemain titionedintogroupsasuniformlyaspossible. Then
criterion. Hence,P isthevaluethatminimizes eachpredecessorgroupandtformsthesourceand
opt
targetofonerule. Eachruleisassignedarandom
Ω(P) = Ω (P)+ϵ·Ω (P) (10)
time cost timevalue,whichissampledfromauniformdistri-
whereϵ ≪ 1. butionrangingfrom1to50. Thecostforallrules
4

is fixed to 1, simplifying the cost structure while Graph Edge
|                                        |     |     |     |     | Set | Nodes |           |          | Samples |
| -------------------------------------- | --- | --- | --- | --- | --- | ----- | --------- | -------- | ------- |
| maintainingthefocusontimeoptimization. |     |     |     |     |     |       | Structure | Relation |         |
◦ Define initial and target nodes. All head ver- Random Uniform 2000
10
|     |     |     |     |     |     |     | Tree-based | Linear | 2000 |
| --- | --- | --- | --- | --- | --- | --- | ---------- | ------ | ---- |
ticesintheDAGaredesignatedastheinitialsource
|                           |     |                     |     |     | Training |     | Random     | Uniform | 2000 |
| ------------------------- | --- | ------------------- | --- | --- | -------- | --- | ---------- | ------- | ---- |
| verticesfortheentiretask. |     | Atargetvertexisran- |     |     |          | 30  |            |         |      |
|                           |     |                     |     |     |          |     | Tree-based | Linear  | 2000 |
domlyselectedfromthetailvertices,ensuringthat
|                              |         |              |            |     |     |     | Random     | Linear | 2000 |
| ---------------------------- | ------- | ------------ | ---------- | --- | --- | --- | ---------- | ------ | ---- |
| thetaskhasawell-definedgoal. |         |              |            |     |     | 50  |            |        |      |
|                              |         |              |            |     |     |     | Tree-based | Linear | 2000 |
| ◦ Annotate                   | optimal | and feasible | solutions. | A   |     |     |            |        |      |
|                              |         |              |            |     |     |     | Random     | Linear | 100  |
dynamicprogrammingalgorithmisappliedtocom- 10 Tree-based Linear 100
|                                |           |               |            |     |     |     | Random | Uniform | 1000 |
| ------------------------------ | --------- | ------------- | ---------- | --- | --- | --- | ------ | ------- | ---- |
| pute the                       | labels of | each solution | of graphs. | The |     |     |        |         |      |
| optimalsolutionisthegoldlabel. |           |               |            |     |     |     | Random | Linear  | 100  |
20
|             |       |               |     |           |     |     | Tree-based | Linear | 100 |
| ----------- | ----- | ------------- | --- | --------- | --- | --- | ---------- | ------ | --- |
| ◦ Construct | query | descriptions. | We  | then gen- |     |     |            |        |     |
Testing
|               |         |          |               |     |     |     | Random     | Linear | 100 |
| ------------- | ------- | -------- | ------------- | --- | --- | --- | ---------- | ------ | --- |
| erate textual | queries | based on | those graphs. | We  |     |     |            |        |     |
|               |         |          |               |     |     | 30  | Tree-based | Linear | 100 |
promptanLLMtotransformgraphsintoreal-life Random Uniform 1000
| scenario | descriptions. | To ensure | consistency | be- |     |     |        |        |     |
| -------- | ------------- | --------- | ----------- | --- | --- | --- | ------ | ------ | --- |
|          |               |           |             |     |     |     | Random | Linear | 100 |
40
tween the generated task and the original graph, Tree-based Linear 100
| welettheLLMperformtheself-correctiontover- |     |     |     |     |     |     | Random | Linear | 100 |
| ------------------------------------------ | --- | --- | --- | --- | --- | --- | ------ | ------ | --- |
50
ifythatthequerydescriptionmatchestheoriginal Tree-based Linear 100
| graph. |     |     |     |     | Table2: | Detailedstatisticsofourtrainingandtesting |     |     |     |
| ------ | --- | --- | --- | --- | ------- | ----------------------------------------- | --- | --- | --- |
dataset.
4.3 TrainingScheme
5 Experiment
Inthissection,wefocusonoptimizingthemodel’s
| abilityonabstractgraphsandimproveitsparallel |     |                          |     |     | 5.1 Dataset |     |                                |     |     |
| -------------------------------------------- | --- | ------------------------ | --- | --- | ----------- | --- | ------------------------------ | --- | --- |
| planningcapabilities.                        |     | Ourtraininghastwostages: |     |     |             |     |                                |     |     |
|                                              |     |                          |     |     | TaskGraph.  |     | Thetheoreticaledgeofaconnected |     |     |
supervisedfine-tuninganddirectpreferenceopti- graph with node count n range spans from n−1
mization.
|                        |     |                  |     |     | ton(n−1)/2.            |     | Massiveedgesleadtoexcessively |                    |     |
| ---------------------- | --- | ---------------- | --- | --- | ---------------------- | --- | ----------------------------- | ------------------ | --- |
| SupervisedFine-Tuning. |     | Wefine-tuneanLLM |     |     |                        |     |                               |                    |     |
|                        |     |                  |     |     | longinputwhennislarge. |     |                               | Andtree-basedgraph |     |
on our abstract task datasets. This enables the structurealsocannothavetoomanyedges. There-
model to solve planning tasks using graph rep- fore,weadopttwopracticalstrategiestoavoidthis:
| resentations | of the | problem | space. | We use the |            |         |            |           |          |
| ------------ | ------ | ------- | ------ | ---------- | ---------- | ------- | ---------- | --------- | -------- |
|              |        |         |        |            | (i) linear | scaling | with edges | ∈ [2n,3n] | for ran- |
Low-RankAdaptation(LoRA)method(Huetal., domgraphsand∈ [n,1.5n]fortree-basedgraphs;
2022), which allows efficient adaptation of large (ii)uniformdistributionacrossthefulledgerange,
pre-trainedmodelsbylearningasmall-sizeadapter. whichisonlyusedonrandomgraphs.
TwosetupsareconsideredforSFT:(i)fine-tuning
Thestatisticsofoursyntheticdataareshownin
withoptimaldatainstances. (ii)toenablethemodel Table2. Thetrainingsetcontains12,000training
tolearnbothoptimalandfeasiblesolutions,wese- instances,dividedequallyacrossthreenodescales
lectthesecond-bestsolutionsandmixthemwith
(10,30,50nodes)andrandomandtree-basedDAG
theoptimalsolutionsasthetrainingdata.
|     |     |     |     |     | structures. | It  | employs uniform | distribution | edge |
| --- | --- | --- | --- | --- | ----------- | --- | --------------- | ------------ | ---- |
Direct Preference Optimization. Following configurationfor10/30-nodesgraphsbutrestricts
fine-tuning,directpreferenceoptimization(DPO) 50-nodes graphs to linear scaling. We generate
(Rafailovetal.,2023)isappliedtodistinguishthe 1000inputinstancesforeachnodescaleandgraph
optimalsolutionfromfeasibleones. Foreachsam- structure. Each input corresponds to an optimal
ple,thesecond-bestsolutionworksastherejected solutionandachosenfeasiblesolution. Thetesting
output,whileoptimalsolutionsarethechosenout- set comprises two components: (i) baseline tests
put. Thisstepfurtherrefinesthemodel’sabilityto
withlinearedgescalingacrossnodecounts(10,20,
prioritizeoptimalsolutionsoverfeasibleones. 30,40,50nodes),eachnodecountandgraphstruc-
Aftertraining,weaggregatetheextractingand ture containing 100 instances; (ii) edge-variation
planningstepsduringtheinference. Givenaquery tests specifically for 10/30-nodes random graphs
with a goal description, we first extract the task with uniformly distributed edges, to evaluate the
graph from the description, then we generate the model’s ability to understand graphs as the num-
planonthegraphwiththetrainedadapterloaded. ber of edges changes. Due to the wide range of
5

changesinthenumberofedges,wegenerate1,000 DPO.Wealsoobservedconsistentperformanceim-
| instanceseach. |     |     |     |     |     |     | provementsonQwen,whichisinferiortoLlama. |     |     |     |     |     |
| -------------- | --- | --- | --- | --- | --- | --- | ---------------------------------------- | --- | --- | --- | --- | --- |
TextualQuery. Tosystematicallyevaluatethe Q2: Whatphenomenadoestheexpansionofthe
parallel planning capacity of the model in real- graph scale lead to? As shown in the upprt part
ofFigure3,whenthenumberofnodesincreases,
| world task | scenarios |     | and validate |     | our plan-over- |     |     |     |     |     |     |     |
| ---------- | --------- | --- | ------------ | --- | -------------- | --- | --- | --- | --- | --- | --- | --- |
graphparadigm,weconstructanevaluationdataset whichleadstoalargergraphstructure,theoverall
utilizing the DeepSeek-R1 (DeepSeek-AI et al., performanceofallmodelsdecreases. Fortimeand
2025) model. This dataset synthesizes 200 tasks costratio,thesemodelshaveshownsimilarsensi-
|         |      |                 |     |         |          |     | tivitytothenodecount. |     | However,thecostratioof |     |     |     |
| ------- | ---- | --------------- | --- | ------- | -------- | --- | --------------------- | --- | ---------------------- | --- | --- | --- |
| derived | from | some real-world |     | problem | domains, |     |                       |     |                        |     |     |     |
whereeachtaskspecificationistransformedfrom Llamaisquiteobviouslyincreased,whichshowsits
graphsintoexecutableworkflowdescriptions. The tendencytoselectmoresubtasksonlargergraphs.
|     |     |     |     |     |     |     | For success | rate, GPT-4o |     | and Llama | drop | sensi- |
| --- | --- | --- | --- | --- | --- | --- | ----------- | ------------ | --- | --------- | ---- | ------ |
querydatastatisticsareoutlinedinAppendixB.
|              |     |     |     |     |     |     | tively. Whenthenumberofnodesreaches30,GPT- |     |     |                   |     |     |
| ------------ | --- | --- | --- | --- | --- | --- | ------------------------------------------ | --- | --- | ----------------- | --- | --- |
| 5.2 Baseline |     |     |     |     |     |     | 4oevenfallsbelowLlama.                     |     |     | However,Claudeand |     |     |
ourtrainedmodelcontinuetodemonstratestrong
| We evaluate |     | our method | against | several | baseline |     |                                     |     |     |     |             |     |
| ----------- | --- | ---------- | ------- | ------- | -------- | --- | ----------------------------------- | --- | --- | --- | ----------- | --- |
|             |     |            |         |         |          |     | capabilitieswithlesssensitivedrops. |     |     |     | Claudestill |     |
models,includingAPI-basedLLMsGPT-4o(Hurst
|               |     |            |     |        |             |     | suffers between | 10 and | 20  | points | on the | optimal |
| ------------- | --- | ---------- | --- | ------ | ----------- | --- | --------------- | ------ | --- | ------ | ------ | ------- |
| et al., 2024) |     | and Claude | 3.5 | Sonnet | (Anthropic, |     |                 |        |     |        |        |         |
rate,indicatingagapintheunderstandingoflarger-
| 2024) ,  | and    | open-source | LLMs, |     | Llama-3.1-8B- |     |               |        |          |         |     |         |
| -------- | ------ | ----------- | ----- | --- | ------------- | --- | ------------- | ------ | -------- | ------- | --- | ------- |
|          |        |             |       |     |               |     | scale graphs. | Across | all node | counts, | our | trained |
| Instruct | (Dubey | et al.,     | 2024) | and | Qwen2.5-7B-   |     |               |        |          |         |     |         |
Llamasignificantlyoutperformsallothermodels
| Instruct | (Yang | et al., | 2024a). | These | models | are |     |     |     |     |     |     |
| -------- | ----- | ------- | ------- | ----- | ------ | --- | --- | --- | --- | --- | --- | --- |
ontheoptimalrate.
selectedfortheirstrongperformanceandwideuse.
ThelowerpartofFigure3showstheresultsof
TheevaluationmetricsaredetailedinSection4.1.
|     |     |     |     |     |     |     | Claude and | our trained | Llama | on  | the full | range |
| --- | --- | --- | --- | --- | --- | --- | ---------- | ----------- | ----- | --- | -------- | ----- |
DetailedsetupscanbefoundinAppendixC.
|     |     |     |     |     |     |     | of edge       | counts for 1000 | cases  | with   | 10/30-nodes, |     |
| --- | --- | --- | --- | --- | --- | --- | ------------- | --------------- | ------ | ------ | ------------ | --- |
|     |     |     |     |     |     |     | respectively. | For 10          | nodes, | due to | the number   | of  |
5.3 MainResults
nodesbeingsmall,bothmodelshavedemonstrated
Table3presentsexperimentalresults. Ourresults robustnesstochangesinthenumberofedgesacross
answerthefollowingthreekeyquestions.
|     |         |          |        |     |           |      | themetrics. | For30nodes,asthenumberofedges |     |     |     |     |
| --- | ------- | -------- | ------ | --- | --------- | ---- | ----------- | ----------------------------- | --- | --- | --- | --- |
| Q1: | Can our | training | method |     | teach the | LLMs |             |                               |     |     |     |     |
increases,thedifficultyforthemodeltofindtheop-
planonthegraph? Whichmethodderivesthebest timalsolutionincreasesmoresignificantly. There-
performance? Theoverallresultsforeachmodel fore,theaveragetimeratioforbothisontherise.
| areshownintheupperpartofTable3. |     |     |     |     | Overall,it |     |     |     |     |     |     |     |
| ------------------------------- | --- | --- | --- | --- | ---------- | --- | --- | --- | --- | --- | --- | --- |
Theaveragecostratioincreaseslesssignificantly,
canbeobservedthattraininglargelyimprovesthe becauseasthegraphbecomesdenser,thenumber
planningperformanceandthetwo-stagetrain- of feasible solutions also increases, allowing the
ingachievesevenbetterscores. Withouttraining, model to complete tasks by selecting fewer sub-
Claude demonstrates high success rates (90.0%) tasks,thoughnotinthemostoptimaltime.
but relatively lower optimal rates (39.2%). GPT- Q3: Canourplan-over-graphmethodimprove
4o and Llama have similar success rates (51.3% theplanningperformanceontextualqueries? The
and52.3%),butGPT-4oachievesahigherOptimal
|     |     |     |     |     |     |     | lower part | of Table | 3 presents | the | results | of real- |
| --- | --- | --- | --- | --- | --- | --- | ---------- | -------- | ---------- | --- | ------- | -------- |
Rate (14.1%) than 1.8% of Llama. Qwen shows life queries, showing that our plan-over-graph
weaker performance in both success and optimal methodconsistentlyimprovesdifferentmodels’
rates(13.2%and0.5%). performance. Whenplanningwithoutextraction,
Onlytrainingonoptimalsolutionssignificantly Claudeachievesa89.5%successratebutstruggles
improves graph understanding and planning abil- withthe14.5%optimalrateandahigh1.904time
ity, leading to a 75.7% success rate and a 61.4% ratio. Llamaachievesasuccessrateof19%,with
optimalrateforLlama. Mixingfeasiblesolutions no optimal plan available, causing a 3.433 time
further improves the performance to 86.1% and ratio. With our plan-over-graph framework, the
67.5%. The best results of optimal rates (71.6%) optimal rate of Claude improves to 41.5%, and
arederivedfromthetwo-stagetraining,combining the success rate of Llama also improves to 38%,
SFT on mixed data and DPO, maintaining high withbothtimeratiosdecreased. Themodeltrained
successrates(83.6%). Thisisbecausethemodel forplanningshowsgreatlyimprovedperformance,
furthertendstochoosetheoptimalsolutionthrough surpassingevenClaudein72.5%optimalratewith
6

OverallResults
Model OptimalRate↑ SuccessRate↑ FeasibleRate AvgTimeRatio↓ AvgCostRatio↓
| Claude3.5Sonnet       |     | 39.2 |     | 90.0 | 50.8 | 1.545 | 1.589 |     |
| --------------------- | --- | ---- | --- | ---- | ---- | ----- | ----- | --- |
| GPT-4o                |     | 14.1 |     | 51.3 | 37.2 | 2.657 | 2.889 |     |
| Llama-3.1-8B-Instruct |     | 1.8  |     | 52.3 | 50.5 | 2.616 | 4.512 |     |
Llama-3.1-8B-InstructoptSFT 61.4+59.6 75.7+23.4 14.3 1.746-0.870 1.769-2.743
Llama-3.1-8B-Instructopt+feasSFT 67.5+65.7 86.1+33.8 18.6 1.507-1.109 1.498-3.014
Llama-3.1-8B-Instructopt+feasSFT+optDPO 71.6+69.8 83.6+31.3 12.0 1.502-1.114 1.520-2.992
| Qwen2.5-7B-Instruct |     | 0.5 |     | 13.2 | 12.7 | 3.612 | 4.072 |     |
| ------------------- | --- | --- | --- | ---- | ---- | ----- | ----- | --- |
Qwen2.5-7B-Instructopt+feasSFT+optDPO 27.0+26.5 75.8+62.6 48.8 2.191-1.421 2.029-2.043
TextualQueryResults
Method OptimalRate↑ SuccessRate↑ FeasibleRate AvgTimeRatio↓ AvgCostRatio↓
| ClaudePlan |     | 14.5 |     | 89.5 | 75.0 | 1.904 | 2.302 |     |
| ---------- | --- | ---- | --- | ---- | ---- | ----- | ----- | --- |
ClaudeExtract+Plan 41.5+27.0 93.5+4.0 52.0 1.514-0.390 1.689-0.613
| LlamaPlan |     | 0.0 |     | 19.0 | 19.0 | 3.433 | 4.103 |     |
| --------- | --- | --- | --- | ---- | ---- | ----- | ----- | --- |
LlamaExtract+Plan 3.5+3.5 38.0+19.0 34.5 2.952-0.481 3.553-0.550
LlamaExtract+Llama-trainedPlan 72.5+72.5 83.0+64.0 17.0 1.540-1.893 1.526-2.577
Table3: Experimentresults: theupperpartshowsresultsonallbaselinetestsets;thelowerpartshowsresultson
real-lifetasks
a83%successrate. tween 0.8 and 1.0. For edge variations on 10
Insummary,theseresultsdemonstratethat: First, nodes, both model shows low correlation coeffi-
theplan-over-graphmethodimprovedmodelper- cients which are less than 0.5, indicating robust-
formance. Second, training on the plan signifi- nesstochangesinthenumberofedgesongraphs
cantlyenhancedmodelperformance. withfewerpoints. However,on30nodes,Claude
hashighercorrelationcoefficientsonallfourmet-
| 6 Analysis |     |     |     | ricsthanourtrainedLlama,whicharemorethan |             |               |               |       |
| ---------- | --- | --- | --- | ---------------------------------------- | ----------- | ------------- | ------------- | ----- |
|            |     |     |     | 0.7                                      | correlation | coefficients, | demonstrating | lower |
Inthissection,wediscussourdatasetandthede-
|     |     |     |     | stability. | PleaserefertoAppendixFfordetails. |     |     |     |
| --- | --- | --- | --- | ---------- | --------------------------------- | --- | --- | --- |
tailedresultsoftheexperiment.
|     |     |     |     | 6.2 | TimeEfficiency |     |     |     |
| --- | --- | --- | --- | --- | -------------- | --- | --- | --- |
6.1 GraphFeatures
Thissectiondiscusses(i)ourconsiderationsregard- Ourtasksinherentlysupportparallelexecutionof
subtasks,yetmostexistingmethodsdonotconsider
ingthegraphstructure;(ii)theimpactofchanges
parallelismduringplanning,leadingtounnecessary
inthenumberofnodesandedgesinthegraphon
waitingtimes.
theplanningcapabilityofthemodel.
GraphStructures. Thetree-basedstructureis Wecalculatethetimeratioofparallelexecution
tosequentialexecution(thatis,thesumofallsub-
designedtobetterreflectreal-worldparallelscenar-
|               |                         |     |              | task | durations) | in the plans. | Table 4 | shows the |
| ------------- | ----------------------- | --- | ------------ | ---- | ---------- | ------------- | ------- | --------- |
| ios, offering | a stronger hierarchical |     | organization |      |            |               |         |           |
that facilitates the generation of more reasonable resultsofoptimallabels,andoutputsofourtrained
|                    |                              |     |     | LlamaandQwen. |     | Theresultsdemonstratethatthe |     |     |
| ------------------ | ---------------------------- | --- | --- | ------------- | --- | ---------------------------- | --- | --- |
| specificscenarios. | Toensureacleardistinctionbe- |     |     |               |     |                              |     |     |
capabilityofplanningparallelsolutionscansignifi-
tweenparallelandnon-parallelexecution,weim-
cantlyreducetimecomparedtoblockingsequential
| plementthefollowingstrategies: |     | (i)controllingthe |     |     |     |     |     |     |
| ------------------------------ | --- | ----------------- | --- | --- | --- | --- | --- | --- |
depthofthetreetomanagethenumberofbranches, execution. Such efficiency is more significant as
|                   |            |          |        | the | graph scales. | Specifically,  | plans from         | Llama |
| ----------------- | ---------- | -------- | ------ | --- | ------------- | -------------- | ------------------ | ----- |
| and (ii) grouping | nodes such | that the | number | of  |               |                |                    |       |
|                   |            |          |        | and | Qwen          | show high cost | ratios, indicating | that  |
nodesineachgroupdoesnotexceedtwo-thirdsof
thetotalnumberofpredecessornodes. Inaddition, therearemanyredundantsubtasks. Whenexecut-
|     |     |     |     | ing | these plans | sequentially, | the inefficiency | will |
| --- | --- | --- | --- | --- | ----------- | ------------- | ---------------- | ---- |
wealsousedanundefinedrandomgraphstructure
|     |     |     |     | befurtheramplified, |     | leadingtoalowratioofthe |     |     |
| --- | --- | --- | --- | ------------------- | --- | ----------------------- | --- | --- |
toverifytherobustnessofthemodel.
parallelexecutiontimetothesequential.
| Impact | of Node and Edge | Counts | We  | calcu- |     |     |     |     |
| ------ | ---------------- | ------ | --- | ------ | --- | --- | --- | --- |
latedtheabsolutevalueofcorrelationcoefficients
|     |     |     |     | 6.3 | WrongCaseStudy |     |     |     |
| --- | --- | --- | --- | --- | -------------- | --- | --- | --- |
andslopesofnormalizedfourmetricswithchanges
inthenumberofpointsandedges. Overall,theim- TaskGraph. Thewrongcasesonabstractgraphs
pact of the edge count is smaller than the node fallintotwotypes. (i)Invalidsubtask, wherethe
count. For node counts, almost all metrics of the planincludessubtaskswithoutcorrespondingtrans-
modelsshowedstrongcorrelationcoefficientsbe- formationrules,and(ii)Unavailablesource,where
7

Figure3: Theupperpartofthisfigureshowsmodelperformanceacrossdifferentnodecounts. Theleftplotshows
timeandcostratiochangewiththenumberofpoints,andtherightshowssuccessandoptimalrate. Thelowerpart
showsClaudeandourtrainedLlamaaveragetimeandcostratioacrossdifferentedgecounts.
Optimal Llama-trained Qwen-trained performance. However, interestingly, even with
NodeCount
|     | R T       | R T       | R T       | extractionerrors,themodelcanstillcompletethe |     |     |     |     |     |
| --- | --------- | --------- | --------- | -------------------------------------------- | --- | --- | --- | --- | --- |
| 10  | 0.88 0.92 | 0.88 0.92 | 0.88 0.93 |                                              |     |     |     |     |     |
taskcorrectlyifthesubsequentplanningdoesnot
| 20  | 0.76 0.74 | 0.77 0.80 | 0.79 0.79 |                          |     |     |                    |     |     |
| --- | --------- | --------- | --------- | ------------------------ | --- | --- | ------------------ | --- | --- |
|     |           |           |           | encounterincorrectrules. |     |     | ResultsofLlamashow |     |     |
| 30  | 0.74 0.75 | 0.75 0.75 | 0.73 0.68 |                          |     |     |                    |     |     |
40 0.70 0.68 0.71 0.68 0.68 0.61 thattheextractionstepsignificantlyimprovesthe
| 50  | 0.68 0.62 | 0.73 0.61 | 0.70 0.56 |     |     |     |     |     |     |
| --- | --------- | --------- | --------- | --- | --- | --- | --- | --- | --- |
baselinesuccessrate,andwhilethetrainedmodel’s
Table4: Theratiooftheparallelexecutiontimeofthe
|     |     |     |     | success | rate is slightly | lower | than | that of Claude, |     |
| --- | --- | --- | --- | ------- | ---------------- | ----- | ---- | --------------- | --- |
plansprovidedbyeachmodelatthetestcasestothese- its optimal rate is superior. After taking a closer
| quentialexecutiontime. |     | Rrepresentstherandomgraph |     |               |      |          |         |              |     |
| ---------------------- | --- | ------------------------- | --- | ------------- | ---- | -------- | ------- | ------------ | --- |
|                        |     |                           |     | look, finding | that | only 15% | matched | the original |     |
structure,andTrepresentsthetree-basedstructure.
|              |            |              |              | graphexactly. | However,theaveragesimilarityfor |          |            |         |     |
| ------------ | ---------- | ------------ | ------------ | ------------- | ------------------------------- | -------- | ---------- | ------- | --- |
|              |            |              |              | mismatched    | cases                           | was 82%, | indicating | minimal |     |
| the required | source for | a subtask is | not achieved |               |                                 |          |            |         |     |
impact. Thissupportsourfocusonimprovingthe
| duringexecution. | Thelatterindicateseitherafail- |     |     |     |     |     |     |     |     |
| ---------------- | ------------------------------ | --- | --- | --- | --- | --- | --- | --- | --- |
uretoconsiderthesourceavailabilityduringplan- model’splanningcapabilitiesonabstractgraphs.
| ningoranincorrecthandlingofdependencies. |     |     | Ta- |     |     |     |     |     |     |
| ---------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
7 Conclusion
| ble5showstheproportionoftwoerrortypes. |                       |     | After       |            |                  |     |         |          |     |
| -------------------------------------- | --------------------- | --- | ----------- | ---------- | ---------------- | --- | ------- | -------- | --- |
| training,                              | the source dependency | has | almost been |            |                  |     |         |          |     |
|                                        |                       |     |             | We present | plan-over-graph, |     | a novel | paradigm | to  |
resolved,butthehallucinationofinvalidsubtasks
|     |     |     |     | enhance | parallelism | in LLM-based |     | agentic | plan- |
| --- | --- | --- | --- | ------- | ----------- | ------------ | --- | ------- | ----- |
iscurrentlytheperformancebottleneck.
|     |     |     |     | ning. Our | approach | extracts | task | dependencies |     |
| --- | --- | --- | --- | --------- | -------- | -------- | ---- | ------------ | --- |
asstructuredgraphs,thenoptimizesparallelplan-
|       |     | Invalid | Unavailable |                                  |     |     |     |           |     |
| ----- | --- | ------- | ----------- | -------------------------------- | --- | --- | --- | --------- | --- |
| Model |     |         |             | ningthroughgraph-awarereasoning. |     |     |     | Wedevelop |     |
|       |     | Subtask | Source      |                                  |     |     |     |           |     |
Claude3.5Sonnet 0.4 9.6 asyntheticdatasetannotatedwithdirectedacyclic
| GPT-4o                |     | 4.7  | 44.0 |        |             |             |          |         |     |
| --------------------- | --- | ---- | ---- | ------ | ----------- | ----------- | -------- | ------- | --- |
|                       |     |      |      | graphs | and propose | a two-stage | training | scheme. |     |
| Llama-3.1-8B-Instruct |     | 17.6 | 30.1 |        |             |             |          |         |     |
Llama-3.1-8B-Instruct-Trained 11.6 4.8 Experimental results demonstrate significant im-
Qwen2.5-7B-Instruct 60.7 26.1 provements. Our analysis further reveals that
| Qwen2.5-7B-Instruct-Trained |     | 19.9 | 4.3 |     |     |     |     |     |     |
| --------------------------- | --- | ---- | --- | --- | --- | --- | --- | --- | --- |
thegraphstructureinverselyaffectsmodelperfor-
Table5: Theproportionoftwoerrorcausesinalltest
|     |     |     |     | mance | and the time | reduction | brought | by  | paral- |
| --- | --- | --- | --- | ----- | ------------ | --------- | ------- | --- | ------ |
casesofthemodel.
lelism. Thisworkestablishesaframeworkforpar-
Textual Query. Failure to extract essential rules allel agentic systems, bridging the gap between
forsubtaskswillcompromisethemodel’soverall abstractgraphsandreal-worldapplications.
8

Limitations
|     |     |     |     |     |     |     | QiushiDu,   | RuiqiGe, | RuisongZhang, |     |         | RuizhePan, |
| --- | --- | --- | --- | --- | --- | --- | ----------- | -------- | ------------- | --- | ------- | ---------- |
|     |     |     |     |     |     |     | Runji Wang, | R.       | J. Chen,      | R.  | L. Jin, | Ruyi Chen, |
We acknowledge the limitations of this work. (i) Shanghao Lu, Shangyan Zhou, Shanhuang Chen,
ShengfengYe,ShiyuWang,ShuipingYu,Shunfeng
Althoughwebelieveandverifythattheabilityto
planonthegraphismoreimportantthanextraction, Zhou,ShutingPan,S.S.Li,ShuangZhou,Shaoqing
Wu,ShengfengYe,TaoYun,TianPei,TianyuSun,
opensourcemodelshavealsoshowncertainflaws
|     |     |     |     |     |     |     | T. Wang, | Wangding | Zeng, | Wanjia | Zhao, | Wen Liu, |
| --- | --- | --- | --- | --- | --- | --- | -------- | -------- | ----- | ------ | ----- | -------- |
in extraction. (ii) In reality, the model’s plan can WenfengLiang, WenjunGao, WenqinYu, Wentao
beadynamicprocessthatinteractswiththeenvi- Zhang,W.L.Xiao,WeiAn,XiaodongLiu,Xiaohan
ronment,wherethemodelcanrefinethepreviously Wang,XiaokangChen,XiaotaoNie,XinCheng,Xin
Liu,XinXie,XingchaoLiu,XinyuYang,XinyuanLi,
| given plan | through |     | perception. |     | Our future | work |     |     |     |     |     |     |
| ---------- | ------- | --- | ----------- | --- | ---------- | ---- | --- | --- | --- | --- | --- | --- |
XuechengSu,XuhengLin,X.Q.Li,XiangyueJin,
willfocusonthesetwodirections. XiaojinShen,XiaoshaChen,XiaowenSun,Xiaoxi-
angWang,XinnanSong,XinyiZhou,XianzuWang,
XinxiaShan,Y.K.Li,Y.Q.Wang,Y.X.Wei,Yang
| References |     |     |     |     |     |     | Zhang, Yanhong |     | Xu, Yao | Li, | Yao Zhao, | Yaofeng |
| ---------- | --- | --- | --- | --- | --- | --- | -------------- | --- | ------- | --- | --------- | ------- |
Sun,YaohuiWang,YiYu,YichaoZhang,YifanShi,
Anthropic. 2024. Claude 3.5 sonnet. https://www. YiliangXiong,YingHe,YishiPiao,YisongWang,
anthropic.com/news/claude-3-5-sonnet. YixuanTan,YiyangMa,YiyuanLiu,YongqiangGuo,
YuanOu,YuduanWang,YueGong,YuhengZou,Yu-
| Maciej | Besta, | Nils Blach, | Ales | Kubicek, | Robert | Ger- |                     |     |     |             |     |             |
| ------ | ------ | ----------- | ---- | -------- | ------ | ---- | ------------------- | --- | --- | ----------- | --- | ----------- |
|        |        |             |      |          |        |      | jiaHe, YunfanXiong, |     |     | YuxiangLuo, |     | YuxiangYou, |
stenberger,LukasGianinazzi,JoannaGajda,Tomasz
YuxuanLiu,YuyangZhou,Y.X.Zhu,YanhongXu,
Lehmann,MichałPodstawski,HubertNiewiadomski,
YanpingHuang,YaohuiLi,YiZheng,YuchenZhu,
| PiotrNyczyk,andTorstenHoefler.2024. |     |     |     |     |     | Graphof |         |          |       |       |      |             |
| ----------------------------------- | --- | --- | --- | --- | --- | ------- | ------- | -------- | ----- | ----- | ---- | ----------- |
|                                     |     |     |     |     |     |         | Yunxian | Ma, Ying | Tang, | Yukun | Zha, | Yuting Yan, |
Thoughts: SolvingElaborateProblemswithLarge Z.Z.Ren,ZehuiRen,ZhangliSha,ZheFu,Zhean
| LanguageModels. |     |     | ProceedingsoftheAAAIConfer- |     |     |     |            |      |          |        |     |             |
| --------------- | --- | --- | --------------------------- | --- | --- | --- | ---------- | ---- | -------- | ------ | --- | ----------- |
|                 |     |     |                             |     |     |     | Xu, Zhenda | Xie, | Zhengyan | Zhang, |     | Zhewen Hao, |
enceonArtificialIntelligence,38(16):17682–17690.
ZhichengMa,ZhigangYan,ZhiyuWu,ZihuiGu,Zi-
jiaZhu,ZijunLiu,ZilinLi,ZiweiXie,ZiyangSong,
| Yukun Cao, | Shuo      | Han,      | Zengyi   | Gao,           | Zezhong  | Ding,    |                          |                            |            |         |              |                |
| ---------- | --------- | --------- | -------- | -------------- | -------- | -------- | ------------------------ | -------------------------- | ---------- | ------- | ------------ | -------------- |
|            |           |           |          |                |          |          | Zizheng                  | Pan, Zhen                  | Huang,     | Zhipeng |              | Xu, Zhongyu    |
| Xike       | Xie,      | and S.    | Kevin    | Zhou.          | 2024.    | Graphin- |                          |                            |            |         |              |                |
|            |           |           |          |                |          |          | Zhang,andZhenZhang.2025. |                            |            |         | Deepseek-r1: | Incen-         |
| sight:     | Unlocking |           | insights | in large       | language | mod-     |                          |                            |            |         |              |                |
|            |           |           |          |                |          |          | tivizing                 | reasoning                  | capability | in      | llms         | via reinforce- |
| els for    | graph     | structure |          | understanding. |          | ArXiv,   |                          |                            |            |         |              |                |
|            |           |           |          |                |          |          | mentlearning.            | Preprint,arXiv:2501.12948. |            |         |              |                |
abs/2409.03258.
Runjin Chen, Tong Zhao, Ajay Kumar Jaiswal, Neil AbhimanyuDubey,AbhinavJauhri,AbhinavPandey,
Shah,andZhangyangWang.2024. Llaga: Largelan- AbhishekKadian,AhmadAl-Dahle,AieshaLetman,
guageandgraphassistant. ArXiv,abs/2402.08170. Akhil Mathur, Alan Schelten, Amy Yang, Angela
|     |     |     |     |     |     |     | Fan,etal.2024. |     | Thellama3herdofmodels. |     |     | arXiv |
| --- | --- | --- | --- | --- | --- | --- | -------------- | --- | ---------------------- | --- | --- | ----- |
XinnanDai,HaohaoQu,YifenShen,BohangZhang, preprintarXiv:2407.21783.
QihaoWen,WenqiFan,DongshengLi,JiliangTang,
andCaihuaShan.2024. Howdolargelanguagemod- Linxi Fan, Guanzhi Wang, Yunfan Jiang, Ajay Man-
elsunderstandgraphpatterns?abenchmarkforgraph dlekar, Yuncong Yang, Haoyi Zhu, Andrew Tang,
| patterncomprehension. |     |     | ArXiv,abs/2410.05298. |     |     |     |     |     |     |     |     |     |
| --------------------- | --- | --- | --------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
De-AnHuang,YukeZhu,andAnimaAnandkumar.
|     |     |     |     |     |     |     | 2022. Minedojo: |     | Building | open-ended |     | embodied |
| --- | --- | --- | --- | --- | --- | --- | --------------- | --- | -------- | ---------- | --- | -------- |
DeepSeek-AI,DayaGuo,DejianYang,HaoweiZhang,
|     |     |     |     |     |     |     | agentswithinternet-scaleknowledge. |     |     |     |     | Advancesin |
| --- | --- | --- | --- | --- | --- | --- | ---------------------------------- | --- | --- | --- | --- | ---------- |
JunxiaoSong,RuoyuZhang,RunxinXu,QihaoZhu,
NeuralInformationProcessingSystems,35:18343–
| ShirongMa,PeiyiWang,XiaoBi,XiaokangZhang, |     |     |     |     |     |     | 18362. |     |     |     |     |     |
| ----------------------------------------- | --- | --- | --- | --- | --- | --- | ------ | --- | --- | --- | --- | --- |
XingkaiYu,YuWu,Z.F.Wu,ZhibinGou,Zhihong
Shao,ZhuoshuLi,ZiyiGao,AixinLiu,BingXue,
BahareFatemi,JonathanJ.Halcrow,andBryanPerozzi.
BingxuanWang,BochaoWu,BeiFeng,ChengdaLu,
|           |       |         |         |        |        |             | 2023. Talklikeagraph: |     |                       | Encodinggraphsforlarge |     |     |
| --------- | ----- | ------- | ------- | ------ | ------ | ----------- | --------------------- | --- | --------------------- | ---------------------- | --- | --- |
| Chenggang |       | Zhao,   | Chengqi | Deng,  | Chenyu | Zhang,      |                       |     |                       |                        |     |     |
|           |       |         |         |        |        |             | languagemodels.       |     | ArXiv,abs/2310.04560. |                        |     |     |
| Chong     | Ruan, | Damai   | Dai,    | Deli   | Chen,  | Dongjie Ji, |                       |     |                       |                        |     |     |
| Erhang    | Li,   | Fangyun | Lin,    | Fucong | Dai,   | Fuli Luo,   |                       |     |                       |                        |     |     |
ZhibinGou,ZhihongShao,YeyunGong,yelongshen,
GuangboHao,GuantingChen,GuoweiLi,H.Zhang,
Han Bao, Hanwei Xu, Haocheng Wang, Honghui Yujiu Yang, Nan Duan, and Weizhu Chen. 2024.
Ding, Huajian Xin, Huazuo Gao, Hui Qu, Hui Li, CRITIC: Large language models can self-correct
Jianzhong Guo, Jiashi Li, Jiawei Wang, Jingchang withtool-interactivecritiquing. InTheTwelfthInter-
nationalConferenceonLearningRepresentations.
| Chen, | JingyangYuan, |     | JunjieQiu, |     | JunlongLi, | J.L. |     |     |     |     |     |     |
| ----- | ------------- | --- | ---------- | --- | ---------- | ---- | --- | --- | --- | --- | --- | --- |
Cai,JiaqiNi,JianLiang,JinChen,KaiDong,Kai
Hu, Kaige Gao, Kang Guan, Kexin Huang, Kuai ShiboHao,YiGu,HaodiMa,JoshuaHong,ZhenWang,
Yu,LeanWang,LecongZhang,LiangZhao,Litong Daisy Wang, and Zhiting Hu. 2023a. Reasoning
Wang,LiyueZhang,LeiXu,LeyiXia,Mingchuan withlanguagemodelisplanningwithworldmodel.
Zhang, Minghua Zhang, Minghui Tang, Meng Li, In Proceedings of the 2023 Conference on Empiri-
Miaojun Wang, Mingming Li, Ning Tian, Panpan calMethodsinNaturalLanguageProcessing,pages
| Huang,PengZhang,QianchengWang,QinyuChen, |     |     |     |     |     |     | 8154–8173. |     |     |     |     |     |
| ---------------------------------------- | --- | --- | --- | --- | --- | --- | ---------- | --- | --- | --- | --- | --- |
9

Shibo Hao, Yi Gu, Haodi Ma, Joshua Hong, Zhen theAssociationforComputationalLinguistics: ACL
Wang, Daisy Wang, and Zhiting Hu. 2023b. Rea- 2024,pages9097–9110,Bangkok,Thailand.Associ-
soningwithlanguagemodelisplanningwithworld ationforComputationalLinguistics.
| model. | In Proceedings |     | of the | 2023 | Conference | on  |     |     |     |     |     |     |
| ------ | -------------- | --- | ------ | ---- | ---------- | --- | --- | --- | --- | --- | --- | --- |
EmpiricalMethodsinNaturalLanguageProcessing, Xinyu Ning, Yutong Zhao, Yitong Liu, and Hong-
pages8154–8173,Singapore.AssociationforCom- wen Yang. 2024. Dgot: Dynamic graph of
putationalLinguistics. thoughts for scientific abstract generation. ArXiv,
abs/2403.17491.
| Wenyi Hong, | Weihan |     | Wang, | Qingsong | Lv, | Jiazheng |     |     |     |     |     |     |
| ----------- | ------ | --- | ----- | -------- | --- | -------- | --- | --- | --- | --- | --- | --- |
Xu,WenmengYu,JunhuiJi,YanWang,ZihanWang,
|                                |     |     |     |     |           |     | OpenAI.2023. | Gpt-4technicalreport. |     |     | ArXivpreprint, |     |
| ------------------------------ | --- | --- | --- | --- | --------- | --- | ------------ | --------------------- | --- | --- | -------------- | --- |
| YuxiaoDong,MingDing,etal.2023. |     |     |     |     | Cogagent: | A   |              |                       |     |     |                |     |
abs/2303.08774.
| visuallanguagemodelforguiagents. |     |     |     |     | ArXivpreprint, |     |     |     |     |     |     |     |
| -------------------------------- | --- | --- | --- | --- | -------------- | --- | --- | --- | --- | --- | --- | --- |
abs/2312.08914.
ZhentingQi,MingyuanMa,JiahangXu,LiLynaZhang,
|     |     |     |     |     |     |     | Fan Yang, | and | Mao Yang. | 2024. | Mutual | reason- |
| --- | --- | --- | --- | --- | --- | --- | --------- | --- | --------- | ----- | ------ | ------- |
EdwardJHu,yelongshen,PhillipWallis,ZeyuanAllen-
|     |     |     |     |     |     |     | ing makes | smaller | llms | stronger | problem-solvers. |     |
| --- | --- | --- | --- | --- | --- | --- | --------- | ------- | ---- | -------- | ---------------- | --- |
Zhu,YuanzhiLi,SheanWang,LuWang,andWeizhu
Preprint,arXiv:2408.06195.
| Chen.    | 2022.   | LoRA: | Low-rank         | adaptation |            | of large |     |     |     |     |     |     |
| -------- | ------- | ----- | ---------------- | ---------- | ---------- | -------- | --- | --- | --- | --- | --- | --- |
| language | models. |       | In International |            | Conference | on       |     |     |     |     |     |     |
LearningRepresentations. Shuofei Qiao, Runnan Fang, Zhisong Qiu, Xiaobin
Wang,NingyuZhang,YongJiang,PengjunXie,Fei
Xu Huang, Weiwen Liu, Xiaolong Chen, Xingmei Huang,andHuajunChen.2025. Benchmarkingagen-
Wang,HaoWang,DefuLian,YashengWang,Ruim- ticworkflowgeneration. InTheThirteenthInterna-
ingTang,andEnhongChen.2024. Understanding tionalConferenceonLearningRepresentations.
| theplanningofllmagents: |     |     | Asurvey. |     | arXivpreprint |     |     |     |     |     |     |     |
| ----------------------- | --- | --- | -------- | --- | ------------- | --- | --- | --- | --- | --- | --- | --- |
arXiv:2402.02716. ShuofeiQiao,RunnanFang,NingyuZhang,YuqiZhu,
|              |                  |        |         |        |          |          | Xiang Chen,                      | Shumin | Deng,      | Yong | Jiang, | Pengjun      |
| ------------ | ---------------- | ------ | ------- | ------ | -------- | -------- | -------------------------------- | ------ | ---------- | ---- | ------ | ------------ |
| Aaron Hurst, | Adam             | Lerer, | Adam    | P      | Goucher, | Adam     |                                  |        |            |      |        |              |
|              |                  |        |         |        |          |          | Xie, Fei                         | Huang, | and Huajun |      | Chen.  | 2024. Agent  |
| Perelman,    | Aditya           |        | Ramesh, | Aidan  | Clark,   | AJ Os-   |                                  |        |            |      |        |              |
|              |                  |        |         |        |          |          | planningwithworldknowledgemodel. |        |            |      |        | InTheThirty- |
| trow,        | Akila Welihinda, |        | Alan    | Hayes, | Alec     | Radford, |                                  |        |            |      |        |              |
|              |                  |        |         |        |          |          | eighth Annual                    |        | Conference | on   | Neural | Information  |
| et al.       | 2024.            | Gpt-4o | system  | card.  | arXiv    | preprint | ProcessingSystems.               |        |            |      |        |              |
arXiv:2410.21276.
RafaelRafailov,ArchitSharma,EricMitchell,Christo-
BillYuchenLin,YichengFu,KarinaYang,FaezeBrah-
pherDManning,StefanoErmon,andChelseaFinn.
man,ShiyuHuang,ChandraBhagavatula,Prithviraj
2023. Directpreferenceoptimization:Yourlanguage
| Ammanabrolu, |     | Yejin | Choi, | and Xiang | Ren. | 2024a. |     |     |     |     |     |     |
| ------------ | --- | ----- | ----- | --------- | ---- | ------ | --- | --- | --- | --- | --- | --- |
InThirty-seventh
Swiftsage: A generative agent with fast and slow modelissecretlyarewardmodel.
ConferenceonNeuralInformationProcessingSys-
| thinkingforcomplexinteractivetasks. |     |     |     |     | Advancesin |     |     |     |     |     |     |     |
| ----------------------------------- | --- | --- | --- | --- | ---------- | --- | --- | --- | --- | --- | --- | --- |
tems.
NeuralInformationProcessingSystems,36.
Fangru Lin, Emanuele La Malfa, Valentin Hofmann, Yangjun Ruan, Honghua Dong, Andrew Wang, Sil-
ElleMichelleYang,AnthonyG.Cohn,andJanetB. viuPitis,YongchaoZhou,JimmyBa,YannDubois,
Pierrehumbert. 2024b. Graph-enhanced large lan- ChrisJ.Maddison,andTatsunoriHashimoto.2024.
guage models in asynchronous plan reasoning. In Identifying the risks of LM agents with an LM-
Forty-first International Conference on Machine emulatedsandbox. InTheTwelfthInternationalCon-
ferenceonLearningRepresentations.
Learning.
Bo Liu, Yuqian Jiang, Xiaohan Zhang, Qiang Liu, Noah Shinn, Federico Cassano, Ashwin Gopinath,
Shiqi Zhang, Joydeep Biswas, and Peter Stone. Karthik Narasimhan, and Shunyu Yao. 2024. Re-
2023. Llm+ p: Empowering large language mod- flexion: Languageagentswithverbalreinforcement
| elswithoptimalplanningproficiency. |     |     |     |     | arXivpreprint |     |           |                                     |     |     |     |     |
| ---------------------------------- | --- | --- | --- | --- | ------------- | --- | --------- | ----------------------------------- | --- | --- | --- | --- |
|                                    |     |     |     |     |               |     | learning. | AdvancesinNeuralInformationProcess- |     |     |     |     |
arXiv:2304.11477.
ingSystems,36.
| Linhao Luo, | Yuan-Fang |     | Li, Gholamreza |     | Haffari, | and |     |     |     |     |     |     |
| ----------- | --------- | --- | -------------- | --- | -------- | --- | --- | --- | --- | --- | --- | --- |
YuanSui,MengyuZhou,MingjieZhou,ShiHan,and
| ShiruiPan.2023.                           |     | Reasoningongraphs: |     |     | Faithfuland |        |                                              |     |     |                |     |          |
| ----------------------------------------- | --- | ------------------ | --- | --- | ----------- | ------ | -------------------------------------------- | --- | --- | -------------- | --- | -------- |
|                                           |     |                    |     |     |             |        | DongmeiZhang.2023.                           |     |     | Tablemeetsllm: |     | Canlarge |
| interpretablelargelanguagemodelreasoning. |     |                    |     |     |             | ArXiv, |                                              |     |     |                |     |          |
|                                           |     |                    |     |     |             |        | languagemodelsunderstandstructuredtabledata? |     |     |                |     | a        |
abs/2310.01061.
|     |     |     |     |     |     |     | benchmarkandempiricalstudy. |     |     |     | Proceedingsofthe |     |
| --- | --- | --- | --- | --- | --- | --- | --------------------------- | --- | --- | --- | ---------------- | --- |
17thACMInternationalConferenceonWebSearch
| Zihan Luo, | Xiran | Song, | Hong | Huang, | Jianxun | Lian, |     |     |     |     |     |     |
| ---------- | ----- | ----- | ---- | ------ | ------- | ----- | --- | --- | --- | --- | --- | --- |
andDataMining.
ChenhaoZhang,JinqiJiang,XingXie,andHaiJin.
| 2024. | Graphinstruct: |     | Empowering |     | large | language |     |     |     |     |     |     |
| ----- | -------------- | --- | ---------- | --- | ----- | -------- | --- | --- | --- | --- | --- | --- |
modelswithgraphunderstandingandreasoningca- JiashuoSun,ChengjinXu,LumingyuanTang,Saizhuo
|           |                       |     |     |     |     |     | Wang, Chen                 | Lin, | Yeyun | Gong, | Lionel          | Ni, Heung- |
| --------- | --------------------- | --- | --- | --- | --- | --- | -------------------------- | ---- | ----- | ----- | --------------- | ---------- |
| pability. | ArXiv,abs/2403.04483. |     |     |     |     |     |                            |      |       |       |                 |            |
|           |                       |     |     |     |     |     | YeungShum,andJianGuo.2024. |      |       |       | Think-on-graph: |            |
Xinbei Ma, Zhuosheng Zhang, and Hai Zhao. 2024. Deep and responsible reasoning of large language
CoCo-agent: A comprehensive cognitive MLLM modelonknowledgegraph. InTheTwelfthInterna-
agentforsmartphoneGUIautomation. InFindingsof tionalConferenceonLearningRepresentations.
10

AdlyTempleton,TomConerly,JonathanMarcus,Jack JohnYang, CarlosEJimenez, AlexanderWettig, Kil-
Lindsey,TrentonBricken,BrianChen,AdamPearce, ian Lieret, Shunyu Yao, Karthik Narasimhan, and
CraigCitro,EmmanuelAmeisen,AndyJones,Hoagy OfirPress.2024b. Swe-agent: Agent-computerinter-
Cunningham,NicholasLTurner,CallumMcDougall, facesenableautomatedsoftwareengineering. arXiv
MonteMacDiarmid,C.DanielFreeman,TheodoreR. preprintarXiv:2405.15793.
Sumers,EdwardRees,JoshuaBatson,AdamJermyn,
ShanCarter,ChrisOlah,andTomHenighan.2024. JohnYang,CarlosEJimenez,AlexanderWettig,Kilian
Scaling monosemanticity: Extracting interpretable Lieret,ShunyuYao,KarthikRNarasimhan,andOfir
featuresfromclaude3sonnet. TransformerCircuits Press. 2024c. SWE-agent: Agent-computer inter-
| Thread. |     |     |     |     |     | facesenableautomatedsoftwareengineering. |     |     |     |     |     | InThe |
| ------- | --- | --- | --- | --- | --- | ---------------------------------------- | --- | --- | --- | --- | --- | ----- |
Thirty-eighthAnnualConferenceonNeuralInforma-
tionProcessingSystems.
KarthikValmeekam,MatthewMarquez,SarathSreed-
| haran, | and Subbarao |     | Kambhampati. |     | 2023. On the |             |        |       |      |       |     |         |
| ------ | ------------ | --- | ------------ | --- | ------------ | ----------- | ------ | ----- | ---- | ----- | --- | ------- |
|        |              |     |              |     |              | Shunyu Yao, | Howard | Chen, | John | Yang, | and | Karthik |
planningabilitiesoflargelanguagemodels-acrit-
icalinvestigation. InThirty-seventhConferenceon Narasimhan. 2022a. Webshop: Towards scalable
NeuralInformationProcessingSystems. real-worldwebinteractionwithgroundedlanguage
|     |     |     |     |     |     | agents. | AdvancesinNeuralInformationProcessing |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | ------- | ------------------------------------- | --- | --- | --- | --- | --- |
LeiWang,WanyuXu,YihuaiLan,ZhiqiangHu,Yunshi Systems,35:20744–20757.
| Lan,RoyKa-WeiLee,andEe-PengLim.2023.   |     |     |                             |     | Plan-  |             |      |            |         |          |         |          |
| -------------------------------------- | --- | --- | --------------------------- | --- | ------ | ----------- | ---- | ---------- | ------- | -------- | ------- | -------- |
|                                        |     |     |                             |     |        | Shunyu Yao, | Dian | Yu,        | Jeffrey | Zhao,    | Izhak   | Shafran, |
| and-solveprompting:                    |     |     | Improvingzero-shotchain-of- |     |        |             |      |            |         |          |         |          |
|                                        |     |     |                             |     |        | Thomas      | L.   | Griffiths, | Yuan    | Cao, and | Karthik | R        |
| thoughtreasoningbylargelanguagemodels. |     |     |                             |     | InPro- |             |      |            |         |          |         |          |
ceedingsofthe61stAnnualMeetingoftheAssocia- Narasimhan. 2023. Tree of thoughts: Deliberate
tionforComputationalLinguistics(Volume1: Long problem solving with large language models. In
|     |     |     |     |     |     | Thirty-seventh |     | Conference | on  | Neural | Information |     |
| --- | --- | --- | --- | --- | --- | -------------- | --- | ---------- | --- | ------ | ----------- | --- |
Papers),pages2609–2634.
ProcessingSystems.
JasonWei,XuezhiWang,DaleSchuurmans,Maarten
|     |     |     |     |     |     | Shunyu Yao, | Jeffrey | Zhao, | Dian | Yu, | Nan Du, | Izhak |
| --- | --- | --- | --- | --- | --- | ----------- | ------- | ----- | ---- | --- | ------- | ----- |
Bosma,FeiXia,EdChi,QuocVLe,DennyZhou,
Shafran,KarthikNarasimhan,andYuanCao.2022b.
| etal.2023. |     | Chain-of-thoughtpromptingelicitsrea- |     |     |     |     |     |     |     |     |     |     |
| ---------- | --- | ------------------------------------ | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
ReAct:Synergizingreasoningandactinginlanguage
| soninginlargelanguagemodels. |     |     |     | AdvancesinNeural |     |     |     |     |     |     |     |     |
| ---------------------------- | --- | --- | --- | ---------------- | --- | --- | --- | --- | --- | --- | --- | --- |
InformationProcessingSystems,35:24824–24837. models. volumeabs/2210.03629.
|            |        |       |     |        |            | YaoYao,ZuchaoLi,andHaiZhao.2024. |     |     |     |     | GoT:Effec- |     |
| ---------- | ------ | ----- | --- | ------ | ---------- | -------------------------------- | --- | --- | --- | --- | ---------- | --- |
| Yilin Wen, | Zifeng | Wang, | and | Jimeng | Sun. 2023. |                                  |     |     |     |     |            |     |
tivegraph-of-thoughtreasoninginlanguagemodels.
Mindmap:Knowledgegraphpromptingsparksgraph
InFindingsoftheAssociationforComputationalLin-
| of thoughts |        | in large    | language | models.       | In Annual |               |       |             |       |               |     |        |
| ----------- | ------ | ----------- | -------- | ------------- | --------- | ------------- | ----- | ----------- | ----- | ------------- | --- | ------ |
|             |        |             |          |               |           | guistics:     | NAACL | 2024,       | pages | 2901–2921,    |     | Mexico |
| Meeting     | of the | Association | for      | Computational | Lin-      |               |       |             |       |               |     |        |
|             |        |             |          |               |           | City, Mexico. |       | Association | for   | Computational |     | Lin-   |
guistics.
guistics.
ZhiyongWu,ChengchengHan,ZichenDing,Zhenmin
ShaoqingZhang,ZhuoshengZhang,KehaiChen,Xin-
| Weng, | ZhoumianzeLiu, |     | ShunyuYao, |     | TaoYu, and |     |     |     |     |     |     |     |
| ----- | -------------- | --- | ---------- | --- | ---------- | --- | --- | --- | --- | --- | --- | --- |
beiMa,MuyunYang,TiejunZhao,andMinZhang.
| LingpengKong.2024.                     |          |          | OS-copilot: | Towardsgeneral- |             |                                   |         |          |                        |           |            |     |
| -------------------------------------- | -------- | -------- | ----------- | --------------- | ----------- | --------------------------------- | ------- | -------- | ---------------------- | --------- | ---------- | --- |
|                                        |          |          |             |                 |             | 2024a.                            | Dynamic | planning | for                    | llm-based | graphical  |     |
| istcomputeragentswithself-improvement. |          |          |             |                 | InICLR      |                                   |         |          |                        |           |            |     |
|                                        |          |          |             |                 |             | userinterfaceautomation.          |         |          | InFindingsoftheAssoci- |           |            |     |
| 2024                                   | Workshop | on Large | Language    |                 | Model (LLM) |                                   |         |          |                        |           |            |     |
|                                        |          |          |             |                 |             | ationforComputationalLinguistics: |         |          |                        |           | EMNLP2024, |     |
Agents.
pages1304–1320.
| Zhiheng | Xi, Yiwen | Ding, | Wenxiang | Chen, | Boyang |               |     |             |     |      |       |        |
| ------- | --------- | ----- | -------- | ----- | ------ | ------------- | --- | ----------- | --- | ---- | ----- | ------ |
|         |           |       |          |       |        | Zhehao Zhang, |     | Jiaao Chen, | and | Diyi | Yang. | 2024b. |
Hong,HonglinGuo,JunzheWang,DingwenYang,
|     |     |     |     |     |     | Darg: | Dynamic | evaluation |     | of large | language |     |
| --- | --- | --- | --- | --- | --- | ----- | ------- | ---------- | --- | -------- | -------- | --- |
ChenyangLiao,XinGuo,WeiHe,SongyangGao,
|          |     |            |         |      |          | models | via | adaptive | reasoning | graph. |     | Preprint, |
| -------- | --- | ---------- | ------- | ---- | -------- | ------ | --- | -------- | --------- | ------ | --- | --------- |
| Lu Chen, |     | Rui Zheng, | Yicheng | Zou, | Tao Gui, |        |     |          |           |        |     |           |
arXiv:2406.17271.
| Qi Zhang,                 | Xipeng | Qiu, | Xuanjing | Huang,    | Zuxuan |           |        |     |            |        |     |         |
| ------------------------- | ------ | ---- | -------- | --------- | ------ | --------- | ------ | --- | ---------- | ------ | --- | ------- |
| Wu, andYu-GangJiang.2024. |        |      |          | Agentgym: | Evolv- |           |        |     |            |        |     |         |
|                           |        |      |          |           |        | Zhuosheng | Zhang, | Yao | Yao, Aston | Zhang, |     | Xiangru |
inglargelanguagemodel-basedagentsacrossdiverse Tang,XinbeiMa,ZhiweiHe,YimingWang,Mark
environments. Preprint,arXiv:2406.04151. Gerstein, RuiWang, GongshenLiu, andHaiZhao.
|          |         |       |         |        |         | 2023. | Igniting | language | intelligence: |     | The | hitch- |
| -------- | ------- | ----- | ------- | ------ | ------- | ----- | -------- | -------- | ------------- | --- | --- | ------ |
| An Yang, | Baosong | Yang, | Beichen | Zhang, | Binyuan |       |          |          |               |     |     |        |
hiker’sguidefromchain-of-thoughtreasoningtolan-
| Hui, Bo | Zheng,   | Bowen  | Yu,            | Chengyuan | Li, Dayi-     |                                       |     |                            |     |     |     |       |
| ------- | -------- | ------ | -------------- | --------- | ------------- | ------------------------------------- | --- | -------------------------- | --- | --- | --- | ----- |
|         |          |        |                |           |               | guageagents.                          |     | Preprint,arXiv:2311.11797. |     |     |     |       |
| heng    | Liu, Fei | Huang, | Haoran         | Wei, Huan | Lin, Jian     |                                       |     |                            |     |     |     |       |
| Yang,   | Jianhong | Tu,    | Jianwei Zhang, |           | Jianxin Yang, |                                       |     |                            |     |     |     |       |
|         |          |        |                |           |               | ZiruiZhao,WeeSunLee,andDavidHsu.2024. |     |                            |     |     |     | Large |
Jiaxi Yang, Jingren Zhou, Junyang Lin, Kai Dang, language models as commonsense knowledge for
Keming Lu, Keqin Bao, Kexin Yang, Le Yu, Mei large-scaletaskplanning. AdvancesinNeuralInfor-
Li, Mingfeng Xue, Pei Zhang, Qin Zhu, Rui Men, mationProcessingSystems,36.
RunjiLin,TianhaoLi,TingyuXia,XingzhangRen,
XuanchengRen,YangFan,YangSu,YichangZhang, YaoweiZheng,RichongZhang,JunhaoZhang,Yanhan
YuWan,YuqiongLiu,ZeyuCui,ZhenruZhang,and Ye,ZheyanLuo,ZhangchiFeng,andYongqiangMa.
ZihanQiu.2024a. Qwen2.5technicalreport. arXiv 2024. Llamafactory: Unified efficient fine-tuning
preprintarXiv:2412.15115. of 100+ language models. In Proceedings of the
11

62ndAnnualMeetingoftheAssociationforCompu- Prompttemplateforgraphplanning
tationalLinguistics(Volume3: SystemDemonstra-
tions),Bangkok,Thailand.AssociationforComputa- Youaregivenasetoftransformationrules, whereeach
tionalLinguistics. ruleconsistsofsourcenodes(materialsorsubtasks),target
nodes(resultingmaterialsortasks),thetimerequiredto
completethetransformation,andacostassociatedwiththe
transformation.Yourgoalistoplanapathfromtheinitial
nodestothetargetnode,supportingparalleltransforma-
tions,toobtainthetargetnodeintheshortesttimepossible,
whileminimizingthetotalcost.
Inputformat:
-Transformationrules:Alistofdictionaries,whereeach
dictionaryrepresentsatransformationruleandcontains:
-source:Alistofsourcenodes(theprerequisitesforthe
transformation).
-target:Alistoftargetnodes(theresultofthetransfor-
mation).
-time:Thetimerequiredtocompletethetransformation
(aninteger).
-cost:Thecostassociatedwiththetransformation(an
integer).
-Initialnodes:Alistofstringsrepresentingtheavailable
nodesatthestart.
-Targetnode:Astringrepresentingthenodethatneedsto
beobtained.
Outputformat:
Andy Zhou, Kai Yan, Michal Shlapentokh-Rothman,
-Plan: Alistofsubtasks,whereeachsubtaskisaJSON
Haohan Wang, and Yu-Xiong Wang. 2024. Lan- objectwiththefollowingfields:
guageagenttreesearchunifiesreasoningactingand -name: Thenameofthesubtaskornodebeingcom-
planninginlanguagemodels. pleted.Thedefaultnameformatis"Subtask"followedby
asequencenumber.
-source:Alistofsourcenodesinvolvedinthissubtask.
The sources must be products you already have or can
obtainthroughprevioussteps.
-target: Thetargetnoderesultingfromthissubtask.
Boththesourceandtargetmustconformtoagivenrule
andcannotbeassumedorself-created.
-dependencies: Alistofdependencies(othersubtask
names)thatneedtobecompletedbeforethissubtaskcan
be executed. This ensures the execution order between
subtasks,andthedependenciesmustprovidetherequired
sourcesforthissubtask.
Important:
-ThegeneratedJSONmuststrictlyfollowtheJSONformat.
Thefollowingrulesmustbestrictlyadheredto:
-Allkeysandvaluesmustbeenclosedindoublequotes.
-Allelementsinarraysmustbeseparatedbycommas.
-AllfieldsintheJSONmustbecompleteandcorrectly
formatted,withnomissingorincorrectelements.
-Allplannedstepsmustcomplywithagivenrule.
-Allsubstancesinvolvedmustconformtothegivenrules.
YourtaskistogeneratethefinalplaninthespecifiedJSON
format,minimizingboththecompletiontimeandtotalcost.
Donotprovideanyimplementationcode.
A PromptTemplate Hereisanexampletobetterunderstandthetask:
{graph_planning_example}
Now,basedonthefollowingtransformationrules,initial
nodes,andtargetnode,pleaseprovideanoptimalplanthat
allowsthetargetnodetobeobtainedintheshortesttime
withtheminimaltotalcost,supportingparalleltransforma-
tions.
Onlyincludenecessarystepsthatarerequiredforthefastest
completionwiththeleastcost. Donotaddanyextraor
redundanttransformationsteps.
Task:
“‘json
{task}
“‘
YourtaskistogeneratethefinalplaninthespecifiedJSON
Weshowtheprompttemplatesfollowingexamples. format.Donotprovideanyimplementationcode.
12

Prompttemplateforqueryplanning Prompttemplateforextractinggraphfromquery
For the input task, please provide an optimal plan that Task:Extractstructuredtransitionrulesfromunstructured
allowsthetargettobeobtained.Minimizethecostunder workflow narratives. Objective: Identify all transitions
thepremiseoftheshortesttime. betweennodesinthetext.Foreachtransition,extract:
Projectswithoutdependenciescanbecompletedinparallel -Sourcenodes(prerequisites)
| toimproveoverallefficiency.                |     |     |     | -Targetnodes(outcomes) |     |     |     |
| ------------------------------------------ | --- | --- | --- | ---------------------- | --- | --- | --- |
| PleaseprovidethefinalsolutioninJSONformat: |     |     |     | -Time(duration)        |     |     |     |
-Plan: Alistofsubtasks,whereeachsubtaskisaJSON -Cost(numericresourceunits)
objectwiththefollowingfields: Additionally,determinetheinitial_source(startingnode)
| -name: Thenameofthesubtaskornodebeingcom- |     |     |     | andtarget(finalnode). |     |     |     |
| ----------------------------------------- | --- | --- | --- | --------------------- | --- | --- | --- |
pleted.Thedefaultnameformatis"Subtask"followedby Input: Astorydescribingaworkflowprocess. Example
| asequencenumber. |     |     |     | phrasesmayinclude: |     |     |     |
| ---------------- | --- | --- | --- | ------------------ | --- | --- | --- |
-source:Alistofsourcenodesinvolvedinthissubtask. -"From[NodeA],proceedto[NodeB]inXdaysatacost
| The sources must | be products | you already have | or can | ofYunits" |     |     |     |
| ---------------- | ----------- | ---------------- | ------ | --------- | --- | --- | --- |
obtainthroughprevioussteps. -"Whenboth[NodeA]and[NodeB]areready,[NodeC]
-target: Thetargetnoderesultingfromthissubtask. canbecompletedinXdaysatacostofYunits"
Boththesourceandtargetmustconformtoagivenrule -Shortcutslike"directlyfrom[NodeA]to[NodeC]inX
| andcannotbeassumedorself-created.               |                                  |     |     | daysatacostofYunits" |     |     |     |
| ----------------------------------------------- | -------------------------------- | --- | --- | -------------------- | --- | --- | --- |
| -dependencies:                                  | Alistofdependencies(othersubtask |     |     | Output:              |     |     |     |
| names)thatneedtobecompletedbeforethissubtaskcan |                                  |     |     | AJSONobjectwith:     |     |     |     |
be executed. This ensures the execution order between 1."rules":Alistoftransitionrules,eachcontaining:
subtasks,andthedependenciesmustprovidetherequired -"id"(sequentialintegerstartingfrom0)
sourcesforthissubtask.Hereisanexample: -"source"(listofnodeIDs,e.g.,["N1"])
| Input:               |     |     |     | -"target"(listofnodeIDs,e.g.,["N2"])                  |               |            |          |
| -------------------- | --- | --- | --- | ----------------------------------------------------- | ------------- | ---------- | -------- |
| {query_example}      |     |     |     | -"time"(numericvalue)                                 |               |            |          |
| Output:              |     |     |     | -"cost"(numericvalue)                                 |               |            |          |
| “‘json               |     |     |     | 2."initial_source":ListofstartingnodeIDs(e.g.,["N1"]) |               |            |          |
| {query_example_plan} |     |     |     | 3."target":FinalnodeID(e.g.,"N8")                     |               |            |          |
| “‘                   |     |     |     | Your Task: Convert                                    | the following | story into | the JSON |
| Input:               |     |     |     | formatabove.Ensure:                                   |               |            |          |
| {task}               |     |     |     | 1.Alltransitionsarecaptured,includingmulti-sourcede-  |               |            |          |
| Output:              |     |     |     | pendenciesandshortcuts                                |               |            |          |
| “‘                   |     |     |     | 2.NodeIDs(e.g.,N1,N2)arepreservedexactlyaswritten     |               |            |          |
3.Timeandcostvaluesarestrictlynumeric
4.FollowtheJSONschemaprecisely
ExampleInputStory:
{query_example}
ExampleOutput:
“‘json
{query_example_plan}
“‘
InputStory:
{task}
Output:
13

Prompt template for generating query from Examples
graph
graph_planning_example:
Task:
Transformthisabstracttaskintoaspecifictaskinareal-
“‘json
worldscenario,notingthefollowing:
{"rules":[{"source":["N1"],"target":["N2"],"time":3,
1.Taskswithoutdependenciescanbeexecutedinparallel.
"cost": 1},{"source": ["N6"],"target": ["N3"],"time":
2.Pleaseexpresstheinstructionsincompletenaturallan-
4,"cost":1},{"source":["N2","N3"],"target":["N4"],
guagewithoutexplicitlylistingtherules.
"time":2,"cost":1},{"source":["N4"],"target":["N5"],
3.Aslongasthereisonepaththatreachesthefinalgoal,it
"time":1,"cost":1},{"source":["N2"],"target":["N5"],
isconsideredsuccessful.
"time": 5, cost": 1 } ], "initial_source": ["N1", "N6"],
4. The source of a rule must be fully achieved before
"target":"N5"}
proceedingwiththeruleandobtainingitstarget.
“‘
5. YoumuststrictlyfollowtherulesIhavegiven,make
Expectedoutput:
suretherulesinyourstorycorrespondone-to-onewiththe
“‘json
rulesIhaveprovided,andthesumofrulesinyourstory
[{"name":"Subtask1","source":["N1"],"target":["N2"],
mustbeequaltothesumofrulesinthetask.
"dependencies": [] }, { "name": "Subtask2", "source":
6. You must explicitly mention both the time and cost
["N6"],"target":["N3"],"dependencies":[]},{"name":
associatedwitheachruleinthestory.
"Subtask3","source":["N2","N3"],"target":["N4"],"de-
7. Youonlyneedtowritetherulesasastory,withoutof-
pendencies":["Subtask1","Subtask2"]},{"name":"Sub-
feringanyadditionalevaluationcommentsorintroductory
task4","source":["N4"],"target":["N5"],"dependencies":
remarks.
["Subtask3"]}]
Hereisanexamplefromanothertaskforreference:
query_example:
Input:“‘json
Inabusyurbanconstructionproject,multiplesitesmust
{query_example_plan}
becoordinatedtobuildthe"CoreArea(N9)"asquickly
“‘
and cost-effectively as possible. The project begins at
OutPut:
threesites:"Infrastructure(N1),""Elevated(N3),"and"Res-
{query_example}
idential(N7),"eachwithdifferenttasks. The"Infrastruc-
Input:
tureArea(N1)"takes3daysandcosts1toproceedtothe
“‘json
"BridgeArea(N2)",whilethe"ElevatedArea(N3)"moves
{task}
tothe"BuildingArea(N4)"in3daysandatacostof1.
“‘
The"BridgeArea(N2)"connectstothe"RoadArea(N5)"
Output:
in4daysandcosts1,andcandirectlyconnecttothe"Fa-
cilitiesArea(N6)"in8daysatacostof1.The"Building
Area(N4)"partnerswiththe"RoadArea(N5)"tobuildthe
"FacilitiesArea(N6)"in2daysandatacostof1.The"Res-
identialArea(N7)"takes5daysandcosts1toreachthe
"CityCenterArea(N8)",whilethe"BuildingArea(N4)"
directly reaches it in 1 day and costs 1. Once the "Fa-
cilities(N6)"and"CityCenter(N8)"areasareready,they
combinetocompletethe"CoreArea(N9)"in2daysata
costof1.The"InfrastructureArea(N1)"hasashortcutto
bypassotherareasandreachthe"CoreArea(N9)"in15
daysatacostof1. Theprojectteamcanselectthemost
efficientroutebasedonresourcesandprogress.
query_example_plan: {"rules": [{ ’id’: 0, "source":
["N1"], "target": ["N2"], "time": 3, "cost": 1 }, { ’id’:
1, "source": ["N3"], "target": ["N4"], "time": 3, "cost":
1},{’id’: 2,"source": ["N2"],"target": ["N5"],"time":
4,"cost": 1},{’id’: 3,"source": ["N4","N5"],"target":
["N6"],"time":2,"cost":1},{’id’:4,"source":["N2"],
"target":["N6"],"time":8,"cost":1},{’id’:5,"source":
["N7"],"target": ["N8"],"time": 5,"cost": 1},{’id’: 6,
"source":["N4"],"target":["N8"],"time":1,"cost":1},
{’id’:7,"source":["N6","N8"],"target":["N9"],"time":
2,"cost":1},{’id’:8,"source":["N1"],"target":["N9"],
"time": 15,"cost": 1},],"initial_source": ["N1","N3",
"N7"],"target":"N9"}
“‘
B TextualQueryStatistics
Figure4showsthestatisticsonoursyntheticquery
data.
14

|     |     |     |     |     |     | D   | EdgevariationStatus |     |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ------------------- | --- | --- | --- | --- | --- | --- |
Figure4:Statisticsonoursyntheticquery.Thebarchart
| ontheleftdisplaysthedistributionoftokens. |     |     |     |     | Thepie |     |     |     |     |     |     |     |     |
| ----------------------------------------- | --- | --- | --- | --- | ------ | --- | --- | --- | --- | --- | --- | --- | --- |
chartontherightshowsthetopicdistribution.
C TrainningSetups
| Training | is performed | using | the | LLaMa | Factory |     |     |     |     |     |     |     |     |
| -------- | ------------ | ----- | --- | ----- | ------- | --- | --- | --- | --- | --- | --- | --- | --- |
(Zhengetal.,2024)framework.
InSFTdatawithoutmixup,foragraphG,thein-
|                                  |     |     |     |        |     | Figure5: | ClaudeandourtrainedLlamaperformance |      |         |     |              |      |        |
| -------------------------------- | --- | --- | --- | ------ | --- | -------- | ----------------------------------- | ---- | ------- | --- | ------------ | ---- | ------ |
| putsandoutputsareobtainedas(x,y) |     |     |     | = (G,p | );  |          |                                     |      |         |     |              |      |        |
|                                  |     |     |     |        | opt | across   | different                           | edge | counts. |     | The vertical | axis | repre- |
withmixup,forG,theinputsandoutputsinclude
sentscorrespondingnumberofcasesofeachstate(fail,
both(x,y) = (G,p opt )and(G,p second ). ForDPO feasible, optimal). The horizontal axis represents the
| data, the | input x, chosen  |     | output | y and  | rejected |                                           |     |     |     |     |     |     |     |
| --------- | ---------------- | --- | ------ | ------ | -------- | ----------------------------------------- | --- | --- | --- | --- | --- | --- | --- |
|           |                  |     |        | w      |          | numberofedgessegmentedatcertainintervals. |     |     |     |     |     |     |     |
| outputy   | arederivedas(G,p |     | ,p     | ).     |          |                                           |     |     |     |     |     |     |     |
|           | l                |     | opt    | second |          |                                           |     |     |     |     |     |     |     |
ThetraininglossfunctionofSFTisdefinedas
|     |     |     |     |     |     | E   | QueryExample |     |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ------------ | --- | --- | --- | --- | --- | --- |
follows:
Aqueryandcorrespondingplaninareal-lifesce-
|y|
narioisshowninA.
|       | −E      |     | (cid:88) |         |     |     |                               |     |     |     |     |     |     |
| ----- | ------- | --- | -------- | ------- | --- | --- | ----------------------------- | --- | --- | --- | --- | --- | --- |
| L (θ) | =       |     | logP     | (y |x,y | ).  |     |                               |     |     |     |     |     |     |
| SFT   | (x,y)∼D | SFT |          | θ t     | <t  |     |                               |     |     |     |     |     |     |
|       |         |     |          |         |     | F   | SupplementaryoftheExperiments |     |     |     |     |     |     |
t=1
(12)
Tabel7and8showtheabsolutevalueofcorrelation
ThetraininglossfunctionofDPOisdefinedas
coefficientsandslopesofnormalizedfourmetrics
follows:
withchangesinthenumberofnodesandedges.
Metricsarescaledto[0,1]rangeusingmin-max
| L   | = −E |             |     |     |     | normalization: |     |     |     |     |     |     |     |
| --- | ---- | ----------- | --- | --- | --- | -------------- | --- | --- | --- | --- | --- | --- | --- |
|     | DPO  | (x,yw,y )∼D |     |     |     |                |     |     |     |     |     |     |     |
l DPO
|     |      | (cid:18) (cid:18) |       |          |      |     |     |      |     |     |     |     |      |
| --- | ---- | ----------------- | ----- | -------- | ---- | --- | --- | ---- | --- | --- | --- | --- | ---- |
|     |      |                   | π θ   | (y w |x) |      |     |     |      |     | y−y |     |     |      |
|     | logσ | β log             |       |          |      |     |     | y    | =   |     | min |     | (14) |
|     |      |                   |       |          | (13) |     |     | norm |     |     |     |     |      |
|     |      |                   | π ref | (y w |x) |      |     |     |      |     | y   | −y  |     |      |
|     |      |                   |       |          |      |     |     |      |     | max | min |     |      |
(cid:19)(cid:19)
π θ (y l |x)
|     | −log |     |     | .   |     | wherey | representsraw |     |     | valuesof: | node | andedge |     |
| --- | ---- | --- | --- | --- | --- | ------ | ------------- | --- | --- | --------- | ---- | ------- | --- |
π ref (y l |x)
|     |     |     |     |     |     | counts, | success |     | counts, | optimal | counts, | average |     |
| --- | --- | --- | --- | --- | --- | ------- | ------- | --- | ------- | ------- | ------- | ------- | --- |
timeratios,andaveragecostratios.
| The | detailed hyperparameter |     |     | settings | are out- |     |         |             |     |              |     |             |     |
| --- | ----------------------- | --- | --- | -------- | -------- | --- | ------- | ----------- | --- | ------------ | --- | ----------- | --- |
|     |                         |     |     |          |          |     | Pearson | correlation |     | coefficients |     | (r) between |     |
linedinTable
|     |     |     |     |     |     | node | and | edge | counts | (X) | and metrics | (Y) | are |
| --- | --- | --- | --- | --- | --- | ---- | --- | ---- | ------ | --- | ----------- | --- | --- |
calculatedas:
| Name      |     |     |     | Value |     |     |     |                    |           |           |                    |       |     |
| --------- | --- | --- | --- | ----- | --- | --- | --- | ------------------ | --------- | --------- | ------------------ | ----- | --- |
|           |     |     |     |       |     |     |     |                    | (cid:80)n | (x −x¯)(y | −y¯)               |       |     |
| cutofflen |     |     |     | 8,192 |     |     |     |                    | i=1       | i         | i                  |       |     |
|           |     |     |     |       |     |     | r = |                    |           |           |                    |       | .   |
|           |     |     |     |       |     |     | XY  | (cid:112)(cid:80)n |           | −x¯)2     | (cid:112)(cid:80)n | −y¯)2 |     |
| epochs    |     |     |     | 10    |     |     |     |                    | (x i      |           |                    | (y i  |     |
|           |     |     |     |       |     |     |     | i=1                |           |           | i=1                |       |     |
(15)
| batchsizeperdevice |     |     |     | 1   |     |     |     |     |     |     |     |     |     |
| ------------------ | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
gradientaccumulationsteps 4 The slope (m) of the best-fit line is computed
usinglinearregression:
| learningrate    |                                  |     |     | 1e-6   |     |     |            |            |          |      |                   |     |      |
| --------------- | -------------------------------- | --- | --- | ------ | --- | --- | ---------- | ---------- | -------- | ---- | ----------------- | --- | ---- |
| lrschedulertype |                                  |     |     | cosine |     |     |            |            | (cid:80) |      | (cid:80) (cid:80) |     |      |
|                 |                                  |     |     |        |     |     |            |            | n x      | y −  | x                 | y   |      |
| warmupratio     |                                  |     |     | 0.1    |     |     |            | m =        |          | i i  | i                 | i . | (16) |
|                 |                                  |     |     |        |     |     |            |            | (cid:80) | x2−( | (cid:80)          |     |      |
|                 |                                  |     |     |        |     |     |            |            | n        |      | x )2              |     |      |
| bf16            |                                  |     |     | true   |     |     |            |            |          | i    | i                 |     |      |
|                 |                                  |     |     |        |     |     | Allresults | arerounded |          | to2  | decimalplaces     |     | for  |
| Table6:         | Detailedtraininghyperparameters. |     |     |        |     |     |            |            |          |      |                   |     |      |
finalreporting.
15

|     |     |     | SuccessRate |     | OptimalRate |     | TimeRatio | CostRatio |
| --- | --- | --- | ----------- | --- | ----------- | --- | --------- | --------- |
Model
|                 |     |     | r     | m     | r     | m     | r m       | r m       |
| --------------- | --- | --- | ----- | ----- | ----- | ----- | --------- | --------- |
| Claude3.5Sonnet |     |     | -0.96 | -0.99 | -0.82 | -0.82 | 0.92 1.02 | 0.94 0.99 |
| GPT-4o          |     |     | -0.99 | -1.02 | -0.94 | -0.97 | 0.99 1.09 | 0.98 1.1  |
Llama-3.1-8B-Instruct -0.95 -0.96 -0.95 -1.01 0.79 0.92 0.93 0.97
Llama-3.1-8B-Instruct-Trained -0.94 -1.04 -0.89 -0.86 0.94 1.04 0.93 1.0
Qwen2.5-7B-Instruct -0.96 -0.98 -0.96 -0.95 0.96 0.97 0.66 0.66
Qwen2.5-7B-Instruct-Trained -0.99 -0.98 -0.80 -0.82 0.81 0.76 0.96 0.98
Table7: Correlationcoefficients(r)andslopes(m)betweenmetricsandnodecounts.
|       |     |           |     | SuccessRate |      | OptimalRate | TimeRatio       | CostRatio |
| ----- | --- | --------- | --- | ----------- | ---- | ----------- | --------------- | --------- |
| Model |     | NodeCount |     |             |      |             |                 |           |
|       |     |           |     | r           | m    | r           | m r             | m r m     |
|       |     | 10        |     | 0.27        | 0.15 | -0.44       | -0.28 0.50 0.26 | 0.43 0.23 |
Claude3.5Sonnet
|     |     | 30  |     | -0.74 | -0.56 | -0.71 | -0.55 0.81 0.59 | 0.78 0.59 |
| --- | --- | --- | --- | ----- | ----- | ----- | --------------- | --------- |
|     |     | 10  |     | 0.05  | 0.03  | -0.28 | -0.17 0.58 0.34 | 0.45 0.24 |
Llama-3.1-8B-Instruct-Trained
|     |     | 30  |     | -0.39 | -0.29 | -0.62 | -0.37 0.45 0.34 | 0.60 0.43 |
| --- | --- | --- | --- | ----- | ----- | ----- | --------------- | --------- |
Table8: Correlations(r)andslopes(m)betweenedgevariationsandmetricswithnodecounts.
| For a given    | plan P composed       | of  | sub           | plans p, |     |     |     |     |
| -------------- | --------------------- | --- | ------------- | -------- | --- | --- | --- | --- |
| the time ratio | of parallel execution |     | to sequential |          |     |     |     |     |
executioncanbecalculatedas:
Ω (P)
time
|     | Ratio = | .   |     | (17) |     |     |     |     |
| --- | ------- | --- | --- | ---- | --- | --- | --- | --- |
(cid:80) τ
p
p∈P
16
<!-- 出典: https://arxiv.org/pdf/2502.14563 | 取得日: 2026-07-15 | 取得方法: MarkItDown（PDF、bytes確認） | 確度: 中（2025年論文。synthetic graphから実project計画への外挿は未実証） -->
