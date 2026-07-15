|     |     | An  | LLM | Compiler |     | for | Parallel | Function |     | Calling |     |     |     |
| --- | --- | --- | --- | -------- | --- | --- | -------- | -------- | --- | ------- | --- | --- | --- |
SehoonKim*1 SuhongMoon*1 RyanTabrizi1 NicholasLee1 MichaelW.Mahoney123
|     |     |     |     |     | KurtKeutzer1 |     | AmirGholami12 |     |     |     |     |     |     |
| --- | --- | --- | --- | --- | ------------ | --- | ------------- | --- | --- | --- | --- | --- | --- |
Abstract
Kojimaetal.,2023;Wangetal.,2023b;Weietal.,2022;
The reasoning capabilities of the recent LLMs Yang et al., 2022; Yao et al., 2023b; Zhou et al., 2023b);
andrecentworkshavealsoshownhowthisreasoningca-
| enable | them to | execute | external | function |     | calls |     |     |     |     |     |     |     |
| ------ | ------- | ------- | -------- | -------- | --- | ----- | --- | --- | --- | --- | --- | --- | --- |
4202 nuJ 5  ]LC.sc[  3v11540.2132:viXra
to overcome their inherent limitations, such as pabilitycanbehelpfulinimprovingaccuracyforsolving
complexandlogicaltasks.Thereasoningcapabilityhasalso
knowledgecutoffs,poorarithmeticskills,orlack
allowedfunction(i.e.,tool)callingcapability,whereLLMs
| ofaccesstoprivatedata. |     |     | Thisdevelopmenthas |     |     |     |     |     |     |     |     |     |     |
| ---------------------- | --- | --- | ------------------ | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
allowedLLMstoselectandcoordinatemultiple caninvokeprovidedfunctionsandusethefunctionoutputs
|           |       |        |         |           |      |     | tohelpcompletetheirtasks. |     |     | Thesefunctionsrangefroma |     |     |     |
| --------- | ----- | ------ | ------- | --------- | ---- | --- | ------------------------- | --- | --- | ------------------------ | --- | --- | --- |
| functions | based | on the | context | to tackle | more |     |                           |     |     |                          |     |     |     |
complex problems. However, current methods simplecalculatorthatcaninvokearithmeticoperationsto
morecomplexLLM-basedfunctions.
| for function | calling |        | often    | require  | sequential |     |     |     |     |     |     |     |     |
| ------------ | ------- | ------ | -------- | -------- | ---------- | --- | --- | --- | --- | --- | --- | --- | --- |
| reasoning    | and     | acting | for each | function | which      |     |     |     |     |     |     |     |     |
TheabilityofLLMstointegratevarioustoolsandfunction
| can result | in high | latency, | cost, | and | sometimes |     |     |     |     |     |     |     |     |
| ---------- | ------- | -------- | ----- | --- | --------- | --- | --- | --- | --- | --- | --- | --- | --- |
callscouldenableafundamentalshiftinhowwedevelop
inaccuratebehavior.Toaddressthis,weintroduce LLM-basedsoftware. However,thisbringsupanimportant
LLMCompiler,whichexecutesfunctionsinpar-
|     |     |     |     |     |     |     | challenge: | whatisthemosteffectiveapproachtoincorpo- |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ---------- | ---------------------------------------- | --- | --- | --- | --- | --- |
allel to efficiently orchestrate multiple function ratemultiplefunctioncalls? Anotableapproachhasbeen
calls. Drawinginspirationfromtheprinciplesof
introducedinReAct(Yaoetal.,2022),wheretheLLMcalls
classicalcompilers,LLMCompilerenablespar-
afunction,analyzestheoutcomes,andthenreasonsabout
allelfunctioncallingwiththreecomponents: (i)a thenextaction,whichinvolvesasubsequentfunctioncall.
FunctionCallingPlanner,formulatingexecution
ForasimpleexampleillustratedinFig.1(Left),wherethe
| plans for | function | calling; | (ii) | a Task | Fetching |     |     |     |     |     |     |     |     |
| --------- | -------- | -------- | ---- | ------ | -------- | --- | --- | --- | --- | --- | --- | --- | --- |
LLMisaskedifScottDerricksonandEdWoodhavethe
Unit,dispatchingfunctioncallingtasks;and(iii)
samenationality,ReActinitiallyanalyzesthequeryandde-
| an Executor, | executing |     | these | tasks | in parallel. |     |     |     |     |     |     |     |     |
| ------------ | --------- | --- | ----- | ----- | ------------ | --- | --- | --- | --- | --- | --- | --- | --- |
cidestouseasearchtooltosearchforScottDerrickson.The
LLMCompilerautomaticallygeneratesanopti- resultofthissearch(i.e.,observation)isthenconcatenated
mizedorchestrationforthefunctioncallsandcan
|     |     |     |     |     |     |     | back | to the original | prompt | for | the LLM | to reason | about |
| --- | --- | --- | --- | --- | --- | --- | ---- | --------------- | ------ | --- | ------- | --------- | ----- |
beusedwithbothopen-sourceandclosed-source
thenextaction,whichinvokesanothersearchtooltogather
| models.          | WehavebenchmarkedLLMCompiler |                            |           |          |     |     | informationaboutEdWood. |          |              |            |      |          |          |
| ---------------- | ---------------------------- | -------------------------- | --------- | -------- | --- | --- | ----------------------- | -------- | ------------ | ---------- | ---- | -------- | -------- |
| on a range       | of                           | tasks with                 | different | patterns |     | of  |                         |          |              |            |      |          |          |
|                  |                              |                            |           |          |     |     | ReAct                   | has been | a pioneering | work       | in   | enabling | function |
| functioncalling. |                              | Weobserveconsistentlatency |           |          |     |     |                         |          |              |            |      |          |          |
|                  |                              |                            |           |          |     |     | calling,                | and      | it has been  | integrated | into | several  | frame-   |
| speedup          | of up                        | to 3.7×,                   | cost      | savings  | of  | up  |                         |          |              |            |      |          |          |
to 6.7×, and accuracy improvement of up to works (Langchain; Liu, 2022). However, scaling this ap-
proachformorecomplexapplicationsrequiresconsiderable
∼9%comparedtoReAct.Ourcodeisavailableat
https://github.com/SqueezeAILab/LLMCompiler. optimizations. ThisisduetothesequentialnatureofRe-
Act,whereitexecutesfunctioncallsandreasonsabouttheir
|     |     |     |     |     |     |     | observationsoneaftertheother. |     |     |     | Thisapproach,alongwith |     |     |
| --- | --- | --- | --- | --- | --- | --- | ----------------------------- | --- | --- | --- | ---------------------- | --- | --- |
1.Introduction
theagentsystemsthatextendReAct(Khotetal.,2023;Qin
RecentadvancesinthereasoningcapabilityofLargeLan- etal.,2023;Ruanetal.,2023b;Sumersetal.,2023;Yao
guageModels(LLMs)haveexpandedtheapplicabilityof
etal.,2023b),mayleadtoinefficienciesinlatencyandcost,
LLMsbeyondcontentgenerationtosolvingcomplexprob-
duetothesequentialfunctioncallingandrepetitiveLLM
lems(Bestaetal.,2023;Chenetal.,2023b;Gaoetal.,2022; invocationsforeachreasoningandactionstep.Furthermore,
*Equalcontribution 1UCBerkeley2ICSI3LBNL.Correspon- whiledynamicreasoningabouttheobservationshasbenefits
incertaincases,concatenatingtheoutcomesofintermedi-
denceto:AmirGholami<amirgh@berkeley.edu>.
atefunctioncallscoulddisrupttheLLM’sexecutionflow,
41st
Proceedings of the International Conference on Machine potentiallyreducingaccuracy(Xuetal.,2023). Common
Learning,Vienna,Austria.PMLR235,2024.Copyright2024by failurecasesincluderepetitiveinvocationofthesamefunc-
theauthor(s).
1

AnLLMCompilerforParallelFunctionCalling
Question: Were Scott Derrickson and Ed Wood of the same nationality?
|     |                                             |     | ReAct |     |     |     |                               |                          | LLMCompiler |     |     |     |     |
| --- | ------------------------------------------- | --- | ----- | --- | --- | --- | ----------------------------- | ------------------------ | ----------- | --- | --- | --- | --- |
|     |                                             |     |       | LLM |     |     |                               | Function Calling Planner |             |     |     |     |     |
|     | Thought: I need to search Scott Derrickson. |     |       |     |     |     | $1 = search(Scott Derrickson) |                          |             |     |     |     |     |
Action: search(Scott Derrickson) $2 = search(Ed Wood) DAG of tasks
|     |     |     |             | Tool invocation |     |     |             | Parallel tool invocations |     |     |             |     |     |
| --- | --- | --- | ----------- | --------------- | --- | --- | ----------- | ------------------------- | --- | --- | ----------- | --- | --- |
|     |     |     | Search Tool |                 |     |     | Search Tool |                           |     |     | Search Tool |     |     |
Observation: … Scott Derrickson (born July 16, 1966)  Observation: … Scott Derrickson (born July  Observation: … Edward Wood Jr was an
is an American filmmaker … 16, 1966) is an American filmmaker … American filmmaker, actor, and …
Appended to prompt
|     |     |     |     | LLM |     |     |     |     | LLM |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
p
e Thought: I need to search Ed Wood. Thought: They are both American filmmakers.
t S
|     | Action: search(Ed Wood) |     |     |     |     | Executor | Action: finish(yes) |     |     |     |     |     |     |
| --- | ----------------------- | --- | --- | --- | --- | -------- | ------------------- | --- | --- | --- | --- | --- | --- |
Tool invocation
Search Tool
Observation: … Edward Wood Jr was an American
filmmaker, actor, and ….
Latency Speedup: 1.8x
Appended to prompt
LLM
Thought: They are both American filmmakers.
Action: finish(yes)
Figure1.AnillustrationoftheruntimedynamicsofLLMCompiler,incomparisonwithReAct(Yaoetal.,2022),givenasample
questionfromtheHotpotQAbenchmark(Yangetal.,2018). InLLMCompiler(Right),thePlannerfirstdecomposesthequeryinto
severaltaskswithinter-dependencies. TheExecutorthenexecutesmultipletasksinparallel,respectingtheirdependencies. Finally,
LLMCompilerjoinsallobservationsfromthetoolexecutionstoproducethefinalresponse.Incontrast,sequentialtoolexecutionofthe
existingframeworkslikeReAct(Left)leadstolongerexecutionlatency.Inthisexample,LLMCompilerattainsalatencyspeedupof
1.8×ontheHotpotQAbenchmark.Whilea2-wayparallelizablequestionfromHotpotQAispresentedhereforthesakeofsimplevisual
illustration,LLMCompileriscapableofmanagingtaskswithmorecomplexdependencypatterns(Fig.2andSec.5).
tion, which is also highlighted in the original paper (Yao FetchingUnit(Sec.3.2)thatdispatchesthefunctioncalls
etal.,2022),andearlystoppingbasedonthepartialinter- inparallel;(iii)anExecutor(Sec.3.3)thatexecutesthe
mediateresults,aswillbefurtherdiscussedinSec.5.1and dispatchedtasksusingtheassociatedfunctions.
AppendixA.
• WeevaluateLLMCompileronembarrassinglyparallel
| To address |     | this challenge, |     | we draw inspiration |     | from clas- |     |     |     |     |     |     |     |
| ---------- | --- | --------------- | --- | ------------------- | --- | ---------- | --- | --- | --- | --- | --- | --- | --- |
patternsusingHotpotQA(Yangetal.,2018)andMovie
| sical | compilers, | where | optimizing | instruction |     | executions |     |     |     |     |     |     |     |
| ----- | ---------- | ----- | ---------- | ----------- | --- | ---------- | --- | --- | --- | --- | --- | --- | --- |
Recommendation(Srivastavaetal.,2022),whereweob-
intraditionalprogramminglanguageshasbeenextensively
serve1.80×/3.74×speedupand3.37×/6.73×costreduc-
| explored. |     | A key | optimization | technique | in compilers | in- |     |     |     |     |     |     |     |
| --------- | --- | ----- | ------------ | --------- | ------------ | --- | --- | --- | --- | --- | --- | --- | --- |
tioncomparedtoReAct(Sec.5.1).
volvesidentifyinginstructionsthatcanbeexecutedinparal-
| lelandeffectivelymanagingtheirdependencies. |              |     |             |          |         | Similarly, |           |                 |     |     |              |           |     |
| ------------------------------------------- | ------------ | --- | ----------- | -------- | ------- | ---------- | --------- | --------------- | --- | --- | ------------ | --------- | --- |
|                                             |              |     |             |          |         |            | • To test | the performance |     | on  | more complex | patterns, | we  |
| one                                         | can envision |     | a compiler, | tailored | for LLM | function   |           |                 |     |     |              |           |     |
introduceanewbenchmarkcalledParallelQAwhichin-
calling,whichcanefficientlyorchestratevariousfunction
|                            |     |     |     |                           |     |     | cludes | various | non-trival | function | calling | patterns. | We  |
| -------------------------- | --- | --- | --- | ------------------------- | --- | --- | ------ | ------- | ---------- | -------- | ------- | --------- | --- |
| callsandtheirdependencies. |     |     |     | Thissharesasimilarphilos- |     |     |        |         |            |          |         |           |     |
showupto2.27×speedup,4.65×costreduction,and9%
| ophy | with | the recent | studies | that align | LLMs | with com- |     |     |     |     |     |     |     |
| ---- | ---- | ---------- | ------- | ---------- | ---- | --------- | --- | --- | --- | --- | --- | --- | --- |
puter systems (Karpathy, 2023; Packer et al., 2023). To improvedaccuracycomparedtoReAct(Sec.5.2).
thisend,weintroduceLLMCompiler,anovelframework
WeevaluateLLMCompiler’scapabilityindynamicre-
| thatenablesparallelmulti-toolexecutionofLLMsacross |     |     |     |                      |     |     | •         |       |     |          |         |            |      |
| -------------------------------------------------- | --- | --- | --- | -------------------- | --- | --- | --------- | ----- | --- | -------- | ------- | ---------- | ---- |
|                                                    |     |     |     |                      |     |     | planning, | which | is  | achieved | through | a feedback | loop |
| differentmodelsandworkloads.                       |     |     |     | Tothebestofourknowl- |     |     |           |       |     |          |         |            |      |
fromtheExecutorbacktoourFunctionCallingPlanner.
| edge, | LLMCompiler |     | is  | the first framework |     | to optimize |     |     |     |     |     |     |     |
| ----- | ----------- | --- | --- | ------------------- | --- | ----------- | --- | --- | --- | --- | --- | --- | --- |
theorchestrationofLLMfunctioncallingthatcannotonly FortheGameof24(Yaoetal.,2023b),whichrequires
|     |     |     |     |     |     |     | repeated | replanning |     | based | on the intermediate |     | results, |
| --- | --- | --- | --- | --- | --- | --- | -------- | ---------- | --- | ----- | ------------------- | --- | -------- |
improvelatencyandcost,butalsoaccuracy,byminimizing
|     |     |     |     |     |     |     | LLMCompiler |     |     |     | 2×  |     |     |
| --- | --- | --- | --- | --- | --- | --- | ----------- | --- | --- | --- | --- | --- | --- |
interferencefromtheoutputsofintermediatefunctioncalls. demonstrates a speedup compared
toTree-of-Thoughts(Sec.5.3).
Inmoredetail,wemakethefollowingcontributions:
• We introduce LLMCompiler, an LLM compiler that • WeshowthatLLMCompilercanexploretheinteractive
optimizes the parallel function calling performance of decision-makingenvironmenteffectivelyandefficiently.
LLMs. Atahighlevel, thisisachievedbyintroducing On WebShop, LLMCompiler achieves up to 101.7×
three key components: (i) a Function Calling Planner speedupand25.7%improvedsuccessratecomparedto
(Sec. 3.1) that identifies an execution flow; (ii) a Task thebaselines(Sec.5.4).
2

AnLLMCompilerforParallelFunctionCalling
2.RelatedWork each optimized through LLMs with dedicated prompts.
Step-BackPrompting(Zhengetal.,2023)enablesLLMsto
2.1.LatencyOptimizationinLLMs
abstracthigh-levelconceptsfromdetailstoenhancereason-
Various studies have focused on optimizing model de- ingabilitiesacrossvarioustasks. Plan-and-SolvePrompt-
|     |     |     |     |     |     |     | ing (Wang | et al., 2023a) | segments multi-step | reasoning |
| --- | --- | --- | --- | --- | --- | --- | --------- | -------------- | ------------------- | --------- |
sign(Chenetal.,2023a;Dettmersetal.,2023;Frantar&
Alistarh,2023;Frantaretal.,2022;Kimetal.,2023;2024; tasks into subtasks to minimize errors and improve task
|     |     |     |     |     |     |     | accuracywithoutmanualprompting. |     | However,thesemeth- |     |
| --- | --- | --- | --- | --- | --- | --- | ------------------------------- | --- | ------------------ | --- |
Kwonetal.,2022;Leviathanetal.,2023;Linetal.,2023)
andsystems(tgi;trt;Kwonetal.,2023;Yuetal.,2022)for odsprimarilyfocusonimprovingtheaccuracyofreasoning
efficientLLMinference. Optimizationsattheapplication benchmarks. In contrast, LLMCompiler uses a planner
toidentifyparallelizablepatternswithinqueries,aimingto
level,however,arelessexplored.Thisiscriticalfromaprac-
ticalpointofviewforsituationsinvolvingblack-boxLLM reducelatencywhilemaintainingaccuracy.
modelsandserviceswheremodificationstothemodelsand In addition to the aforementioned works, TPTU (Ruan
theunderlyinginferencepipelinearehighlyrestricted.
|     |     |     |     |     |     |     | et al., 2023a), | HuggingGPT | (Shen et | al., 2023), and |
| --- | --- | --- | --- | --- | --- | --- | --------------- | ---------- | -------- | --------------- |
ViperGPT(Sur´ısetal.,2023)haveintroducedend-to-end
Skeleton-of-Thought(Ningetal.,2023)recentlyproposed
LLMCompiler
toreducelatencythroughapplication-levelparalleldecod- plan-and-solve frameworks. sets itself
ing. Thismethodinvolvesatwo-stepprocessofaninitial apart by providing a general framework that enables ef-
ficientandaccuratefunctioncallinginabroaderrangeof
skeletongenerationphase,followedbyparallelexecution
of skeleton items. However, it is primarily designed for problems. ThisstemsfromLLMCompiler’scapabilities
in(i)planningandreplanning;(ii)parallelexecution;and
| embarrassingly |     | parallel workloads |     | and does | not support |     |     |     |     |     |
| -------------- | --- | ------------------ | --- | -------- | ----------- | --- | --- | --- | --- | --- |
(iii)addressingawiderrangeofproblemdomains,which
| problems | that have | inherently | interdependent |     | tasks, | as it |     |     |     |     |
| -------- | --------- | ---------- | -------------- | --- | ------ | ----- | --- | --- | --- | --- |
assumes no dependencies between skeleton tasks. This willbediscussedinmoredetailinAppendixF.
limits its applicability in complex scenarios such as cod- AnothernotableworkisReWOO(Xuetal.,2023)which
ing(Austinetal.,2021;Chenetal.,2021;Hendrycksetal.,
employsaplannertoseparatethereasoningprocessfromthe
| 2021a; Madaan |     | et al., 2023) | or math | (Hendrycks |     | et al., |     |     |     |     |
| ------------- | --- | ------------- | ------- | ---------- | --- | ------- | --- | --- | --- | --- |
executionandobservationphasestodecreasetokenusage
2021b;c)problems,asalsostatedinthepaper(Ningetal.,
|                    |     |           |     |         |             |     | andcostascomparedtoReAct.   |     | Ourapproachisdifferent |     |
| ------------------ | --- | --------- | --- | ------- | ----------- | --- | --------------------------- | --- | ---------------------- | --- |
| 2023). LLMCompiler |     | addresses |     | this by | translating | an  |                             |     |                        |     |
|                    |     |           |     |         |             |     | fromReWOOinmultipleaspects. |     | First,LLMCompiler      |     |
inputqueryintoaseriesoftaskswithinter-dependencies, allowsparallelfunctioncallingwhichcanreducelatency
therebyexpandingthespectrumofproblemsitcanhandle.
|     |     |     |     |     |     |     | aswellascost. | Second,LLMCompilersupportsdynamic |     |     |
| --- | --- | --- | --- | --- | --- | --- | ------------- | --------------------------------- | --- | --- |
replanningwhichisimportantforproblemswhoseexecu-
Concurrentlytoourwork,OpenAIhasrecentlyintroduced
aparallelfunctioncallingfeatureintheir1106release,en- tionflowcannotbedeterminedstaticallyinthebeginning
| hancing user                                    | query | processing | through | the | simultaneous |     | (Sec.5.3). |     |     |     |
| ----------------------------------------------- | ----- | ---------- | ------- | --- | ------------ | --- | ---------- | --- | --- | --- |
| generationofmultiplefunctioncalls(OpenAI,2023). |       |            |         |     |              | De- |            |     |     |     |
spite its potential for reducing LLM execution time, this 2.3.Tool-AugmentedLLMs
| feature has       | certain | limitations, | as      | it is exclusively |       | avail- |              |                      |         |             |
| ----------------- | ------- | ------------ | ------- | ----------------- | ----- | ------ | ------------ | -------------------- | ------- | ----------- |
|                   |         |              |         |                   |       |        | The enhanced | reasoning capability | of LLMs | has enabled |
| able for OpenAI’s |         | proprietary  | models. | However,          | there | is     |              |                      |         |             |
themtoinvokeuser-providedfunctionsandusetheiroutputs
| a growing         | demand | for using | open-source    |     | models  | driven |                             |     |                           |     |
| ----------------- | ------ | --------- | -------------- | --- | ------- | ------ | --------------------------- | --- | ------------------------- | --- |
|                   |        |           |                |     |         |        | toeffectivelycompletetasks. |     | Detailedexplorationofthis |     |
| by the increasing |        | number    | of open-source |     | LLMs as | well   |                             |     |                           |     |
subjectisprovidedintheAppendixC.1.
asparameter-efficienttrainingtechniques(Houlsbyetal.,
2019;Huetal.,2022;Lesteretal.,2021)forfinetuningand
3.Methodology
| customization. |         | LLMCompiler     | enables | efficient | parallel  |       |     |     |     |     |
| -------------- | ------- | --------------- | ------- | --------- | --------- | ----- | --- | --- | --- | --- |
| function       | calling | for open-source | models, |           | and also, | as we |     |     |     |     |
ToillustratethecomponentsofLLMCompiler,weusea
| willshowlaterinSec.5, |     |     | itcanpotentiallyachievebetter |     |     |     |                                    |     |              |     |
| --------------------- | --- | --- | ----------------------------- | --- | --- | --- | ---------------------------------- | --- | ------------ | --- |
|                       |     |     |                               |     |     |     | simple2-wayparallelexampleinFig.2. |     | Toanswer“How |     |
latencyandcost.
muchdoesMicrosoft’smarketcapneedtoincreasetoex-
ceedApple’smarketcap?,”theLLMfirstneedstoconduct
2.2.PlanandSolveStrategy
websearchesforbothcompanies’marketcaps,followedby
|     |     |     |     |     |     |     | adivisionoperation. | Whiletheexistingframeworks,includ- |     |     |
| --- | --- | --- | --- | --- | --- | --- | ------------------- | ---------------------------------- | --- | --- |
Severalstudies(Haoetal.,2023;Pateletal.,2022;Press
etal.,2023;Wolfsonetal.,2020;Zhouetal.,2023b)have ingReAct,performthesetaskssequentially,itisevidentthat
|          |           |         |             |     |              |     | theycanbeexecutedinparallel. |     | Thekeyquestionishowto |     |
| -------- | --------- | ------- | ----------- | --- | ------------ | --- | ---------------------------- | --- | --------------------- | --- |
| explored | prompting | methods | of breaking |     | down complex |     |                              |     |                       |     |
queriesintovariouslevelsofdetailtosolvethem,thereby automaticallydeterminewhichtasksareparallelizableand
improvingLLM’sperformanceinreasoningtasks. Specif- whichareinterdependent,sowecanorchestratetheexecu-
|     |     |     |     |     |     |     | tionofthedifferenttasksaccordingly. |     | LLMCompilerac- |     |
| --- | --- | --- | --- | --- | --- | --- | ----------------------------------- | --- | -------------- | --- |
ically,DecomposedPrompting(Khotetal.,2023)tackles
complextasksbydecomposingthemintosimplersub-tasks, complishesthisthroughasystemthatconsistsofthefollow-
3

AnLLMCompilerforParallelFunctionCalling
Executor
|     |            |     | Function Calling Planner |     |     |       |     | Tool | Tool |     |
| --- | ---------- | --- | ------------------------ | --- | --- | ----- | --- | ---- | ---- | --- |
|     | User Input |     |                          |     |     | Task  |     |      |      |     |
Fetches
|     |                 |     |                                   |     | Fetching  |     |      | Memory | Memory |     |
| --- | --------------- | --- | --------------------------------- | --- | --------- | --- | ---- | ------ | ------ | --- |
|     | “How much does  |     | $1 = search(Microsoft Market Cap) |     |           |     | Task |        |        |     |
Unit
Microsoft's market cap  $2 = search(Apple Market Cap) Tool Tool
|     | need to increase to exceed  |     | $3 = math($1 / $2) |     |     |     | Resolves  |     |     |     |
| --- | --------------------------- | --- | ------------------ | --- | --- | --- | --------- | --- | --- | --- |
Memory
|     | Apple's market cap?” |     | $4 = llm($3) |     |     |     | Dependency | Memory |     |     |
| --- | -------------------- | --- | ------------ | --- | --- | --- | ---------- | ------ | --- | --- |
DAG of Tasks
Tools
|     |     |     |     |     |     |     |     | search math | … llm |     |
| --- | --- | --- | --- | --- | --- | --- | --- | ----------- | ----- | --- |
Figure2.Overview of the LLMCompiler framework. The Function Calling Planner generates a DAG of tasks with their inter-
dependencies.ThesetasksarethendispatchedbytheTaskFetchingUnittotheExecutorinparallelbasedontheirdependencies.Inthis
example,Task$1and$2arefetchedtogetherforparallelexecutionoftwoindependentsearchtasks.Aftereachtaskisperformed,the
resultsareforwardedbacktotheTaskFetchingUnittounblockthedependenttasksafterreplacingtheirplaceholdervariables(e.g.,the
variable$1and$2inTask$3)withactualvalues.Oncealltaskshavebeenexecuted,thefinalanswerisdeliveredtotheuser.
ingthreecomponents: aFunctionCallingPlanner(Sec.3.1) streamstasksassoonastheyarecreated,insteadofwaiting
thatgeneratesasequenceoftasksandtheirdependencies;a tocompletetheentireplanningprocess.
TaskFetchingUnit(Sec.3.2)thatreplacesargumentsbased
onintermediateresultsandfetchesthetasks;andanExecu- 3.2.TaskFetchingUnit
tor(Sec.3.3)thatexecutesthetaskswithassociatedtools.
TouseLLMCompiler,usersareonlyrequiredtoprovide TheTaskFetchingUnit,inspiredbytheinstructionfetching
unitsinmoderncomputerarchitectures,fetchestaskstothe
| tool | definitions, | and optional | in-context examples | for | the |     |     |     |     |     |
| ---- | ------------ | ------------ | ------------------- | --- | --- | --- | --- | --- | --- | --- |
Executorassoonastheyarereadyfor(parallel)execution
Planner,aswillbefurtherdiscussedinSec.4.1.
|     |     |     |     |     | based on a | greedy | policy. | Another key | functionality | is  |
| --- | --- | --- | --- | --- | ---------- | ------ | ------- | ----------- | ------------- | --- |
toreplacevariableswiththeactualoutputsfrompreceding
3.1.FunctionCallingPlanner
tasks,whichwereinitiallysetasplaceholdersbythePlanner.
TheFunctionCallingPlannerisresponsibleforgeneratinga FortheexampleinFig.2,thevariable$1and$2inTask$3
sequenceoftaskstobeexecutedalongwithanydependency wouldbereplacedwiththeactualmarketcapofMicrosoft
amongthem. Forinstance,Tasks$1and$2inFig.2are andApple. Thiscanbeimplementedwithasimplefetching
twoindependentsearchesthatcanbeperformedinparal- andqueuingmechanismwithoutadedicatedLLM.
However,Task$3hasadependencyontheoutcomes
lel.
| ofthefirstandsecondsearches.                    |     |     | Therefore,thePlanner’s |     | 3.3.Executor |     |     |     |     |     |
| ----------------------------------------------- | --- | --- | ---------------------- | --- | ------------ | --- | --- | --- | --- | --- |
| roleistoautomaticallyidentifythenecessarytasks, |     |     |                        |     | their        |     |     |     |     |     |
TheExecutorasynchronouslyexecutestasksfetchedfrom
inputarguments,aswellastheirinter-dependenciesusing
|     |     |     |     |     | the Task Fetching |     | Unit. As | the Task Fetching | Unit | guar- |
| --- | --- | --- | --- | --- | ----------------- | --- | -------- | ----------------- | ---- | ----- |
thesophisticatedreasoningcapabilityofLLMs,essentially
anteesthatallthetasksdispatchedtotheExecutorarein-
| formingadirectedacyclicgraphoftaskdependencies. |              |      |                                 |     | If         |                                     |     |     |     |     |
| ----------------------------------------------- | ------------ | ---- | ------------------------------- | --- | ---------- | ----------------------------------- | --- | --- | --- | --- |
|                                                 |              |      |                                 |     | dependent, | itcansimplyexecutethemconcurrently. |     |     |     | The |
| a task                                          | is dependent | on a | preceding task, it incorporates |     | a          |                                     |     |     |     |     |
Executorisequippedwithuser-providedtools,anditdel-
placeholdervariable,suchas$1inTask3ofFig.2,which
|      |          |             |                        |      | egates the | task to | the associated | tool. These | tools | can be |
| ---- | -------- | ----------- | ---------------------- | ---- | ---------- | ------- | -------------- | ----------- | ----- | ------ |
| will | later be | substituted | with the actual output | from | the        |         |                |             |       |        |
simplefunctionslikeacalculator,Wikipediasearch,orAPI
precedingtask(Sec.3.2).
calls,ortheycanevenbeLLMagentsthataretailoredfora
ThePlannerinLLMCompilerleveragesLLMs’reasoning specifictask. AsdepictedintheExecutorblockofFig.2,
capabilitytodecomposetasksfromnaturallanguageinputs. each task has dedicated memory to store its intermediate
Toachievethis,thePlannerLLMincorporatesapre-defined
|     |     |     |     |     | outcomes, | similar | to what typical | sequential | frameworks |     |
| --- | --- | --- | --- | --- | --------- | ------- | --------------- | ---------- | ---------- | --- |
promptthatguidesitonhowtocreatedependencygraphs dowhenaggregatingobservationsasasingleprompt(Yao
andtoensurecorrectsyntax(seeAppendixHfordetails).
|     |     |     |     |     | etal.,2022). | Uponcompletionofthetask,thefinalresults |     |     |     |     |
| --- | --- | --- | --- | --- | ------------ | --------------------------------------- | --- | --- | --- | --- |
Besidesthis,usersalsoneedtosupplytooldefinitionsand areforwardedasinputtothetasksdependentonthem.
| optionalin-contextexamplesforthePlanner. |     |     |     | Theseexam- |     |     |     |     |     |     |
| ---------------------------------------- | --- | --- | --- | ---------- | --- | --- | --- | --- | --- | --- |
plesprovidedetaileddemonstrationsoftaskdecomposition
3.4.DynamicReplanning
specifictoaproblem,helpingthePlannertobetterunder-
standtherules. Furtherdetailsonuser-suppliedinformation In various applications, the execution graph may need to
forLLMCompilerareelaboratedinSec.4.1. adaptbasedonintermediateresultsthatareaprioriunknown.
InSec.4.2,
weintroduceanadditionaloptimizationforthePlannerthat Ananalogyinprogrammingisbranching,wherethepath
4

AnLLMCompilerforParallelFunctionCalling
ofexecutionisdeterminedonlyduringruntime,depending streamingfeatureleadstoalatencygainofupto1.3×. This
onwhichbranchconditionsaresatisfied. Suchdynamicex- is attributed to the math tool’s longer execution time for
ecutionpatternscanalsoappearwithLLMfunctioncalling. ParallelQA,whichcaneffectivelyhidethePlanner’slatency
For simple branching (e.g., if-else statements) one could ingeneratingsubsequenttasks,unliketheshorterexecution
staticallycompiletheexecutionflowandchoosetheright times of the search tool used in HotpotQA and Movie
| dynamicallybasedontheintermediateresults. |     |     | However,for |     | Recommendation. |     |     |     |     |
| ----------------------------------------- | --- | --- | ----------- | --- | --------------- | --- | --- | --- | --- |
morecomplexbranchingitmaybebettertodoarecompila-
| tionorreplanningbasedontheintermediateresults. |                  |     |                  |      | 5.Results |     |     |     |     |
| ---------------------------------------------- | ---------------- | --- | ---------------- | ---- | --------- | --- | --- | --- | --- |
| When replanning,                               | the intermediate |     | results are sent | back |           |     |     |     |     |
Inthissection,weevaluateLLMCompilerusingavariety
fromtheExecutortotheFunctionCallingPlannerwhich
|     |     |     |     |     | ofmodelsandproblemtypes. |     | Weuseboththeproprietary |     |     |
| --- | --- | --- | --- | --- | ------------------------ | --- | ----------------------- | --- | --- |
thengeneratesanewsetoftaskswiththeirassociatedde-
|             |                                        |     |     |     | GPTmodelsandtheopen-sourceLLaMA-2model, |     |     |     | with |
| ----------- | -------------------------------------- | --- | --- | --- | --------------------------------------- | --- | --- | --- | ---- |
| pendencies. | ThesetasksarethensenttotheTaskFetching |     |     |     |                                         |     |     |     |      |
thelatterdemonstratingLLMCompiler’scapabilityinen-
| UnitandsubsequentlytotheExecutor. |     |     | Thiscyclecontinues |     |                                                   |     |     |     |      |
| --------------------------------- | --- | --- | ------------------ | --- | ------------------------------------------------- | --- | --- | --- | ---- |
|                                   |     |     |                    |     | ablingparallelfunctioncallinginopen-sourcemodels. |     |     |     | Fur- |
untilthedesiredfinalresultisachievedandcanbedelivered
thermore,therearevarioustypesofparallelfunctioncalling
| totheuser.  | WeshowanexampleusecaseofthisinSec.5.3 |          |                      |     |          |             |                |       |             |
| ----------- | ------------------------------------- | -------- | -------------------- | --- | -------- | ----------- | -------------- | ----- | ----------- |
|             |                                       |          |                      |     | patterns | that can be | addressed with | LLMs. | This ranges |
| for solving | the Game of                           | 24 using | the Tree-of-Thoughts |     |          |             |                |       |             |
fromembarrassinglyparallelpatterns,wherealltaskscan
approach.
beexecutedinparallelwithoutanydependenciesbetween
them,tomorecomplexdependencypatterns,asillustrated
4.LLMCompilerDetails
|     |     |     |     |     | in Fig.     | 3. Importantly,  | we also assess | LLMCompiler |         |
| --- | --- | --- | --- | --- | ----------- | ---------------- | -------------- | ----------- | ------- |
|     |     |     |     |     | on the Game | of 24 benchmark, | which          | involves    | dynamic |
4.1.User-SuppliedInformation
|     |     |     |     |     | replanningbasedonintermediateresults, |     |     | highlightingits |     |
| --- | --- | --- | --- | --- | ------------------------------------- | --- | --- | --------------- | --- |
LLMCompilerrequirestwoinputsfromtheuser: adaptability to dynamic dependency graphs. Finally, we
applyLLMCompilertotheWebShopbenchmarktoshow-
| 1. ToolDefinitions: | Usersneedtospecifythetoolsthat |     |     |     |                                         |     |     |                 |     |
| ------------------- | ------------------------------ | --- | --- | --- | --------------------------------------- | --- | --- | --------------- | --- |
|                     |                                |     |     |     | caseitspotentialindecision-makingtasks. |     |     | Overall,westart |     |
LLMscanuse,includingtheirdescriptionsandargument
presentingresultsforsimpleexecutionpatterns,andthen
| specifications. | Thisisessentiallythesamerequirement |     |     |     |     |     |     |     |     |
| --------------- | ----------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- |
wemovetomorecomplexones.
asotherframeworkslikeReActandOpenAIfunction
calling.
5.1.EmbarrassinglyParallelFunctionCalling
| 2. In-context | Examples | for the | Planner: Optionally, |     |     |     |     |     |     |
| ------------- | -------- | ------- | -------------------- | --- | --- | --- | --- | --- | --- |
users can provide LLMCompiler with examples of The simplest scenario involves an LLM using a tool re-
howthePlannershouldbehave. Forinstance,inthecase peatedlyforindependenttaskssuchasconductingparallel
of Fig. 2, users may provide examples illustrating ex- searchesoranalysestogatherinformationondifferenttop-
pectedinter-taskdependenciesforcertainqueries.These ics,likethepatterndepictedinFig.3(a). Whilethesetasks
areindependentofeachotherandcanbeexecutedinparal-
examplescanassistthePlannerLLMunderstandhow
tousevarioustoolsandgeneratetheappropriatedepen- lel,ReAct,alongwithotherLLMsolutionsastheystand,
dencygraphforincominginputsinthecorrectformat. would need to run sequentially. This leads to increased
InAppendixG,weincludetheexamplesthatweused latencyandtokenconsumptionduetoitsfrequentLLMin-
inourevaluations. vocationsforeachtoolusage,asalsoillustratedinFig.1. In
thissection,wedemonstratehowLLMCompilercaniden-
4.2.StreamedPlanner tifyparallelizablepatternsandexecuteindependenttasks
|     |     |     |     |     | concurrently | to resolve | this issue. To | do so, | we use the |
| --- | --- | --- | --- | --- | ------------ | ---------- | -------------- | ------ | ---------- |
The Planner may incur a non-trivial overhead for user followingtwobenchmarks:
queriesthatinvolvealotoftasksasitblockstheTaskFetch-
|     |     |     |     |     | • HotpotQA: | A dataset | that evaluates | multi-hop | reason- |
| --- | --- | --- | --- | --- | ----------- | --------- | -------------- | --------- | ------- |
ingUnitandtheExecutor,whichmustwaitforthePlanner
outputbeforeinitiatingtheirprocesses. However,analogous ing(Yangetal.,2018). Weonlyusethecomparisondev
toinstructionpipelininginmoderncomputersystems,this set. Thiscontains1.5kquestionscomparingtwodifferent
canbemitigatedbyenablingthePlannertoasynchronously entities,thusexhibitinga2-wayembarrassinglyparallel
streamthedependencygraph,therebyallowingeachtask executionpattern.AnexamplequestionisshowninFig.1.
tobeimmediatelyprocessedbytheExecutorassoonasits
dependenciesareallresolved. InTableC.1,wepresenta • MovieRecommendation: Adatasetwith500examples
| latency comparison | of LLMCompiler |     | with and | without |     |     |     |     |     |
| ------------------ | -------------- | --- | -------- | ------- | --- | --- | --- | --- | --- |
thataskstoidentifythemostsimilarmovieoutoffour
thestreamingmechanismacrossdifferentbenchmarks. The optionstoanothersetoffourmovies,exhibitingan8-way
resultsdemonstrateconsistentlatencyimprovementswith
embarrassinglyparallelpattern(Srivastavaetal.,2022).
| streaming. | Particularly,intheParallelQAbenchmark,the |     |     |     |     |     |     |     |     |
| ---------- | ----------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- |
5

AnLLMCompilerforParallelFunctionCalling
(a) Analyze Apple and Microsoft's latest 10-K  (b) If Stanford and UCLA were to merge, would they  (c) Which has higher total healthcare expenses, Florida
or New York, considering both public and private sectors?
| form and compare their sales forecast. |       |        |         | have more Nobel laureates than UC Berkeley? |     |     |     |     |        |     |     |     |     |
| -------------------------------------- | ----- | ------ | ------- | ------------------------------------------- | --- | --- | --- | --- | ------ | --- | --- | --- | --- |
| An a l y                               | z er  | An a l | y z er  |                                             |     |     |     |     | search |     |     |     |     |
A g e n t A g e n t search search search search search search
|     | output |     |     |     |     | math   |     |     |     | math |        |     | math |
| --- | ------ | --- | --- | --- | --- | ------ | --- | --- | --- | ---- | ------ | --- | ---- |
|     |        |     |     |     |     | math   |     |     |     |      | math   |     |      |
|     |        |     |     |     |     | output |     |     |     |      | output |     |      |
Figure3.Examplesofquestionswithdifferentfunctioncallingpatternsandtheirdependencygraphs.HotpotQAandMovieRecommen-
dationdatasetsexhibitpattern(a),andParallelQAdatasetexhibitspatterns(b)and(c),amongotherpatterns.In(a),weneedtoanalyze
eachcompany’slatest10-K.In(b),weneedthreesearchesforeachschool,followedbyoneadditionandonecomparisonoperation.In(c),
weneedtosearchforeachstate’sannualhealthcarespendingineachsector,sumeachstate’sspending,andthenperformacomparison.
Table1.AccuracyandlatencycomparisonofLLMCompilercomparedtothebaselineondifferentbenchmarks,includingHotpotQA,
MovieRecommendation,ourcustomdatasetnamedParallelQA,andtheGameof24.ForHotpotQAandMovieRecommendation,we
frequentlyobserveloopingandearlystopping(Sec.5.1).Tominimizethesebehaviorsasmuchaspossible,weincorporatedReAct-specific
promptingwhichwedenoteasReAct†.ReAct(without†)indicatestheoriginalresultswithoutthisprompting.Wedonotincludethe
latencyfortheoriginalReActsinceloopingandearlystoppingmakepreciselatencymeasurementdifficult.
|     |           |     |        |     |             | GPT(Closed-source) |            |         | LLaMA-270B(Open-source) |     |            |         |     |
| --- | --------- | --- | ------ | --- | ----------- | ------------------ | ---------- | ------- | ----------------------- | --- | ---------- | ------- | --- |
|     | Benchmark |     | Method |     |             |                    |            |         |                         |     |            |         |     |
|     |           |     |        |     | Accuracy(%) |                    | Latency(s) | Speedup | Accuracy(%)             |     | Latency(s) | Speedup |     |
|     |           |     | ReAct  |     |             | 61.52              | -          | -       | 54.74                   |     | -          | -       |     |
|     |           |     | ReAct† |     |             | 62.47              | 7.12       | 1.00×   | 54.40                   |     | 13.44      | 1.00×   |     |
HotpotQA
|     |     |     | OAIParallelFunction |     |     | 62.05 | 4.42 | 1.61× | -     |     | -    | -     |     |
| --- | --- | --- | ------------------- | --- | --- | ----- | ---- | ----- | ----- | --- | ---- | ----- | --- |
|     |     |     | LLMCompiler         |     |     | 62.00 | 3.95 | 1.80× | 57.83 |     | 9.58 | 1.40× |     |
|     |     |     | ReAct               |     |     | 68.60 | -    | -     | 70.00 |     | -    | -     |     |
ReAct†
|     | MovieRec.  |     |                     |     |     | 72.47 | 20.47 | 1.00× | 70.60 |     | 33.37 | 1.00× |     |
| --- | ---------- | --- | ------------------- | --- | --- | ----- | ----- | ----- | ----- | --- | ----- | ----- | --- |
|     |            |     | OAIParallelFunction |     |     | 77.00 | 7.42  | 2.76× | -     |     | -     | -     |     |
|     |            |     | LLMCompiler         |     |     | 77.13 | 5.47  | 3.74× | 77.80 |     | 11.83 | 2.82× |     |
|     |            |     | ReAct               |     |     | 89.09 | 35.90 | 1.00× | 59.59 |     | 15.47 | 1.00× |     |
|     | ParallelQA |     | OAIParallelFunction |     |     | 87.32 | 19.29 | 1.86× | -     |     | -     | -     |     |
LLMCompiler
|     |     |     |                  |     |     | 89.38 | 16.69 | 2.15× | 68.14 |     | 26.20  | 2.27× |     |
| --- | --- | --- | ---------------- | --- | --- | ----- | ----- | ----- | ----- | --- | ------ | ----- | --- |
|     |     |     | Tree-of-Thoughts |     |     | 74.00 | 241.2 | 1.00× | 30.00 |     | 952.06 | 1.00× |     |
Gameof24
|     |     |     | LLMCompiler |     |     | 75.33 | 83.6 | 2.89× | 32.00 |     | 456.02 | 2.09× |     |
| --- | --- | --- | ----------- | --- | --- | ----- | ---- | ----- | ----- | --- | ------ | ----- | --- |
Table2.Inputandoutputtokenconsumptionaswellastheesti- datasets,weusegpt-3.5-turbo(1106release). Fortheexper-
matedcostonHotpotQA,MovieRecommendation,andourcus- imentsusingGPT,weadditionallyreporttheresultsusing
tomdatasetnamedParallelQA.Thecostiscomputedbasedonthe OpenAI’s parallel function calling capability, which was
pricingtableoftheGPTmodelsusedforeachbenchmark. announcedconcurrentlywithourwork. Wealsoshowhow
LLMCompilercanbeeffectivelycombinedwiththeopen-
|           |        |     | Tokens |     | Cost | Cost |     |     |     |     |     |     |     |
| --------- | ------ | --- | ------ | --- | ---- | ---- | --- | --- | --- | --- | --- | --- | --- |
| Benchmark | Method |     |        |     |      |      |     |     |     |     |     |     |     |
In. Out. ($/1k) Red. source LLaMA-2 70B model to provide the model with
ReAct 2900 120 5.00 1.00× parallelfunctioncallingcapabilities. Forallexperiments,
| HotpotQA | OAIPara.Func. |     | 2500 | 63  | 2.66 | 1.87× |     |     |     |     |     |     |     |
| -------- | ------------- | --- | ---- | --- | ---- | ----- | --- | --- | --- | --- | --- | --- | --- |
LLMCompiler 1300 80 1.47 3.37× wehavemeasuredaccuracy,end-to-endlatency,aswellas
|           |               |       |       |     |       |       | inputandoutputtokenusage. |     |     |     | SeeAppendixDfordetails |     |     |
| --------- | ------------- | ----- | ----- | --- | ----- | ----- | ------------------------- | --- | --- | --- | ---------------------- | --- | --- |
|           |               | ReAct | 20000 | 230 | 20.46 | 1.00× |                           |     |     |     |                        |     |     |
|           |               |       |       |     |       | 3.33× | onexperimentalsetups.     |     |     |     |                        |     |     |
| MovieRec. | OAIPara.Func. |       | 5800  | 160 | 6.14  |       |                           |     |     |     |                        |     |     |
|           | LLMCompiler   |       | 2800  | 115 | 3.04  | 6.73× |                           |     |     |     |                        |     |     |
|           |               | ReAct | 46000 | 470 | 480   | 1.00× |                           |     |     |     |                        |     |     |
ParallelQA OAIPara.Func. 25000 370 260 1.81× AccuracyandLatency. Wereporttheaccuracy,end-to-
LLMCompiler 9200 340 103 4.65× endlatency,andrelativespeed-upofLLMCompilercom-
|     |     |     |     |     |     |     | pared | to  | ReAct in | Tab. 1. | First, we | observe | that ReAct |
| --- | --- | --- | --- | --- | --- | --- | ----- | --- | -------- | ------- | --------- | ------- | ---------- |
Experimental Setups. As a baseline method, we com- consistentlyachievesloweraccuracycomparedtoOpenAI
pare LLMCompiler with ReAct. We follow the ReAct parallelfunctioncallingandLLMCompiler. Weidentify
setup(Yaoetal.,2022)usingthesameWikipediasearch twomainfailuremodesinReAct: (1)thetendencyforre-
toolthatLLMscanusetosearchforinformation. Wedid dundantgenerationofpriorfunctioncalls,apointalsonoted
not include the lookup tool since it is not relevant to our intheoriginalReActpaper(Yaoetal.,2022);and(2)pre-
problem setting. We have optimized the prompt and in- matureearlystoppingbasedontheincompleteintermediate
context examples for both ReAct and LLMCompiler to results. InAppendixA,weofferadetailedanalysisdemon-
thebestofourabilities. Forallexperimentsacrossthese stratinghowthesetwoprevalentfailurecasessignificantly
6

AnLLMCompilerforParallelFunctionCalling
hurtReAct’saccuracy,andhowtheycanberesolvedwith inFig.3(b)and(c). InspiredbytheIfQAbenchmark(Yu
LLMCompiler, leading to an accuracy enhancement of etal.,2023),ParallelQAcontains113examplesthatinvolve
up to 7 – 8%. Furthermore, we have conducted interven- mathematicalquestionsonfactualattributesofvariousen-
tionalexperimentsinwhichweincorporatedReAct-specific tities. Inparticular,completingthetaskrequiresusingtwo
promptstoavoidrepetitivefunctioncallsandearlystopping. tools(i.e.,searchandmathtools),withthesecondtool’sar-
ReAct† inTab.1referstoReActwiththisReAct-specific gumentdependingontheresultofthefirsttool’soutput. We
prompt. TheReAct-specificpromptyieldsageneralaccu- havemeticulouslyincludedquestionsthatareanswerable
racyimprovementwithReAct†ascomparedtotheoriginal
onlywithinformationfromWikipedia’sfirstparagraph,ef-
ReAct. Nevertheless, LLMCompiler still demonstrates fectivelyfactoringoutthefailurecasesduetounsuccessful
on-parandbetteraccuracythanReAct†,assuchprompting searches. SeeAppendixIformoredetailsinParallelQA.
doesnotserveasaperfectsolutiontocompletelyavoiding
theerroneousbehaviorofReAct. Experimental Setups. Similar to Sec. 5.1, we use Re-
Additionally,whencomparedtoReAct†,LLMCompiler Act(Yaoetal.,2022)asthemainbaseline. Here,bothRe-
|     |     |     |     |     |     |     | ActandLLMCompilerareequippedwithtwotools: |     |     |     |     |     | (1) |
| --- | --- | --- | --- | --- | --- | --- | ----------------------------------------- | --- | --- | --- | --- | --- | --- |
demonstratesanoticeablespeedupof1.80×and1.40×on
thesearchtool,identicaltotheonementionedinSec.5.1;
| HotpotQAwithGPTandLLaMA,respectively. |     |     |     |     |     | Similarly, |     |     |     |     |     |     |     |
| ------------------------------------- | --- | --- | --- | --- | --- | ---------- | --- | --- | --- | --- | --- | --- | --- |
and(2)themathtool,whichsolvesmathematicalproblems.
| LLMCompiler |     | demonstrates |     | 3.74× and | 2.82× | speedup |     |     |     |     |     |     |     |
| ----------- | --- | ------------ | --- | --------- | ----- | ------- | --- | --- | --- | --- | --- | --- | --- |
ThemathtoolisinspiredbytheLangchain(Langchain)’s
| on Movie | Recommendation |     | with | each | model. | Note that |     |     |     |     |     |     |     |
| -------- | -------------- | --- | ---- | ---- | ------ | --------- | --- | --- | --- | --- | --- | --- | --- |
LLMMathChain,whichusesanLLMasanagentthatin-
webenchmarkthelatencyofLLMCompileragainstthat
terpretsinputqueriesandinvokesthenumexprfunction
| of ReAct† | since | the repeating |     | and early | stopping | behav- |     |     |     |     |     |     |     |
| --------- | ----- | ------------- | --- | --------- | -------- | ------ | --- | --- | --- | --- | --- | --- | --- |
ioroftheoriginalReActasdiscussedabovemakesitsla- withtheappropriateformula.Thisenablesthemathchainto
addressabroadspectrumofmathproblemsthatarewritten
| tency unpredictable |     | and | unsuitable | for | a fair | comparison. |                                  |     |     |     |     |                 |     |
| ------------------- | --- | --- | ---------- | --- | ------ | ----------- | -------------------------------- | --- | --- | --- | --- | --------------- | --- |
|                     |     |     |            |     |        |             | bothinmathematicalandverbalform. |     |     |     |     | SeeAppendixDfor |     |
LLMCompilerdemonstratesaspeedupofupto35%com-
moredetailsonexperimentalsetups.
| pared to | OpenAI | parallel | function | calling | whose | latency |     |     |     |     |     |     |     |
| -------- | ------ | -------- | -------- | ------- | ----- | ------- | --- | --- | --- | --- | --- | --- | --- |
gainoverReActis1.61×and2.76×oneachbenchmark.1
|     |     |     |     |     |     |     | AccuracyandLatency. |     |     | AsshownintheParallelQArow |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ------------------- | --- | --- | ------------------------- | --- | --- | --- |
ofTab.1,LLMCompilerarrivesatthefinalanswerwith
Costs. AnotherimportantconsiderationofusingLLMs
anaveragespeedupof2.15×withgpt-4-turboand2.27×
| is cost, | which depends | on  | the | input and | output | token us- |     |     |     |     |     |     |     |
| -------- | ------------- | --- | --- | --------- | ------ | --------- | --- | --- | --- | --- | --- | --- | --- |
withLLaMA-270B,byavoidingsequentialexecutionof
age. ThecostsforGPTexperimentsareprovidedinTab.2.
|     |     |     |     |     |     |     | thedependencygraphs. |     |     | Beyondthelatencyspeedup,weob- |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | -------------------- | --- | --- | ----------------------------- | --- | --- | --- |
LLMCompilerismorecost-efficientthanReActforcost,
servehigheraccuracyofLLMCompilerwiththeLLaMA-
| asitinvolveslessfrequentLLMinvocations. |     |     |     |     | Interestingly, |     |         |             |     |         |           |     |             |
| --------------------------------------- | --- | --- | --- | --- | -------------- | --- | ------- | ----------- | --- | ------- | --------- | --- | ----------- |
|                                         |     |     |     |     |                |     | 2 model | as compared |     | to that | of ReAct, | due | to the rea- |
LLMCompileralsooutperformstherecentOpenAIpar-
|                |         |          |                  |         |        |            | sons discussed |     | in Sec.   | 5.1. Particularly |      | in the   | LLaMA-     |
| -------------- | ------- | -------- | ---------------- | ------- | ------ | ---------- | -------------- | --- | --------- | ----------------- | ---- | -------- | ---------- |
| allel function | calling | in       | cost efficiency. |         | This   | is because |                |     |           |                   |      |          |            |
|                |         |          |                  |         |        |            | 2 experiment,  |     | where     | LLMCompiler       |      | achieves | around a   |
| LLMCompiler’s  |         | planning | phase            | is more | prompt | length     |                |     |           |                   |      |          |            |
|                |         |          |                  |         |        |            | 9% increase    | in  | accuracy, | we note           | that | ∼20%     | of the ex- |
efficientthanthatofOpenAIparallelfunctioncallingsince
|     |     |     |     |     |     |     | amples | experienced | repetitive |     | function | calls with | ReAct, |
| --- | --- | --- | --- | --- | --- | --- | ------ | ----------- | ---------- | --- | -------- | ---------- | ------ |
ourPlanner’sin-contextexamplesarerathershortandonly
|     |     |     |     |     |     |     | aligning | with our | observations |     | from | the accuracy | analy- |
| --- | --- | --- | --- | --- | --- | --- | -------- | -------- | ------------ | --- | ---- | ------------ | ------ |
includeplans,notobservations(seeAppendixH).
sisdetailedinAppendixA.Additionally,acomprehensive
|     |     |     |     |     |     |     | analysis | of LLMCompiler’s |     | failure |     | cases is provided | in  |
| --- | --- | --- | --- | --- | --- | --- | -------- | ---------------- | --- | ------- | --- | ----------------- | --- |
5.2.ParallelFunctionCallingwithDependencies
AppendixB,wherewenoteminimalPlannerfailures,high-
Thecasesconsideredabovearerathersimple,asonlyone lightingLLMCompiler’seffectivenessinbreakingdown
problemsintocomplexmulti-taskdependencies.
| tool is used  | and | all tasks                            | can be | executed | independently |     |     |     |     |     |     |     |     |
| ------------- | --- | ------------------------------------ | ------ | -------- | ------------- | --- | --- | --- | --- | --- | --- | --- | --- |
| ofoneanother. |     | However,similartocodeexecutionintra- |        |          |               |     |     |     |     |     |     |     |     |
ditional code blocks, we may encounter function calling Cost. SimilartoSec. 5.1,LLMCompilerdemonstrates
scenariosthatinvolvemorecomplexdependencies. Tosys- substantialcostreductionsof4.65×and2.57×compared
tematicallyevaluatethecapabilitytoplanoutfunctioncall- to ReAct and OpenAI’s parallel function calling, respec-
|     |     |     |     |     |     |     | tively, as | indicated | in  | Tab. 2. This | efficiency | stems | from |
| --- | --- | --- | --- | --- | --- | --- | ---------- | --------- | --- | ------------ | ---------- | ----- | ---- |
inginscenariosthatinvolvecomplextaskdependencies,we
havedesignedacustombenchmarkcalledParallelQA.This LLMCompiler’sreducedfrequencyofLLMinvocations,
benchmarkisdesignedtoincorporatenon-trivialfunction whichisalsothecasewithOpenAI’sparallelfunctioncall-
callingpatterns,includingthreedifferenttypesofpatterns ing,whichislimitedtoplanningoutimmediateparalleliz-
|     |     |     |     |     |     |     | abletasks,nottheentiredependencygraph. |     |     |     |     | Forexample,in |     |
| --- | --- | --- | --- | --- | --- | --- | -------------------------------------- | --- | --- | --- | --- | ------------- | --- |
1
Unfortunately,weareunabletoconcludewhythisisthecase,asOpenAI Fig.3(c),OpenAI’smethodwouldnecessitatethreedistinct
hasnotpubliclydisclosedanydetailsabouttheirfunctioncallingmechanism.One
LLMcallsforinitialsearchtasks,followingmathtasks,and
speculationisthattheremightbeadditionaloverheadstovalidatethefunctionand
|     |     |     |     |     |     |     | thefinalmathtask. |     | Incontrast,LLMCompilerachieves |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ----------------- | --- | ------------------------------ | --- | --- | --- | --- |
argumentnamesandtoconvertthemintoasystemprompt.Nevertheless,wehave
seenaconsistenttrendwithmultiplerunsoverseveraldays. thiswithasingleLLMcall,planningalltasksconcurrently.
7

AnLLMCompilerforParallelFunctionCalling
5.3.ParallelFunctionCallingwithReplanning numbersexactlyonceeach. Furtherdetailsonexperiment
setupsareoutlinedinAppendixD.
Intheprevioussections,wehavediscussedcasesinwhich
| dependencygraphscanbedeterminedstatically. |     |     |     |     | However, |     |     |     |     |     |     |     |     |
| ------------------------------------------ | --- | --- | --- | --- | -------- | --- | --- | --- | --- | --- | --- | --- | --- |
therearecaseswheredependencygraphsneedtobecon- SuccessRateandLatency. InthelasttworowsofTab.1,
structed dynamically depending on intermediate observa- weexplorethelatencyandsuccessrateofLLMCompiler
tions. Here,weconsideronesuchdynamicapproachinthe incomparisontothebaselinedescribedin(Yaoetal.,2023b)
contextoftheGameof24withtheTree-of-Thoughts(ToT) on the Game of 24 benchmark. With the gpt-4 model,
strategyproposedin(Yaoetal.,2023b). TheGameof24is LLMCompilerdemonstratesa2.89×enhancementinla-
atasktogenerate24usingasetoffournumbersandbasic tencywhileslightlyimprovingthesuccessratecompared
arithmeticoperations. Forexample,fromthenumbers2,4, tothebaseline. Similarly,whenappliedwiththeLLaMA-2
asolutioncouldbe4×(7−4)×2 = 24. model,LLMCompilershowsa2.01×improvementinla-
| 4, and7, |     |     |     |     |     | ToT |     |     |     |     |     |     |     |
| -------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
approachesthistaskthroughtwoiterativeLLMprocesses: tency,againwithoutcompromisingonsuccessrate. These
(i)thethoughtproposergeneratescandidatepartialsolutions resultsdemonstratenotonlyasignificantlatencyreduction
byselectingtwonumbersandapplyinganoperation(e.g. withoutqualitydegradation,butalsothereplanningcapabil-
2, 3, 7 from 2, 4, 4, 7 by calculating 7 - 4); (ii) the state ityofLLMCompilerforsolvingcomplexproblems.
| evaluator | assesses | the potential | of  | each candidate. |     | Only |     |     |     |     |     |     |     |
| --------- | -------- | ------------- | --- | --------------- | --- | ---- | --- | --- | --- | --- | --- | --- | --- |
thepromisingcandidatesarethenprocessedinsubsequent 5.4.Application: LLMCompilerinInteractiveDecision
iterationsofthethoughtproposerandstateevaluatoruntil
MakingTasks
| 24isreached. | DetailsabouttheGameof24benchmarkand |     |     |     |     |     |                  |     |                |     |                  |     |     |
| ------------ | ----------------------------------- | --- | --- | --- | --- | --- | ---------------- | --- | -------------- | --- | ---------------- | --- | --- |
|              |                                     |     |     |     |     |     | In this section, |     | we demonstrate |     | that LLMCompiler |     | can |
theToTstrategycanbefoundinAppendixJ.
explorelanguage-basedinteractiveenvironmentseffectively
While ToT achieves significant improvement at solving bybenchmarkingLLMCompileronWebShop(Yaoetal.,
the Game of 24, its sequential, breadth-first search ap- 2023a). As highlighted in (Shinn et al., 2023; Yao et al.,
| proach | through | the state | tree can | be time-consuming. |     |     |               |     |         |          |              |            |     |
| ------ | ------- | --------- | -------- | ------------------ | --- | --- | ------------- | --- | ------- | -------- | ------------ | ---------- | --- |
|        |         |           |          |                    |     |     | 2022; 2023a), |     | WebShop | exhibits | considerable | diversity, |     |
LLMCompileroffersafasteralternativebyenablingpar- whichrequiresextensiveexplorationtopurchasethemost
allelexecutionofthethoughtproposerandthesubsequent
appropriateitem.Whilerecentworkfeatureadvancedexplo-
feasibilityevaluator,akintoaparallelbeamsearchmethod. rationstrategiesandshowpromisingresults(Maetal.,2023;
Zhouetal.,2023a),theirapproachesarelargelybasedona
sequentialandextensivetreesearchthatincurssignificant
ExperimentalSetups. AlthoughLLMCompileroffers latencypenalties. Here,LLMCompilershowcasesanex-
| latency | advantages, | solving | this | problem | with | a single |     |     |     |     |     |     |     |
| ------- | ----------- | ------- | ---- | ------- | ---- | -------- | --- | --- | --- | --- | --- | --- | --- |
plorationstrategythatisbotheffectiveandefficientwiththe
static graph is not feasible, as the Planner cannot plan useofparallelfunctioncalling.Ourmethodenablesbroader
out the thought proposing stage before identifying the exploration of items in the environment, which improves
| selected | candidates | from | the state | evaluator | of  | the pre- |                             |     |     |     |                       |     |     |
| -------- | ---------- | ---- | --------- | --------- | --- | -------- | --------------------------- | --- | --- | --- | --------------------- | --- | --- |
|          |            |      |           |           |     |          | successratecomparedtoReAct. |     |     |     | Atthesametime,thisex- |     |     |
vious iteration. Consequently, the Planner is limited to plorationcanbeparallelized,yieldingupto101.7×speedup
| planning | only | within one | iteration | at a time. | To  | address |     |     |     |     |     |     |     |
| -------- | ---- | ---------- | --------- | ---------- | --- | ------- | --- | --- | --- | --- | --- | --- | --- |
againstbaselinesthatperformsequentialexploration.
LLMCompiler’s
| this, we            | resort | to           |     | replanning  |            | capabil- |              |                 |         |         |            |             |      |
| ------------------- | ------ | ------------ | --- | ----------- | ---------- | -------- | ------------ | --------------- | ------- | ------- | ---------- | ----------- | ---- |
| ity. In particular, |        | LLMCompiler  |     | is equipped | with       | three    |              |                 |         |         |            |             |      |
|                     |        |              |     |             |            |          | Experimental |                 | Setups. | We      | evaluate   | LLMCompiler |      |
| tools: thought      |        | proposer     | and | state       | evaluator, |          |              |                 |         |         |            |             |      |
|                     |        |              |     |             |            |          | against      | three baselines |         | on this | benchmark, | ReAct       | (Yao |
| which are           | both   | LLMs adapted |     | from the    | original   | ToT      |              |                 |         |         |            |             |      |
etal.,2022),LATS(Zhouetal.,2023a),andLASER(Ma
| framework,                | and         | top k select, |                    | which chooses |           | the top |                                          |     |     |     |               |             |     |
| ------------------------- | ----------- | ------------- | ------------------ | ------------- | --------- | ------- | ---------------------------------------- | --- | --- | --- | ------------- | ----------- | --- |
|                           |             |               |                    |               |           |         | etal.,2023),using500WebShopinstructions. |     |     |     |               | Theevalu-   |     |
| kcandidatesfromthethought |             |               | proposerbasedonthe |               |           |         |                                          |     |     |     |               |             |     |
|                           |             |               |                    |               |           |         | ationmetricsaresuccessrate,              |     |     |     | averagescore, | andlatency. |     |
| state                     | evaluator’s | assessment.   |                    | After         | all these | tools   |                                          |     |     |     |               |             |     |
MoredetailsoftheWebShopenvironmentandthebaseline
areexecuted,LLMCompilercandecideto“replan”ifno
methodsareprovidedinAppendixK.Forthisexperiment,
proposalreaches24,triggeringthePlannertodevisenew
|                                       |     |     |     |     |            |     | LLMCompilerisequippedwithtwotools: |     |        |          |          | searchand |     |
| ------------------------------------- | --- | --- | --- | --- | ---------- | --- | ---------------------------------- | --- | ------ | -------- | -------- | --------- | --- |
| plansusingtheshortlistedstatesfromtop |     |     |     |     | k selectof |     |                                    |     |        |          |          |           |     |
|                                       |     |     |     |     |            |     | explore.                           | The | search | function | triggers | the model | to  |
Inthisway,LLMCompilercandy-
thepreviousiteration.
generateanddispatchaquerythatreturnsalistoftypically
namicallyregenerateplansofeachiteration,beingableto
|     |     |     |     |     |     |     | tenitemsfromtheWebshopenvironment. |     |     |     |     | Theexplore |     |
| --- | --- | --- | --- | --- | --- | --- | ---------------------------------- | --- | --- | --- | --- | ---------- | --- |
tacklehighlycomplextasksthatrequireiterativereplanning
|     |     |     |     |     |     |     | function | then clicks | through | links | for each | of the | found |
| --- | --- | --- | --- | --- | --- | --- | -------- | ----------- | ------- | ----- | -------- | ------ | ----- |
basedontheoutcomesofpreviousplans.
|     |     |     |     |     |     |     | items and | retrieves | information |     | about options, | prices, | at- |
| --- | --- | --- | --- | --- | --- | --- | --------- | --------- | ----------- | --- | -------------- | ------- | --- |
ToevaluateLLMCompiler’sperformanceontheGameof tributes,andfeaturesthatareavailable. Finally,basedon
24, weuse100differentinstancesofthegame. Foreach thegatheredinformation,LLMCompilerdecidesonthe
problem,weconsidertheoutputassuccessfulifitsopera- itemthatbestmatchestheinputinstructionforpurchasing.
tionsarevalidandyield24whilealsousingtheprovided FurtherdetailsonexperimentscanbefoundinAppendixD.
8

AnLLMCompilerforParallelFunctionCalling
Table3.Performance and Latency Analysis for WebShop. We withitsstandarddeviation,is72.8±4.01forgpt-3.5-turbo.
evaluate LLMCompiler with two models: gpt-4 and gpt-3.5- Further note that while the performance differences are
turboandcompareLLMCompileragainstthreebaselines:ReAct,
marginal,ourmethodexhibitssignificantexecutionspeedup,
LATS,andLASER.Wereportsuccessrateandaveragescorein 101.7×overLATSand2.69×overLASER.
percentage.Wereproducethesuccessrateandaveragescorefor
ReAct,whilethoseforLATSandLASERarefromtheirpapers.
6.Conclusions
Ndenotesthenumberofexamplesusedforevaluation.
| Model | Method | Succ.Rate |     | Score Latency(s) | N   |                  |     |                   |           |      |
| ----- | ------ | --------- | --- | ---------------- | --- | ---------------- | --- | ----------------- | --------- | ---- |
|       |        |           |     |                  |     | Existing methods | for | invoking multiple | functions | with |
ReAct 19.8 54.2 5.98 500 LLMs resort to sequential and dynamic reasoning. As a
gpt-3.5-turbo LATS 38.0 75.9 1066 50 result,theysufferfrominefficienciesinlatency,cost,and
|     | LLMCompiler |     | 44.0 | 72.8 10.72 | 50  |     |     |     |     |     |
| --- | ----------- | --- | ---- | ---------- | --- | --- | --- | --- | --- | --- |
LLMCompiler 48.2 74.2 10.48 500 accuracy. As a solution, we introduced LLMCompiler,
ReAct 35.2 58.8 19.90 500 acompiler-inspiredframeworkthatenablesefficientparal-
| gpt-4-0613 | LASER |     | 50.0 | 75.6 72.16 | 500 |     |     |     |     |     |
| ---------- | ----- | --- | ---- | ---------- | --- | --- | --- | --- | --- | --- |
LLMCompiler lelfunctioncallingacrossvariousLLMs,includingopen-
|                        |     |     | 55.6                     | 77.1 26.73 | 500 |                                                   |              |              |     |         |
| ---------------------- | --- | --- | ------------------------ | ---------- | --- | ------------------------------------------------- | ------------ | ------------ | --- | ------- |
|                        |     |     |                          |            |     | source models                                     | like LLaMA-2 | and OpenAI’s |     | GPT se- |
|                        |     |     |                          |            |     | ries. Bydecomposinguserinputsintotaskswithdefined |              |              |     |         |
| PerformanceandLatency. |     |     | Ourapproachsignificantly |            |     |                                                   |              |              |     |         |
inter-dependenciesandexecutingthesetasksconcurrently
outperformsallbaselinemodelsasshowninTable3. When throughitsPlanner,TaskFetchingUnit,andExecutorcom-
using gpt-3.5-turbo, LLMCompiler achieves a 28.4% ponents,LLMCompilerdemonstratessubstantialimprove-
and 6% improvement in success rate against ReAct and mentsinlatency(upto3.7×),costefficiency(upto6.7×),
LATS;withgpt-4,ourmethodimprovesuponReActand andaccuracy(upto∼9%),evenoutperformingOpenAI’s
| LASER | by 20.4% and | 5.6%, | respectively. | In terms | of  |                                               |     |     |     |        |
| ----- | ------------ | ----- | ------------- | -------- | --- | --------------------------------------------- | --- | --- | --- | ------ |
|       |              |       |               |          |     | parallelfunctioncallingfeatureinlatencygains. |     |     |     | Welook |
latency, LLMCompiler exhibits a 101.7× and 2.69× forwardtofutureworkbuildinguponLLMCompilerthat
speedup against LATS and LASER. While we note that willimproveboththecapabilitiesandefficienciesofLLMs
LLMCompilerexecutionisslightlyslowerthanReActon
inexecutingcomplex,large-scaletasks,thustransforming
this benchmark, mainly due to the Planner overhead, we thefuturedevelopmentofLLM-basedapplications.
alsohighlightthatthegainsinsuccessratefaroutweighthe
| minorlatencypenalty. |     |     |     |     |     | ImpactStatement |     |     |     |     |
| -------------------- | --- | --- | --- | --- | --- | --------------- | --- | --- | --- | --- |
WefurtherdelveintowhyLLMCompilerattainssuchan
Thispaperpresentsresearchtowardsadvancingthefieldof
improvedsuccessrateandscorecomparedtoReAct. Based MachineLearning. Whiletherearemanypotentialsocietal
onourobservations,wediscoverthattheReActagenttends
|     |     |     |     |     |     | consequences | of our work, | we do not | find any one | to be |
| --- | --- | --- | --- | --- | --- | ------------ | ------------ | --------- | ------------ | ----- |
tocommittoadecisionwithimperfectinformation,asce-
particularlynoteworthy.
| nario that | can arise when | the | agent has | not gathered | suf- |     |     |     |     |     |
| ---------- | -------------- | --- | --------- | ------------ | ---- | --- | --- | --- | --- | --- |
ficientdetailsaboutthefeaturesandoptionsavailablefor
Acknowledgements
| items. | This observation | was | also noted | in (Shinn | et al., |     |     |     |     |     |
| ------ | ---------------- | --- | ---------- | --------- | ------- | --- | --- | --- | --- | --- |
2023)–withoutexploringmoreitemsintheenvironment, WeappreciatethevaluablefeedbackfromMinwooKang.
theagentstrugglestodifferentiatebetweenseeminglysimi- WeacknowledgegracioussupportfromFuriosateam. We
larchoices,ultimatelyfailingtomakethecorrectdecision. also appreciate the support from Microsoft through their
Incontrast,LLMCompilerundergoesfurtherexploration AcceleratingFoundationModelResearch,includinggreat
byvisitingalltenitemsfoundbysearchandretrieving
|     |     |     |     |     |     | supportfromSeanKuno. |     | Furthermore,weappreciatesup- |     |     |
| --- | --- | --- | --- | --- | --- | -------------------- | --- | ---------------------------- | --- | --- |
relevantinformationabouteachitem. Wefindthatemploy- portfromGoogleCloud,theGoogleTRCteam,andspecif-
inganeffectivesearchstrategyiscriticaltodecision-making ically Jonathan Caton, and Prof. David Patterson. Prof.
taskssuchastheWebShopbenchmark. Keutzer’s lab is sponsored by the Intel corporation, Intel
|                |                  |     |         |          |        | One-API, | Intel VLAB | team, the Intel | One-API | center of |
| -------------- | ---------------- | --- | ------- | -------- | ------ | -------- | ---------- | --------------- | ------- | --------- |
| The relatively | high performance |     | of LATS | can also | be ex- |          |            |                 |         |           |
excellence,aswellasfundingthroughBDDandBAIR.We
| plainedintermsofitsexplorationscheme. |     |     |     | Inthisframe- |     |     |     |     |     |     |
| ------------------------------------- | --- | --- | --- | ------------ | --- | --- | --- | --- | --- | --- |
alsoappreciatesupportfromSamsungincludingDongkyun
work,theagentexecutesabrute-forcesearchthroughthe
|                               |     |     |                   |     |     | Kim,andDavidThorsley. |     | Weappreciatethegreatsupport |     |     |
| ----------------------------- | --- | --- | ----------------- | --- | --- | --------------------- | --- | --------------------------- | --- | --- |
| stateandactionspaceofWebshop, |     |     | exploringasmanyas |     |     |                       |     |                             |     |     |
fromEllickChan,SaurabhTangri,AndresRodriguez,and
| 30trajectoriesbeforemakingthefinalpurchase. |     |     |     | Whilethis |     |               |                                 |     |     |     |
| ------------------------------------------- | --- | --- | --- | --------- | --- | ------------- | ------------------------------- | --- | --- | --- |
|                                             |     |     |     |           |     | KitturGanesh. | SehoonKimandSuhongMoonwouldlike |     |     |     |
approachprovidesricherinformationfordecision-making,
toacknowledgethesupportfromtheKoreaFoundationfor
theend-to-endexecutionbecomesprohibitivelyslow.
|     |     |     |     |     |     | AdvancedStudies. | AmirGholamiwassupportedthrough |     |     |     |
| --- | --- | --- | --- | --- | --- | ---------------- | ------------------------------ | --- | --- | --- |
Wereportthatourmethod,LLMCompiler,outperforms fundingfromSamsungSAIT.MichaelW.Mahoneywould
LASER by an average score of 1.5. When compared to alsoliketoacknowledgeaJ.P.MorganChaseFacultyRe-
LATS,thisscoreiswithinthestandarddeviationrangeof searchAwardaswellastheDOE,NSF,andIARPA.Our
ourmethod. TheaveragescoreforLLMCompiler,along conclusions do not necessarily reflect the position or the
9

AnLLMCompilerforParallelFunctionCalling
policyofoursponsors,andnoofficialendorsementshould Gao,L.,Madaan,A.,Zhou,S.,Alon,U.,Liu,P.,Yang,Y.,
beinferred. Callan,J.,andNeubig,G. Pal: Program-aidedlanguage
|     |     |     |     |     |     |     | models. | arXivpreprintarXiv:2211.10435,2022. |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ------- | ----------------------------------- | --- | --- | --- |
References
Hao,S.,Gu,Y.,Ma,H.,Hong,J.J.,Wang,Z.,Wang,D.Z.,
|     |     |     |     |     |     |     | andHu,Z. | Reasoningwithlanguagemodelisplanning |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | -------- | ------------------------------------ | --- | --- | --- |
https://huggingface.co/text-generation-inference.
withworldmodel,2023.
https://github.com/nvidia/tensorrt-llm.
Hendrycks,D.,Basart,S.,Kadavath,S.,Mazeika,M.,Arora,
Austin,J.,Odena,A.,Nye,M.,Bosma,M.,Michalewski,
A.,Guo,E.,Burns,C.,Puranik,S.,He,H.,Song,D.,and
H.,Dohan,D.,Jiang,E.,Cai,C.,Terry,M.,Le,Q.,and Steinhardt,J. Measuringcodingchallengecompetence
Sutton,C.Programsynthesiswithlargelanguagemodels, withapps. NeurIPS,2021a.
2021.
Hendrycks,D.,Burns,C.,Basart,S.,Zou,A.,Mazeika,M.,
Besta,M.,Blach,N.,Kubicek,A.,Gerstenberger,R.,Gi- Song,D.,andSteinhardt,J. Measuringmassivemultitask
| aninazzi, | L., | Gajda, J., | Lehmann, | T., | Podstawski, | M., |     |     |     |     |     |
| --------- | --- | ---------- | -------- | --- | ----------- | --- | --- | --- | --- | --- | --- |
languageunderstanding.ProceedingsoftheInternational
Niewiadomski,H.,Nyczyk,P.,andHoefler,T. Graphof ConferenceonLearningRepresentations(ICLR),2021b.
thoughts:Solvingelaborateproblemswithlargelanguage
models,2023.
Hendrycks,D.,Burns,C.,Kadavath,S.,Arora,A.,Basart,
S.,Tang,E.,Song,D.,andSteinhardt,J.Measuringmath-
Chen, C., Borgeaud, S., Irving, G., Lespiau, J.-B., Sifre, ematicalproblemsolvingwiththemathdataset. NeurIPS,
| L., and | Jumper, | J. Accelerating |     | large | language | model |     |     |     |     |     |
| ------- | ------- | --------------- | --- | ----- | -------- | ----- | --- | --- | --- | --- | --- |
2021c.
decodingwithspeculativesampling,2023a.
|     |     |     |     |     |     |     | Houlsby, | N., Giurgiu, | A., Jastrzebski, | S., Morrone, | B., |
| --- | --- | --- | --- | --- | --- | --- | -------- | ------------ | ---------------- | ------------ | --- |
Chen,M.,Tworek,J.,Jun,H.,Yuan,Q.,deOliveiraPinto,
|        |         |              |     |        |     |             | DeLaroussilhe, | Q.,                                        | Gesmundo, | A., Attariyan, | M., and |
| ------ | ------- | ------------ | --- | ------ | --- | ----------- | -------------- | ------------------------------------------ | --------- | -------------- | ------- |
| H. P., | Kaplan, | J., Edwards, | H., | Burda, | Y., | Joseph, N., |                |                                            |           |                |         |
|        |         |              |     |        |     |             | Gelly,S.       | Parameter-efficienttransferlearningfornlp. |           |                | In      |
Brockman, G., Ray, A., Puri, R., Krueger, G., Petrov, Internationalconferenceonmachinelearning,pp.2790–
M.,Khlaaf,H.,Sastry,G.,Mishkin,P.,Chan,B.,Gray,
2799.PMLR,2019.
S.,Ryder,N.,Pavlov,M.,Power,A.,Kaiser,L.,Bavar-
ian,M.,Winter,C.,Tillet,P.,Such,F.P.,Cummings,D., Hu,E.J.,Shen,Y.,Wallis,P.,Allen-Zhu,Z.,Li,Y.,Wang,
Plappert,M.,Chantzis,F.,Barnes,E.,Herbert-Voss,A.,
|     |     |     |     |     |     |     | S.,Wang,L.,andChen,W. |     | LoRA:Low-rankadaptation |     |     |
| --- | --- | --- | --- | --- | --- | --- | --------------------- | --- | ----------------------- | --- | --- |
Guss, W. H., Nichol, A., Paino, A., Tezak, N., Tang, oflargelanguagemodels. InInternationalConference
J., Babuschkin, I., Balaji, S., Jain, S., Saunders, W., onLearningRepresentations,2022.
| Hesse, | C., Carr, | A. N., | Leike, | J., Achiam, |     | J., Misra, |     |     |     |     |     |
| ------ | --------- | ------ | ------ | ----------- | --- | ---------- | --- | --- | --- | --- | --- |
V., Morikawa, E., Radford, A., Knight, M., Brundage, Karpathy,A. Introtolargelanguagemodels,2023.
| M., Murati, | M., | Mayer, | K., Welinder, |     | P., McGrew, | B., |     |     |     |     |     |
| ----------- | --- | ------ | ------------- | --- | ----------- | --- | --- | --- | --- | --- | --- |
Khot,T.,Trivedi,H.,Finlayson,M.,Fu,Y.,Richardson,K.,
Amodei,D.,McCandlish,S.,Sutskever,I.,andZaremba,
W. Evaluating large language models trained on code. Clark, P., and Sabharwal, A. Decomposed prompting:
| 2021.                               |     |     |                              |     |     |         | Amodularapproachforsolvingcomplextasks. |               |            |             | InThe  |
| ----------------------------------- | --- | --- | ---------------------------- | --- | --- | ------- | --------------------------------------- | ------------- | ---------- | ----------- | ------ |
|                                     |     |     |                              |     |     |         | Eleventh                                | International | Conference | on Learning | Repre- |
| Chen,W.,Ma,X.,Wang,X.,andCohen,W.W. |     |     |                              |     |     | Program | sentations,2023.                        |               |            |             |        |
| ofthoughtsprompting:                |     |     | Disentanglingcomputationfrom |     |     |         |                                         |               |            |             |        |
Kim,S.,Hooper,C.,Gholami,A.,Dong,Z.,Li,X.,Shen,
reasoningfornumericalreasoningtasks,2023b.
|     |     |     |     |     |     |     | S.,Mahoney,M.W.,andKeutzer,K. |     |     | Squeezellm: | Dense- |
| --- | --- | --- | --- | --- | --- | --- | ----------------------------- | --- | --- | ----------- | ------ |
Dettmers,T.,Svirschevski,R.,Egiazarian,V.,Kuznedelev, and-sparsequantization,2023.
D.,Frantar,E.,Ashkboos,S.,Borzunov,A.,Hoefler,T.,
andAlistarh,D. Spqr: Asparse-quantizedrepresentation Kim, S., Mangalam, K., Moon, S., Malik, J., Mahoney,
fornear-losslessllmweightcompression,2023. M.W.,Gholami,A.,andKeutzer,K. Speculativedecod-
ingwithbiglittledecoder,2024.
| Frantar,E.andAlistarh,D. |     |     | Sparsegpt: | Massivelanguage |     |     |     |     |     |     |     |
| ------------------------ | --- | --- | ---------- | --------------- | --- | --- | --- | --- | --- | --- | --- |
modelscanbeaccuratelyprunedinone-shot,2023. Kojima,T.,Gu,S.S.,Reid,M.,Matsuo,Y.,andIwasawa,
Y. Largelanguagemodelsarezero-shotreasoners,2023.
| Frantar, | E., Ashkboos, |     | S., Hoefler, |     | T., and | Alistarh, |     |     |     |     |     |
| -------- | ------------- | --- | ------------ | --- | ------- | --------- | --- | --- | --- | --- | --- |
D. GPTQ: Accurate post-training compression for Kwon,W.,Kim,S.,Mahoney,M.W.,Hassoun,J.,Keutzer,
generative pretrained transformers. arXiv preprint K.,andGholami,A. Afastpost-trainingpruningframe-
| arXiv:2210.17323,2022. |     |     |     |     |     |     | workfortransformers,2022. |     |     |     |     |
| ---------------------- | --- | --- | --- | --- | --- | --- | ------------------------- | --- | --- | --- | --- |
10

AnLLMCompilerforParallelFunctionCalling
Kwon, W., Li, Z., Zhuang, S., Sheng, Y., Zheng, L., Yu, Qin,Y.,Liang,S.,Ye,Y.,Zhu,K.,Yan,L.,Lu,Y.,Lin,Y.,
C.H.,Gonzalez,J.E.,Zhang,H.,andStoica,I. Efficient Cong,X.,Tang,X.,Qian,B.,etal. Toolllm: Facilitating
memorymanagementforlargelanguagemodelserving largelanguagemodelstomaster16000+real-worldapis.
withpagedattention. InProceedingsoftheACMSIGOPS arXivpreprintarXiv:2307.16789,2023.
29thSymposiumonOperatingSystemsPrinciples,2023.
Ruan,J.,Chen,Y.,Zhang,B.,Xu,Z.,Bao,T.,Du,G.,Shi,
|     |     |     |     | S.,Mao,H.,Zeng,X.,andZhao,R. |     | Tptu: | Taskplanning |
| --- | --- | --- | --- | ---------------------------- | --- | ----- | ------------ |
Langchain. https://github.com/langchain-ai/langchain.
andtoolusageoflargelanguagemodel-basedaiagents.
Lester, B., Al-Rfou, R., and Constant, N. The power of arXivpreprintarXiv:2308.03427,2023a.
scaleforparameter-efficientprompttuning,2021.
|     |     |     |     | Ruan, Y., | Dong, H., Wang, | A., Pitis, S., | Zhou, Y., Ba, J., |
| --- | --- | --- | --- | --------- | --------------- | -------------- | ----------------- |
Leviathan,Y.,Kalman,M.,andMatias,Y. Fastinference Dubois,Y.,Maddison,C.J.,andHashimoto,T. Identify-
fromtransformersviaspeculativedecoding,2023. ingtherisksoflmagentswithanlm-emulatedsandbox.
arXivpreprintarXiv:2309.15817,2023b.
Liang,Y.,Wu,C.,Song,T.,Wu,W.,Xia,Y.,Liu,Y.,Ou,Y.,
Lu,S.,Ji,L.,Mao,S.,Wang,Y.,Shou,L.,Gong,M.,and Schick,T.,Dwivedi-Yu,J.,Dess`ı,R.,Raileanu,R.,Lomeli,
|         |                |                             |     | M.,Zettlemoyer,L.,Cancedda,N.,andScialom,T. |     |     | Tool- |
| ------- | -------------- | --------------------------- | --- | ------------------------------------------- | --- | --- | ----- |
| Duan,N. | Taskmatrix.ai: | Completingtasksbyconnecting |     |                                             |     |     |       |
foundationmodelswithmillionsofapis,2023. former: Languagemodels canteach themselvesto use
tools. arXivpreprintarXiv:2302.04761,2023.
Lin,J.,Tang,J.,Tang,H.,Yang,S.,Dang,X.,Gan,C.,and
Shen,Y.,Song,K.,Tan,X.,Li,D.,Lu,W.,andZhuang,Y.
| Han,S. Awq: | Activation-awareweightquantizationfor |     |     |     |     |     |     |
| ----------- | ------------------------------------- | --- | --- | --- | --- | --- | --- |
llmcompressionandacceleration,2023. Hugginggpt: Solvingaitaskswithchatgptanditsfriends
inhuggingface,2023.
| Liu,J. LlamaIndex,112022. |     | URLhttps://github. |     |        |              |             |                   |
| ------------------------- | --- | ------------------ | --- | ------ | ------------ | ----------- | ----------------- |
|                           |     |                    |     | Shinn, | N., Cassano, | F., Berman, | E., Gopinath, A., |
com/jerryjliu/llama_index.
|     |     |     |     | Narasimhan,K.,andYao,S. |     | Reflexion: | Languageagents |
| --- | --- | --- | --- | ----------------------- | --- | ---------- | -------------- |
Ma,K.,Zhang,H.,Wang,H.,Pan,X.,andYu,D. Laser: withverbalreinforcementlearning,2023.
Llmagentwithstate-spaceexplorationforwebnaviga-
|     |     |     |     | Song, Y., | Xiong, W., Zhu, | D., Wu, W., | Qian, H., Song, |
| --- | --- | --- | --- | --------- | --------------- | ----------- | --------------- |
tion,2023.
M.,Huang,H.,Li,C.,Wang,K.,Yao,R.,Tian,Y.,and
|     |     |     |     | Li,S. | Restgpt: Connectinglargelanguagemodelswith |     |     |
| --- | --- | --- | --- | ----- | ------------------------------------------ | --- | --- |
Madaan,A.,Tandon,N.,Gupta,P.,Hallinan,S.,Gao,L.,
Wiegreffe,S.,Alon,U.,Dziri,N.,Prabhumoye,S.,Yang, real-worldrestfulapis,2023.
| Y., Gupta, | S., Majumder, | B.P., Hermann, | K., Welleck, |     |     |     |     |
| ---------- | ------------- | -------------- | ------------ | --- | --- | --- | --- |
Srivastava,A.,Rastogi,A.,Rao,A.,Shoeb,A.A.M.,Abid,
| S.,Yazdanbakhsh,A.,andClark,P. |     | Self-refine: | Iterative |            |            |                 |                |
| ------------------------------ | --- | ------------ | --------- | ---------- | ---------- | --------------- | -------------- |
|                                |     |              |           | A., Fisch, | A., Brown, | A. R., Santoro, | A., Gupta, A., |
refinementwithself-feedback,2023. Garriga-Alonso, A., et al. Beyond the imitation game:
Quantifyingandextrapolatingthecapabilitiesoflanguage
Ning,X.,Lin,Z.,Zhou,Z.,Wang,Z.,Yang,H.,andWang,
|                         |     |                          |     | models. | arXivpreprintarXiv:2206.04615,2022. |     |     |
| ----------------------- | --- | ------------------------ | --- | ------- | ----------------------------------- | --- | --- |
| Y. Skeleton-of-thought: |     | Largelanguagemodelscando |     |         |                                     |     |     |
paralleldecoding,2023.
Sumers,T.R.,Yao,S.,Narasimhan,K.,andGriffiths,T.L.
Cognitivearchitecturesforlanguageagents,2023.
OpenAI. Gpt-4technicalreport,2023.
|     |     |     |     | Sur´ıs, D., | Menon, S., and | Vondrick, C. | Vipergpt: Visual |
| --- | --- | --- | --- | ----------- | -------------- | ------------ | ---------------- |
OpenAI. Newmodelsanddeveloperproductsannouncedat
inferenceviapythonexecutionforreasoning,2023.
devday,2023.
|     |     |     |     | Touvron, | H., Martin, L., | Stone, K., Albert, | P., Almahairi, |
| --- | --- | --- | --- | -------- | --------------- | ------------------ | -------------- |
Packer,C.,Fang,V.,Patil,S.G.,Lin,K.,Wooders,S.,and
|           |               |              |              | A., Babaei, | Y., Bashlykov, | N., Batra, | S., Bhargava, P., |
| --------- | ------------- | ------------ | ------------ | ----------- | -------------- | ---------- | ----------------- |
| Gonzalez, | J. E. Memgpt: | Towards llms | as operating |             |                |            |                   |
Bhosale,S.,Bikel,D.,Blecher,L.,Ferrer,C.C.,Chen,
systems,2023.
M.,Cucurull,G.,Esiobu,D.,Fernandes,J.,Fu,J.,Fu,W.,
Fuller,B.,Gao,C.,Goswami,V.,Goyal,N.,Hartshorn,
| Patel,P.,Mishra,S.,Parmar,M.,andBaral,C. |     |     | Isaquestion |     |     |     |     |
| ---------------------------------------- | --- | --- | ----------- | --- | --- | --- | --- |
A.,Hosseini,S.,Hou,R.,Inan,H.,Kardas,M.,Kerkez,
| decompositionunitallweneed? |     | 2022. |     |     |     |     |     |
| --------------------------- | --- | ----- | --- | --- | --- | --- | --- |
V.,Khabsa,M.,Kloumann,I.,Korenev,A.,Koura,P.S.,
Lachaux,M.-A.,Lavril,T.,Lee,J.,Liskovich,D.,Lu,Y.,
Patil,S.G.,Zhang,T.,Wang,X.,andGonzalez,J.E.Gorilla:
Largelanguagemodelconnectedwithmassiveapis,2023. Mao,Y.,Martinet,X.,Mihaylov,T.,Mishra,P.,Molybog,
I.,Nie,Y.,Poulton,A.,Reizenstein,J.,Rungta,R.,Saladi,
Press,O.,Zhang,M.,Min,S.,Schmidt,L.,Smith,N.A., K.,Schelten,A.,Silva,R.,Smith,E.M.,Subramanian,R.,
andLewis, M. Measuringandnarrowingthecomposi- Tan,X.E.,Tang,B.,Taylor,R.,Williams,A.,Kuan,J.X.,
tionalitygapinlanguagemodels,2023. Xu,P.,Yan,Z.,Zarov,I.,Zhang,Y.,Fan,A.,Kambadur,
11

AnLLMCompilerforParallelFunctionCalling
M.,Narang,S.,Rodriguez,A.,Stojnic,R.,Edunov,S., Zheng,H.S.,Mishra,S.,Chen,X.,Cheng,H.-T.,Chi,E.H.,
andScialom,T.Llama2:Openfoundationandfine-tuned Le, Q. V., and Zhou, D. Take a step back: Evoking
chatmodels,2023. reasoningviaabstractioninlargelanguagemodels,2023.
Wang,L.,Xu,W.,Lan,Y.,Hu,Z.,Lan,Y.,Lee,R.K.-W.,
|     |     |     |     |     |     | Zhou, A., Yan, | K., Shlapentokh-Rothman, |     | M., Wang, H., |
| --- | --- | --- | --- | --- | --- | -------------- | ------------------------ | --- | ------------- |
and Lim, E.-P. Plan-and-solve prompting: Improving and Wang, Y.-X. Language agent tree search unifies
zero-shotchain-of-thoughtreasoningbylargelanguage reasoningactingandplanninginlanguagemodels,2023a.
| models. | arXivpreprintarXiv:2305.04091,2023a. |     |     |     |     |     |     |     |     |
| ------- | ------------------------------------ | --- | --- | --- | --- | --- | --- | --- | --- |
Zhou,D.,Scha¨rli,N.,Hou,L.,Wei,J.,Scales,N.,Wang,
Wang,X.,Wei,J.,Schuurmans,D.,Le,Q.,Chi,E.,Narang, X., Schuurmans, D., Cui, C., Bousquet, O., Le, Q. V.,
S., Chowdhery, A., and Zhou, D. Self-consistency im- andChi,E.H. Least-to-mostpromptingenablescomplex
proveschainofthoughtreasoninginlanguagemodels,
|        |     |     |     |     |     | reasoning                                         | in large language | models. | In The Eleventh |
| ------ | --- | --- | --- | --- | --- | ------------------------------------------------- | ----------------- | ------- | --------------- |
| 2023b. |     |     |     |     |     | InternationalConferenceonLearningRepresentations, |                   |         |                 |
2023b.
Wei,J.,Wang,X.,Schuurmans,D.,Bosma,M.,Xia,F.,Chi,
E.,Le,Q.V.,Zhou,D.,etal.Chain-of-thoughtprompting
| elicitsreasoninginlargelanguagemodels. |     |     |     | volume35, |     |     |     |     |     |
| -------------------------------------- | --- | --- | --- | --------- | --- | --- | --- | --- | --- |
pp.24824–24837,2022.
Wolfson,T.,Geva,M.,Gupta,A.,Gardner,M.,Goldberg,
| Y.,Deutch,D.,andBerant,J. |     |     | Breakitdown:              | Aquestion |     |     |     |     |     |
| ------------------------- | --- | --- | ------------------------- | --------- | --- | --- | --- | --- | --- |
| understandingbenchmark.   |     |     | TransactionsoftheAssocia- |           |     |     |     |     |     |
tionforComputationalLinguistics,2020.
Xu,B.,Peng,Z.,Lei,B.,Mukherjee,S.,Liu,Y.,andXu,
| D. Rewoo: | Decouplingreasoningfromobservationsfor |     |     |     |     |     |     |     |     |
| --------- | -------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- |
efficientaugmentedlanguagemodels,2023.
| Yang, Z.,      | Qi, P.,                             | Zhang,      | S., Bengio, | Y., Cohen, W. | W., |     |     |     |     |
| -------------- | ----------------------------------- | ----------- | ----------- | ------------- | --- | --- | --- | --- | --- |
| Salakhutdinov, |                                     | R., and     | Manning, C. | D. Hotpotqa:  | A   |     |     |     |     |
| dataset        | for diverse,                        | explainable | multi-hop   | question      | an- |     |     |     |     |
| swering.       | arXivpreprintarXiv:1809.09600,2018. |             |             |               |     |     |     |     |     |
Yang,Z.,Dong,L.,Du,X.,Cheng,H.,Cambria,E.,Liu,
| X.,Gao,J.,andWei,F. |     |     | Languagemodelsasinductive |     |     |     |     |     |     |
| ------------------- | --- | --- | ------------------------- | --- | --- | --- | --- | --- | --- |
reasoners,2022.
Yao,S.,Zhao,J.,Yu,D.,Du,N.,Shafran,I.,Narasimhan,
| K.,andCao,Y.      |     | React: Synergizingreasoningandacting |     |     |     |     |     |     |     |
| ----------------- | --- | ------------------------------------ | --- | --- | --- | --- | --- | --- | --- |
| inlanguagemodels. |     | arXivpreprintarXiv:2210.03629,       |     |     |     |     |     |     |     |
2022.
| Yao, S., Chen, | H., | Yang, | J., and Narasimhan, | K.  | Web- |     |     |     |     |
| -------------- | --- | ----- | ------------------- | --- | ---- | --- | --- | --- | --- |
shop: Towardsscalablereal-worldwebinteractionwith
groundedlanguageagents,2023a.
Yao,S.,Yu,D.,Zhao,J.,Shafran,I.,Griffiths,T.L.,Cao,
| Y., and | Narasimhan, | K.  | Tree of Thoughts: | Deliberate |     |     |     |     |     |
| ------- | ----------- | --- | ----------------- | ---------- | --- | --- | --- | --- | --- |
problemsolvingwithlargelanguagemodels,2023b.
Yu,G.-I.,Jeong,J.S.,Kim,G.-W.,Kim,S.,andChun,B.-
| G. Orca:                | Adistributedservingsystemfor{Transformer- |     |                       |     |     |     |     |     |     |
| ----------------------- | ----------------------------------------- | --- | --------------------- | --- | --- | --- | --- | --- | --- |
| Based}generativemodels. |                                           |     | In16thUSENIXSymposium |     |     |     |     |     |     |
onOperatingSystemsDesignandImplementation(OSDI
22),pp.521–538,2022.
| Yu, W., Jiang, | M., | Clark, | P., and Sabharwal, | A. Ifqa: | A   |     |     |     |     |
| -------------- | --- | ------ | ------------------ | -------- | --- | --- | --- | --- | --- |
datasetforopen-domainquestionansweringundercoun-
terfactualpresuppositions,2023.
12

AnLLMCompilerforParallelFunctionCalling
LLMCompiler
A.AccuracyAnalysis: ReActvs.
Inthissection,wedelveintoadetailedanalysisthatcomparestheaccuracyofbothReActandLLMCompiler,highlighting
twofailurecasesthatareprevalentinReAct: (i)prematureearlystopping;and(ii)repetitivefunctioncalls. Furthermore,
wedemonstrate thatwhile thosefailure casesnegatively impacttheReAct accuracy, theycan beeffectivelyaddressed
byLLMCompiler,therebyyieldingtheimprovedaccuracyofourframework. Weanalyzetwospecificscenarios: the
MovieRecommendationevaluationwithGPT,whereReActoftenprematurelystops,leadingtosignificantlyloweraccuracy
comparedtoLLMCompiler(68.60vs. 77.13inTab.1);andtheHotpotQAevaluationwithLLaMA-270B,whereReAct’s
repetitivefunctioncallsresultinanotableaccuracydegradationcomparedtoLLMCompiler(70.00vs. 77.80inTab.1).
|     | ReAct            |     | ReAct + additional prompts |                  |     |     | LLMCompiler      |     |
| --- | ---------------- | --- | -------------------------- | ---------------- | --- | --- | ---------------- | --- |
| 1.0 |                  |     | 1.0                        |                  |     | 1.0 |                  |     |
| 0.8 |                  |     | 0.8                        |                  |     | 0.8 |                  |     |
| 0.6 |                  |     | 0.6                        |                  |     | 0.6 |                  |     |
| 0.4 |                  |     | 0.4                        |                  |     | 0.4 |                  |     |
| 0.2 |                  |     | 0.2                        |                  |     | 0.2 |                  |     |
| 0.0 |                  |     | 0.0                        |                  |     | 0.0 |                  |     |
|     | 4 5 6            | 7 8 |                            | 4 5 6            | 7 8 |     | 4 5 6            | 7 8 |
|     | # Function Calls |     |                            | # Function Calls |     |     | # Function Calls |     |
FigureA.1.DistributionsofthenumberoffunctioncallswhenrunningtheMovieRecommendationbenchmarkonReAct(Left),ReAct
withspecificpromptstoavoidearlystopping(Middle,correspondingtoReAct†inTab.1),andLLMCompiler(Right).LLMCompiler
(Right)consistentlycompletesthesearchforall8movies,whereasReAct(Left)oftenexitearly,demonstratedbyabout85%ofexamples
stoppingearly.AlthoughthecustompromptsshiftReAct’shistogramtohigherfunctioncalls(Middle),theystillfallshortofensuring
comprehensivesearchesforallmovies.gpt-3.5-turboisusedfortheexperiment.
85
80
)%( ycaruccA
75
70
|     |     |     | 65  |     | ReAct |     |     |     |
| --- | --- | --- | --- | --- | ----- | --- | --- | --- |
LLMCompiler
|     |     |     | 4   | 5   | 6 7 | 8   |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
# Function Calls on ReAct
FigureA.2.The Movie Recommendation accuracy of the examples that are categorized by the number of function calls on ReAct,
measuredbothonReActandLLMCompiler. TheplotindicatesthatinReAct,adecreaseinthenumberoffunctioncallscorrelates
withloweraccuracy,indicatingthatprematureexitsleadtoreducedaccuracy.Incontrast,whenthesameexamplesareevaluatedusing
LLMCompiler,whichensurescompletesearchesforalleightmoviesbeforereachingadecision,theyachievehigherandmoreconsistant
accuracythanthoseprocessedbyReAct.gpt-3.5-turboisusedfortheexperiment,andtheresultsareaveragedover3differentruns.
PrematureEarlyStoppingofReAct. ReActfrequentlysuffersfromprematureearlystopping,ceasingfunctioncalls
too early, and making decisions based on incomplete information. A clear example of this is observed in the Movie
Recommendationbenchmark,whereReActoftensearchesforfewerthantherequired8moviesbeforedeliveringitsfinal
answer. InFig.A.1(Left),weillustratethedistributionofthenumberoffunctioncallswithinReAct(usingGPT)across
thheMovieRecommendationbenchmark. Here,weobservearound85%oftheexamplesexhibitearlystopping,making
decisionswithoutcompletingall8moviesearches. ThiscontrastswithLLMCompiler(Right),wherealmostallexamples
(99%)completethefullsearchof8movies. AlthoughaddingspecificpromptstoReActtopreventearlystoppingshifts
thedistributiontowardsmorefunctioncalls(Fig.A.1,Middle),resultinginanaccuracyimprovementfrom68.60to72.47
(ReAct†inTab.1),itisneverthelessanimperfectsolution.
To further assess how early stopping negatively impacts accuracy, we categorize Movie Recommendation benchmark
examplesbytheirnumberoffunctioncallsinReAct. WethenevaluatedthesegroupsusingLLMCompiler,ensuring
completesearchresultsforall8movies. Fig.A.2revealsthatfewerfunctioncallsinReActcorrelatewithloweraverage
13

AnLLMCompilerforParallelFunctionCalling
|                  | ReAct       |     | LLMCompiler      |
| ---------------- | ----------- | --- | ---------------- |
| 1.0              |             | 1.0 |                  |
| 0.8              |             | 0.8 |                  |
| 0.6              |             | 0.6 |                  |
| 0.4              |             | 0.4 |                  |
| 0.2              |             | 0.2 |                  |
| 0.0              |             | 0.0 |                  |
| 1 2              | 3 4+ (div.) | 1   | 2 3 4+ (div.)    |
| # Function Calls |             |     | # Function Calls |
FigureA.3.DistributionsofthenumberoffunctioncallswhenrunningtheHotpotQAbenchmarkonReAct(Left)andLLMCompiler
(Right).WhileLLMCompiler(Right)consistentlycompletesthetaskwithin2functioncalls,whichisexpectedasHotpotQAexhibitsa
2-wayparallelizablepattern,ReAct(Left)showsthataround10%oftheexamplesundergorepetitive(>4)functioncalls,resultingina
divergingbehavioroftheframework.LLaMA-270Bisusedfortheexperiment.
60
50
)%( ycaruccA
40
30
20
ReAct
|     | 10 LLMCompiler |     |           |
| --- | -------------- | --- | --------- |
|     | 2              | 3   | 4+ (div.) |
# Function Calls on ReAct
FigureA.4.TheHotpotQAaccuracyoftheexamplesthatarecategorizedbythenumberoffunctioncallsonReAct,measuredbothon
ReActandLLMCompiler.TheplotindicatesthatinReAct,repetitivefunctioncallsofmorethanorequaltofourtimescanresultin
asignificantaccuracydegradationduetoitsinfiniteloopinganddivergingbehavior. Ontheotherhand,whenthesameexamplesare
evaluatedusingLLMCompiler,whichensuresonlytwosearchesperexample,theyachieveahigherofaround50%.LLaMA-270Bis
usedfortheexperiment.
accuracy(greenline). Conversely,iftheseexampleswereprocessedthroughLLMCompiler,withcompletesearchesfor
alleightmovies,theyconsistentlyattainedhigheraccuracy(purpleline). ThisnotonlyindicatesthatReActstruggleswith
prematureexits(whichisnotfullyaddressedbyprompting),buttheearlieritstops,thegreaterthedeclineinaccuracy,
Incontrast,LLMCompilereffectivelyaddressesthisissue.
contributingtotheoverallaccuracydropobservedinTab.1.
RepetitiveFunctionCallsofReAct. AnothercommonfailurecaseofReActisitstendencyforrepetitivefunctioncalls,
oftenleadingtoinfiniteloopsorexceedingthecontextlengthlimit. ThisproblemisparticularlynoticeableintheHotpotQA
benchmarkwhereReActrepeatedlycallsthesamefunctioniftheWikipediasearchreturnsinsufficientinformationaboutthe
searchedentity. AlthoughHotpotQAisinherently2-wayparallelizable,asillustratedinFig.A.3,weobservethatabout10%
ofitsexamplesrequiremorethanfourfunctioncallsinReAct,usuallyresultinginaninfinitelooporadivergentbehavior.
Incontrast,LLMCompilerexecutesonlytwofunctioncallsformostexamples.
To show how the repetitive function calls impact the overall accuracy, we conduct an accuracy analysis similar to the
previouscase. InFig.A.4,wecategorizeHotpotQAbenchmarkexamplesbythenumberoffunctioncallsinReAct,and
thenwecomparetheiraccuracyonbothReActandLLMCompiler. Theanalysisrevealsthatexamplesthatlaunchtwo
functioncallsinReActmaintainthesameaccuracyinLLMCompiler. However,caseswithmorethanfourfunctioncalls
inReAct,whichoftenleadtodivergentbehavior,showlessthan10%accuracyinReAct. Ontheotherhand,whenthese
examplesareprocessedwithLLMCompiler,theyachievearound50%accuracybycircumventingrepetitivecalls. Itis
worthnotingthatthereareinstanceswiththreefunctioncallsinReAct,whereanextrasearchcanleadtoimprovedaccuracy
byretryingwithanalternateentitynamewhentheinitialsearchfails, yieldingabetteraccuracythanLLMCompiler.
WhilethisshowsapotentialadaptabilityadvantageofReAct,suchinstancesrepresentlessthan3%ofcases.
14

AnLLMCompilerforParallelFunctionCalling
TableC.1.AlatencycomparisonbetweenusingandnotusingstreaminginthePlanner.Streamingyieldsconsistentlatencyimprovement
acrossdifferentbenchmarks,asitenablestheTaskFetchingUnittostarttaskexecutionimmediatelyaseachtaskisproducedbythe
Planner. TheimpactofstreamingisespeciallynotableintheParallelQAbenchmark,wheretoolexecutiontimesarelongenoughto
effectivelyhidethePlanner’sexecutiontime.
Benchmark w/ostreaming(s) w/streaming(s) Latencyspeedup
HotpotQA 4.00 3.95 1.01×
MovieRec. 5.64 5.47 1.03×
ParallelQA 21.72 16.69 1.30×
B.FailureCaseAnalysisofLLMCompiler
ThissectiondelvesintoaqualitativeanalysisofLLMCompiler’sfailurecasesontheParallelQAbenchmark,whichcan
bebroadlyattributedtofailuresinthePlanner,Executor,orthefinaloutputprocess. Failuresinthefinaloutputprocess
refertocaseswhenLLMsareunabletousetheobservationscollectedfromtoolexecution(whichareincorporatedinto
thecontext)todeliverthecorrectanswertotheuser. Amongthe10.6%(36examples)ofLLMCompiler’stotalfailures
reportedinTab.1,wehavenotedthatthePlanner,Executor,andfinaloutputprocesscontributedto8%,64%,and28%of
thefailures,respectively. ThePlanner’s8%failurerateisexclusivetoLLMCompiler. Forinstance,thePlannerwould
incorrectlymapinputsandoutputsbyassigningawrongidentifierasaninputtoasubsequenttask,therebyformingan
incorrectDAG.However,withadequatetooldefinitionsandin-contextexamples,Plannererrorsaresignificantlyreduced
(only3instancesintotalthroughoutourevaluation),highlightingtheLLM’scapabilitytodecomposeproblemsintocomplex
multi-taskdependencies.
Theremaining92%ofthetotalfailuresareattributedtotheExecutorandthefinaloutputprocess. TheExecutoraccounts
for most of these failures (64%), with common issues like the math tool choosing wrong attributes or mishandling
unitconversions. Forthefinaloutputprocess(28%offailures),errorsincludeincorrectconclusionsfromthegathered
observations,suchasfailingtopickthesmallestattributefromthecollecteddata. It’sworthnotingthattheseproblemsare
notexclusivetoLLMCompiler,buttheyalsooccurinReAct. Nevertheless,LLMCompilertendstohaveslightlyfewer
failuresintheseareasthanReAct,asitprovidesonlyrelevantcontextstoeachtool,aidinginmoreaccurateinformation
extraction. Webelievethatoptimizingthestructureoftheagentscratchpad,ratherthansimplyappendingobservations,
couldfurtherreducefailuresinthefinaloutputprocess.
C.RelatedWork
Here,wecontinuewithrelatedwork,whichwestartedinSec.2.
C.1.Tool-AugmentedLLMs
AnotableworkisToolformer(Schicketal.,2023),whichproducesacustomLLMoutputtolettheLLMdecidewhatthe
inputsforcallingthefunctionsshouldbeandwheretoinserttheresult. Thisapproachhasinspiredvarioustoolcalling
frameworks(Liangetal.,2023;Shenetal.,2023). ReAct(Yaoetal.,2022)proposedtohaveLLMsinteractwithexternal
environmentsthroughreasoningandactiongenerationforimprovedperformance. Gorilla(Patiletal.,2023)introduceda
finetunedLLMdesignedforfunctioncalling,andToolLLM(Qinetal.,2023)andRestGPT(Songetal.,2023)haveextended
LLMstosupportreal-worldAPIs. Moreover,OpenAI(OpenAI,2023)releasedtheirownfunctioncallingcapabilities,
allowingtheirLLMstoreturnformattedJSONforexecution.
D.ExperimentalDetails
Ourexperimentsevaluatetwodifferentcommonscenarios: (1)usingAPI-basedclosed-sourcemodels;and(2)usingopen-
sourcemodelswithanin-houseservingframework. WeuseOpenAI’sGPTmodelsasclosed-sourcemodels,inparticular,
gpt-3.5-turbo(1106release)forHotpotQAandMovieRecommendation,gpt-4-turbo(1106release)forParallelQA,and
gpt-4 (0613 release) for Game of 24. Experiments on HotpotQA, Movie Recommendation, and ParallelQA were all
conducted in November 2023 after the 1106 release. The Game of 24 experiments were conducted over a two-month
periodfromSeptembertoOctober2023. Foranopen-sourcemodel,weuseLLaMA-2(Touvronetal.,2023),whichwas
hostedon2A100-80GBGPUsusingthevLLM(Kwonetal.,2023)framework. Alltherunshavebeencarriedoutwith
15

AnLLMCompilerforParallelFunctionCalling
zerotemperature,exceptforthought proposerandstate evaluatorfortheGameof24evaluation,wherethe
temperatureissetto0.7. SinceOpenAIhasrandomnessinoutputsevenwithtemperature0,wehaveconducted3runs,and
wereportedtheaverageaccuracy. AcrossReAct,OpenAIparallelfunctioncalling,andLLMCompiler,weperform3,
1,and5-shotlearningforHotpotQA,MovieRecommendation,andParallelQA,respectively;thesameexamplesacross
differentmethodswereusedtoensureafaircomparison. FortheGameof24,weuse2in-contextexamplesforthePlanner.
Weusethesameinstructionpromptsacrossdifferentmethodsforafaircomparison,exceptforReAct† inSec.5.1with
additionalReAct-specificprompts. ForWebShopexperiment,weusegpt-4-0613with8kcontextwindowandgpt-3.5-turbo
modelwith16kcontextwindow.
E.Analysis
E.1.ParallelSpeedupModeling
WhileLLMCompilershowsnoticeablelatencygaininvariousworkloads,itisnotachievingtheN×latencyspeedup
for N-way parallel workloads. This is mostly due to the overhead associated with LLMCompiler’s Planner and final
answeringprocessthatcannotbeparallelized. InourMovieRecommendationexperiment,LLMCompiler’sPlannerand
theansweringprocesshaveanoverheadof1.88and1.62secondsonaverage, respectively, whosecombinedoverhead
alreadycomprisesmorethanhalfofLLMCompiler’soveralllatencyinTab1. Anothersourceofoverheadisthestraggler
effectamongtheparalleltaskswhentheyneedtojointogether. Weobservetheaveragelatencyoftheslowestsearchto
be1.13seconds,whichisnearly2×theaveragelatencyofalltasks,whichis0.61seconds. Below,weprovideananalytical
latencymodelingofReAct,LLMCompiler,andLLMCompilerwithstreaming,andweprovideananalysisofachievable
latencyspeedup.
In this section, our focus is on embarrassingly parallelizable workload (pattern Fig. 3(a)), as this allows for a clearer
understandingoftheimpactofeachcomponentonpotentiallatencygains. Forthepreciselatencyanalysis,weconsider
threekeycomponents:thePlanner,theTaskFetchingUnit,andtheExecutor,inFig.2. AssumethatthePlannergeneratesN
differenttaskstobedone. WedefineP asthePlanner’soutputcorrespondingtothei-thatomictask. EachP isablueprint
i i
foraspecificatomictask,whichwerefertoasE . TheexecutionofE involvesaspecificfunctioncallusingtheappropriate
i i
tool. Thelatencyfunctionofeachunitinthesystemisdefinedtoquantifythetimetakenforspecificoperations. Forthe
Planner,thelatencyisdenotedasT (P ),representingthetimetakenbythePlannertogeneratetheplanP . Similarly,for
P i i
theExecutor,thelatency,T (E ),correspondstothetimerequiredtocompletethetaskE . WeignorethelatencyofTask
E i i
FormulationUnit,asitisnegligibleinthissection. OurfocushereisoncomparingthelatencymodelsofReAct(Yaoetal.,
2022),andLLMCompiler.
TobeginouranalysisofReAct’slatency,weexpressitstotallatencyas:
N
TR = (cid:88)(cid:0) TR(P )+T (E ) (cid:1) . (1)
P i E i
i=1
Here,thesuperscriptRreferstoReAct. IntheReActagentsystem,theprocesstypicallyinvolvesinitialthoughtgeneration,
followed by action generation and the acquisition of observations through function calls associated with the tool. The
creationofboththoughtandactionarecollectivelyconsideredaspartofgeneratingP . Itisimportanttonotethatwhilethe
i
Planner’slatencyisdenotedwithasuperscript(indicatingReAct),theExecutor’slatencydoesnothavesuchasuperscript.
ThisisbecausethefunctioncallingandthetoolsexecutionremainthesamebetweenReActandLLMCompiler.
ForLLMCompiler,whereallparallelizabletasksareprocessedconcurrently,thetotallatencyisdeterminedbytheslowest
taskamongthesetasks. Hence,thelatencymodelforLLMCompilercanberepresentedas:
N
(cid:88)
TC = TC(P )+ max T (E ). (2)
P i E k
k∈1,...,N
i=1
Thisexpressioncapturesthesumofallplanningtimesplustheexecutiontimeofthelongesttask,reflectingthesystem’s
focusonparallelexecution.
16

AnLLMCompilerforParallelFunctionCalling
Latency vs. # Parallelizable Tasks
|     | 50  | ReAct |     |     |     |     |     |
| --- | --- | ----- | --- | --- | --- | --- | --- |
LLMCompiler (Ours)
40
)s( ycnetaL
30
20
10
0
|     |     | 2   | 3   | 4   | 5   |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- |
Number of Parallelizable Tasks
FigureE.5. LatencyontheParallelQAbenchmarkgroupedbythenumberofmaximumparallelizabletasks.
Further,ifthePlanneremploysstreamingofthedependencygraph,thelatencymodelundergoesamodificationandcanbe
expressedas:
|     |     |     | (cid:88) N |         |         |     |     |
| --- | --- | --- | ---------- | ------- | ------- | --- | --- |
|     | TSC |     | TC(P       |         |         |     |     |
|     |     | =   |            | i )+T E | (E N ). |     | (3) |
P
i=1
ItisimportanttonotethatTSC ≤TC. Thisimpliesthatthestreamingmechanismallowsforamoreefficienthandlingof
taskdependencies,potentiallyreducingoveralllatency.
InevaluatingthepotentialspeedupachievablewiththeLLMCompilerframeworkcomparedtoReAct,thespeedupmetric,
denotedasγ,isdefinedasfollows:
|     |     |           | (cid:0)        |           | (cid:1) |     |     |
| --- | --- | --------- | -------------- | --------- | ------- | --- | --- |
|     | TR  |           | (cid:80)N TR(P | )+T       | (E )    |     |     |
|     |     |           | i=1 P          | i         | E i     |     |     |
| γ = | =   |           |                |           |         | .   | (4) |
|     | TC  | (cid:80)N | TC(P           |           |         |     |     |
|     |     |           | i )+max        | k∈1,...,N | T E (E  | k ) |     |
|     |     | i=1       | P              |           |         |     |     |
ThisratiorepresentsthecomparativeefficiencyofLLMCompileroverReAct,consideringbothplanningandexecution
latencies.
To estimate the upper bound of this speedup, γ , we assume that the executor latency T (E ) is dominant over the
|     |     | max |     |     |     | E i |     |
| --- | --- | --- | --- | --- | --- | --- | --- |
planninglatencyT (P )andallthelatenciesofexecutingtasksremainthesame. Underthisassumption,theupperboundis
P i
calculatedas:
(cid:80)N
|     |     |     | T   | (E ) |     |     |     |
| --- | --- | --- | --- | ---- | --- | --- | --- |
|     | γ   | ≈   | i=1 | E i  | =N, |     | (5) |
max
|     |     | max |           | T (E | )   |     |     |
| --- | --- | --- | --------- | ---- | --- | --- | --- |
|     |     |     | k∈1,...,N | E k  |     |     |     |
indicatingthetheoreticalmaximumspeedup,γ ,isequaltothenumberoftasks,N.
max
Ontheotherhand,thelowerboundofthespeedup,γ,isobservedwhentheplanninglatencyisthepredominantfactor.
Given that the planning latencies of both ReAct and LLMCompiler are generally similar, the minimum speedup is
approximatedas:
|     |     |         | (cid:80)N TR(P | )   |     |     |     |
| --- | --- | ------- | -------------- | --- | --- | --- | --- |
|     |     |         | i=1            | P i |     |     |     |
|     |     | γ min ≈ |                | ≈1. |     |     | (6) |
|     |     |         | (cid:80)N TC(P | )   |     |     |     |
|     |     |         | i=1            | P i |     |     |     |
Fromtheseobservations,wecanconcludethattoachievesignificantlatencygainswithLLMCompiler,itiscrucialto(i)
reducetheplanneroverheadand(ii)minimizetheoccurrenceofstragglers.
E.2.LatencyversusNumberofParallelizableTasks
InFig.E.5,wealsoreportamoredetailedlatencybreakdownonParallelQAwhereweshowtheend-to-endlatencyasa
functionofthenumberofparalleltasks. Thisisoftenreferredtoasweak-scalinginhigh-performancecomputing,wherethe
idealbehavioristohaveaconstantlatencyasthenumberoftasksisincreased. WecanseethatReAct’slatencyincreases
proportionallytothenumberoftasks,whichisexpectedasitexecutesthetaskssequentially. Incontrast,thelatencyof
LLMCompilerincreasesatamuchsmallerrate,asitcanperformmultiplefunctioncallsinparallelwhenpossible. The
reasontheend-to-endlatencyincreasesslightlywithLLMCompilerisduetotheoverheadofthePlanner,whichneedsto
generateplansinitially,andwhichcannotbeparallelized. WeprovideafurtheranalysisofthisinAppendixE.1.
17

AnLLMCompilerforParallelFunctionCalling
TableE.2.AccuracyandlatencycomparisonofLLMCompilercomparedtoReActontheHotpotQAbridgebenchmark.ReAct†denotes
ReActwithadditionalpromptingthatminimizesloopingandearlystopping,similartoTab.1.
|     |             | Method | Accuracy(%) | Latency(s) |     |
| --- | ----------- | ------ | ----------- | ---------- | --- |
|     |             | ReAct  | 22.7        | 7.07       |     |
|     |             | ReAct† | 23.1        | 6.42       |     |
|     | LLMCompiler |        | 26.3        | 4.70       |     |
TableE.3.QualitativecomparisonbetweenLLMCompilerandotherframeworksincludingReAct(Yaoetal.,2022),TPTU(SAfor
SequentialAgentandOAforOne-stepAgent)(Ruanetal.,2023a),ViperGPT(Sur´ısetal.,2023)andHuggingGPT(Shenetal.,2023).
| Method      |     | Planning | Replanning | ParallelExecution | Domain  |
| ----------- | --- | -------- | ---------- | ----------------- | ------- |
| ReAct       |     | X        | -          | X                 | All     |
| TPTU-SA     |     | X        | -          | X                 | All     |
| TPTU-OA     |     | O        | X          | X                 | All     |
| ViperGPT    |     | O        | X          | X                 | Limited |
| HuggingGPT  |     | O        | X          | O                 | Limited |
| LLMCompiler |     | O        | O          | O                 | All     |
E.3.AdditionalExperimentsontheHotpotQABridgeBenchmark
InourmainexperimentsinSec.5.1,weusedthecomparisonbenchmarkinHotpotQAtodemonstratethecapabilityof
LLMCompilerinefficientlyexecuting2-wayparallelizableworkloads. Theotherpartofthebenchmark,called‘bridge,’
involvessequentialtaskssuchas“WhatgovernmentpositionwasheldbythewomanwhoportrayedCorlissArcherinthe
filmKissandTell?”LLMCompilerisnotlimitedtothecomparisonbenchmark,butitcanalsobeappliedtothebridge
benchmarkduetoitsreplanningcapability: initially,itsearchesforthewomanwhoplayedCorlissArcherinthefilmKiss
andTell,andthen,throughreplanning,searchesthegovernmentpositionheldbythiswomanfortheexampleabove.
Similartoourexperimentswiththecomparisonbenchmark,Tab.E.2comparesLLMCompileragainstReActandReAct
withtheadditionalpromptthatavoidsrepetitivefunctioncallingandearlystopping(ReAct†)onthebridgebenchmark. We
observe4and3%accuracyimprovement,respectively,whichisattributedtoReAct’srepetitivefunctioninvocation–even
withtheadditionalprompt(ReAct†),wehavestillobserved5%oftheexamplesfailingwiththisissue. Furthermore,such
repetitivefunctioncallalsoaccountsfortheslightlyhigherlatencyofReActcomparedtoours.Thisexperimentdemonstrates
thatLLMCompilerallowsforefficientandaccuratefunctioncallingforbothparallelandsequentialworkloads.
F.AdditionalDiscussionsaboutRelatedWorks
TPTU(Ruanetal.,2023a),HuggingGPT(Shenetal.,2023),andViperGPT(Sur´ısetal.,2023)haveintroducedend-to-end
plan-and-solveframeworks. Inthissection,wediscusshowLLMCompilerdistinguishesitselffromotherframeworks
fromvariousangles,includingthecapabilitiesin(i)planningandreplanning;(ii)parallelexecution;and(iii)addressinga
widerrangeofproblemdomains. RefertoTab.E.3forthesummary.
Parallel Execution: Parallel execution is a critical feature in the LLMCompiler framework that allows for efficient
functioncallingandjobcompletion. WhiletheOne-stepAgentinTPTU(i.e.,TPTU-OA)incorporatesplanning,itdoes
notenableparallelfunctioncalling,asitonlydecomposesauserinputintoasequenceoffunctionsandtheassociated
argumentswithouttheirinter-dependencies. ViperGPTgeneratesPythoncodes. However,ViperGPT,byitself,doesnot
supportparallelexecutionwithoutadedicatedparallelprocessingenginesincethestandardPythoninterpreterlackssupport
forparallelexecution. WhileHuggingGPTenablesparallelexecution,itstrictlytargetsmodelsinHuggingFace,makingit
hardtoapplyinawiderangeofproblemsanddomainsthatLLMCompilersupports.
PlanningandReplanning: TheTPTU’sSequentialAgent(i.e.,TPTU-SA)isaniterativeframeworklikeReAct(Yao
etal.,2022)thatexecutesoneactionperiteration. WhileTPTU-OA,HuggingGPT,andViperGPTareallplanning-based
frameworksthatplanoutmultipleactionspriortoexecution,theylackreplanningcapabilities. LLMCompiler,incontrast,
incorporatesthereplanningmechanismtogenerateanewsetoftaskswhenthepreviousplansarenotsufficientenoughto
delivertheresponsebacktotheuser. ThisenablesLLMCompilertoadaptplansbasedonintermediateresultsthatarea
prioriunknown,withouttheneedforintroducingcomplexbranchinglogic,therebyextendingthescopeofproblemsthatit
canaddress.
18

AnLLMCompilerforParallelFunctionCalling
TableF.4.AccuracyandlatencyspeedupcomparisonofLLMCompilercomparedtoReActandTPTU(SAforSequentialAgentandOA
forOne-stepAgent)ontheHotpotQAcomparisonbenchmarkusinggpt-3.5-turbo.ReAct†andTPTU-SA†denoteReActandTPTU-SA
withadditionalpromptingthatminimizesloopingandearlystopping,respectively,similartoTab.1.
|     |     |     |     | Method      | Accuracy(%) |       | Speedup |     |
| --- | --- | --- | --- | ----------- | ----------- | ----- | ------- | --- |
|     |     |     |     | ReAct       |             | 61.52 | -       |     |
|     |     |     |     | ReAct†      |             | 62.47 | 1×      |     |
|     |     |     |     | TPTU-SA     |             | 34.16 | -       |     |
|     |     |     |     | TPTU-SA†    |             | 44.59 | 1.09×   |     |
|     |     |     |     | TPTU-OA     |             | 57.50 | 1.35×   |     |
|     |     |     |     | LLMCompiler |             | 62.00 | 1.51×   |     |
ProblemDomains:ViperGPTandHuggingGPTaimforvisiontasksviaPythoncodegenerationandmodelsinHuggingFace,
respectively,showingsignificantpromiseinthesespecificareas. Incontrast,LLMCompilertargetsageneralframework
thatenablesefficientandaccuratefunctioncallinginawiderangeofproblemdomains, ratherthanrestrictingitselfto
specificfields.
F.1.QuantitativeComparisonbetweenLLMCompilerandTPTU
Additionally,inTab.F.4,weadditionallyprovideaccuracyandlatencyspeedupofLLMCompileragainstTPTU-SAand
TPTU-OA.SincetheofficialimplementationofTPTUisnotavailable,weimplementedTPTU-SAandTPTU-OAbasedon
thepromptsprovidedintheoriginalpaper. Ascanbeseeninthetable,theresultsclearlydemonstrateLLMCompiler’s
latencyandaccuracybenefitoverbothTPTU-SAandTPTU-OA.ComparedwithTPTU-SA,LLMCompilerexhibitsa
significantaccuracyimprovementduetoTPTU’sprevalentissuewithrepetitivefunctioncalls. Notethatthisissueisnot
fullymitigatedevenwithbetterprompting(TPTU-SA†),leadingto∼15%ofexamplesfailingwithrepetitivefunctioncalls.
ComparedwithbothTPTU-SAandTPTU-OA,LLMCompileralsobenefitsfromreducedlatencythroughparalleltask
execution. Overall,theresultsareconsistentwiththemainexperimentsandanalysisagainstotherbaselinemethods(i.e.,
ReActandOpenAI’sparallelfunctioncalling).
G.User-SuppliedExamplesforLLMCompilerConfiguration
LLMCompilerprovidesasimpleinterfacethatallowsfortailoringtheframeworktodifferentusecasesbyprovidingtool
definitionsaswellasoptionalin-contextexamplesforthePlanner. Below,weprovidethePlannerexamplepromptsthatare
usedtosetuptheframeworkfortheMovieRecommendationandGameof24benchmarkswithonlyafewlinesofprompts.
G.1.MovieRecommendationExamplePrompts
Question: Find a movie similar to Mission Impossible, The Silence of the
| Lambs, | American | Beauty, |     | Star Wars | Episode | IV  | - A New | Hope |
| ------ | -------- | ------- | --- | --------- | ------- | --- | ------- | ---- |
Options:
| Austin  | Powers  | International |     | Man of     | Mystery |     |     |     |
| ------- | ------- | ------------- | --- | ---------- | ------- | --- | --- | --- |
| Alesha  | Popvich | and Tugarin   |     | the Dragon |         |     |     |     |
| In Cold | Blood   |               |     |            |         |     |     |     |
Rosetta
| 1. search("Mission  |     |         | Impossible") |                |         |              |              |     |
| ------------------- | --- | ------- | ------------ | -------------- | ------- | ------------ | ------------ | --- |
| 2. search("The      |     | Silence |              | of the Lambs") |         |              |              |     |
| 3. search("American |     |         | Beauty")     |                |         |              |              |     |
| 4. search("Star     |     | Wars    | Episode      | IV             | - A New | Hope")       |              |     |
| 5. search("Austin   |     | Powers  |              | International  |         | Man          | of Mystery") |     |
| 6. search("Alesha   |     | Popvich |              | and Tugarin    |         | the Dragon") |              |     |
| 7. search("In       |     | Cold    | Blood")      |                |         |              |              |     |
8. search("Rosetta")
| Thought: | I   | can answer | the | question | now. |     |     |     |
| -------- | --- | ---------- | --- | -------- | ---- | --- | --- | --- |
19

AnLLMCompilerforParallelFunctionCalling
9. finish()
###
G.2.Gameof24ExamplePrompts
Question: "1 2 3 4", state list: [""]
$1 = thought proposer("1 2 3 4", "")
$2 = state evaluator("1 2 3 4", "$1")
$3 = top k select("1 2 3 4", ["$1"], ["$2"])
$4 = finish()
###
Question: "1 2 3 4", state list: ["1+2=3(left:3 3 4)","2-1=1(left:1 3
4)","3-1=2(left:2 2 4)","4-1=3(left:2 3 3)","2*1=2(left:2 3 4)"]
$1 = thought proposer("1 2 3 4", "1+2=3(left:3 3 4)")
$2 = thought proposer("1 2 3 4", "2-1=1(left:1 3 4)")
$3 = thought proposer("1 2 3 4", "3-1=2(left:2 2 4)")
$4 = thought proposer("1 2 3 4", "4-1=3(left:2 3 3)")
$5 = thought proposer("1 2 3 4", "2*1=2(left:2 3 4)")
$6 = state evaluator("1 2 3 4", "$1")
$7 = state evaluator("1 2 3 4", "$2")
$8 = state evaluator("1 2 3 4", "$3")
$9 = state evaluator("1 2 3 4", "$4")
$10 = state evaluator("1 2 3 4", "$5")
$11 = top k select("1 2 3 4", ["$1", "$2", "$3", "$4", "$5"], ["$6", "$7",
"$8", "$9", "$10"])
$12 = finish()
###
H.Pre-definedLLMCompilerPlannerPrompts
Thepre-definedLLMCompilerPlannerpromptprovidesitwithspecificinstructionsonhowtobreakdowntasksand
generatedependencygraphswhileensuringthattheassociatedsyntaxisformattedcorrectly. Thispromptcontainsspecific
rulessuchasassigningeachtasktoanewline,beginningeachtaskwithanumericalidentifier,andusingthe$signto
denoteintermediatevariables.
- Each action described above contains input/output types and descriptions.
- You must strictly adhere to the input and output types for each action.
- The action descriptions contain the guidelines. You MUST strictly follow
those guidelines when you use the actions.
- Each action in the plan should strictly be one of the above types. Follow
the Python conventions for each action.
- Each action MUST have a unique ID, which is strictly increasing.
- Inputs for actions can either be constants or outputs from preceding
actions. In the latter case, use the format $id to denote the ID of the
previous action whose output will be the input.
- Ensure the plan maximizes parallelizability.
- Only use the provided action types. If a query cannot be addressed using
these, invoke the finish action for the next steps.
- Never explain the plan with comments (e.g. #).
- Never introduce new actions other than the ones provided.
20

AnLLMCompilerforParallelFunctionCalling
Inadditiontouser-providedfunctions,thePlannerincludesaspecial,hard-codedfinishfunction. ThePlannerusesthis
functioneitherwhentheplanissufficienttoaddresstheuserqueryorwhenitcannolongerproceedwithplanningbefore
executingthecurrentplan,i.e.,whenitdeemsreplanningnecessary. WhenthePlanneroutputsthefinishfunction,its
plangenerationstops. RefertoAppendixGforexamplesofthePlanner’susageofthefinishfunctioninplanning. The
definitionofthefinishfunctionisasbelowandisincludedasaprompttothePlanneralongwiththedefinitionsofother
user-providedfunctions.
finish():
- Collects and combines results from prior actions.
- A LLM agent is called upon invoking join to either finalize the user
query or wait until the plans are executed.
- join should always be the last action in the plan, and will be called in
two scenarios:
(a) if the answer can be determined by gathering the outputs from tasks to
generate the final response.
(b) if the answer cannot be determined in the planning phase before you
execute the plans.
I.ParallelQABenchmarkGeneration
Inspired by the IfQA benchmark (Yu et al., 2023), our custom benchmark ParallelQA contains 113 examples that are
designedtousemathematicalquestionsonfactualdetailsofdifferententitiestoanswerquestions,thusrequiringamixof
searchandmathematicaloperationsthatareinterdependentinvariousways. Forinstance,thebenchmarkincludesexamples
like“IfTexasandFloridaweretomergeandbecomeonestate,aswellasCaliforniaandMichigan,whatwouldbethe
largestpopulationdensityamongthese2newstates?” requiresfourparallelsearchtasks,followedbymathtasksdependent
onthesearchoutcomes,thatcanbeexecutedinparallel.
Themainobjectiveofthebenchmarkistoquantifytheframework’sabilitytodecomposeaninputintomultipletasksto
deriveananswer. Therefore,wehavemeticulouslyselected56distinctentitiesacrossvariousdomainswhoseattributes
canbeaccessiblefromWikipediasearch. Byminimizingtoolexecution(i.e.,Wikipediasearch)failures,wehaveaimed
our benchmark to effectively assess the frameworks’ abilities to decompose questions into multiple tasks, plan them
out,andderivefinalanswersbasedonobservations. Furthermore,toincorporatediverseexecutionpatterns,wecrafted
variousdependencypatternsthatperformunaryandbinarymathoperationsaftersearchingforadditionalinformationabout
entitiesinagivenquestion. Wehavealsocurateddifferentquestionsthataccommodatedifferentnumbersofmaximally
parallelizabletasks,rangingfrom2to5,andwehaveincludedvaryingnumbersofjoinsbetweenparallelfunctioncalls
as well to increase problem complexity. For instance, we have 2 and 3 joins in Fig. 3 (b) and (c), respectively. The
benchmarkcontains113differentexamples,thatwerepopulatedbyGPT-4basedontheaforementionedcriteriaandlabeled
byhumansafterward.
J.DetailsoftheGameof24andtheTree-of-ThoughtsApproach
TheGameof24isamathematicalreasoninggamethatchallengesplayerstomanipulateagivensetoffournumbers,using
thebasicarithmeticoperationsofaddition,subtraction,multiplication,anddivision,toarriveatthenumber24. Theruleof
thisgameisthatthegivennumbersmustbeusedonlyonce. Forinstance,giventhenumbers2,4,4,and7,onepossible
solutionis4×(7−4)×2=24. Thisisanon-trivialreasoningbenchmarkforLLMs,highlightedbythefactthateven
advanced models like GPT-4 exhibit only a 4% success rate, even when using chain-of-thought prompting (Yao et al.,
2023b).
In ToT, the problem is solved in several steps. At each step, the LLM, referred to as the thought proposer, generates
thoughts. Eachthoughtisapartialsolutionthatconsistsoftwonumbersandanarithmeticoperationbetweenthem. Then,
thesethoughtsarefedintothestateevaluatorwhichassignsalabelforeachofthem. Theselabelsare‘sure,’‘likely,’and
‘impossible,’whicharegiventothoughtstodenotehowlikelytheycouldproduce24withadditionalarithmeticoperations
betweentheresultandtheremainingnumbers. Onlythethoughtsthatarelikelytoproduce24continueontothenextstep.
ThisprocessisillustratedinFigureJ.6.
21

AnLLMCompilerforParallelFunctionCalling
Input: 2, 4, 4, 7
Thought Proposer
4+4=8 7-4=3 7/2=3.5
(left: 2, 7, 8) (left: 2, 3, 4) (left: 3.5, 4, 4) Input: 2, 4, 4, 7
Possible next steps:
State Evaluator
4-2=2 2*3=6 4/2=2
(left: 2, 3) (left: 4, 6) (left: 2, 3) Evaluate if given numbers can reach 24
(sure/likely/impossible)
4*6=24
(left: 24)
FigureJ.6.VisualizationoftheTreeofThoughts(ToT)intheGameof24.Eachnoderepresentsadistinctproposal,beginningwiththe
rootnodeandbranchingoutthroughtheapplicationofsingleoperationsbythethoughtproposer.Subsequentstatesareevaluatedbythe
stateevaluatorfortheirpotentialtoreachthetargetnumber24.TheToTretainsthetop-5statesaccordingtotheirvalues.
K.DetailsofWebShopExperiments
K.1.WebShopEnvironment
TheWebShopenvironmentsimulatesanonlineshoppingplatform. Tasksaredesignedfortheagenttofindtheitemthatbest
matchesthegiveninstruction. Forinstance,iftheinstructionspecifies,“Iamlookingforaqueen-sizedbedthatisblack,
andpricedlowerthan140.00dollars,”theagent’staskistopinpointthebedthatpreciselyfitsthesecriteria: “queen-sized,”
“black,” and “priced under 140.00 dollars.” For each item, there is an associated reward measuring how well this item
matchestheinstructionbasedonprice,itemoptions,andotherdetailscontainedintheitempage. Theevaluationmetrics
arethesuccessrate—theproportionofepisodeswheretheselectedproductsatisfiesallrequirements—andtheaverage
score—themeanrewardacrossepisodes.
K.2.BaselineMethods
InadditiontoReAct,weuseLASER(Maetal.,2023)andLATS(Zhouetal.,2023a)asbaselinemethodstocompare
againstLLMCompiler. LASER(Maetal.,2023)solvestasksthroughastate-explorationapproach. Inthecontextof
WebShop,thepossibleenvironmentpagesareencodedasdifferentstates(e.g.,searchpage,itempage,anditemdetail
subpage). Actionsareusedtotransitionbetweenthesestates,suchasexecutingasearchquery,selectinganitem,checking
theitemdetail,navigatingthenextsearchpageandsoon. TheWebshopexplorationisthereforereducedtoasearchproblem
onthegivenstate-spacegraph.
UsingavariantofMonteCarloTreeSearch,LATS(Zhouetal.,2023a)plansitsactionsbyconstructingadecisiontree,
evaluatingpotentialmovesbasedontheirlikelihoodofsuccess,andselectingactionsthroughabalanceofexplorationand
exploitation. Theagentthenadaptsitsstrategybasedonfeedbackfromtheenvironment,learningfrombothsuccessesand
failurestorefineitsdecision-makingprocess. ThisiterativeapproachallowsLATStonavigatecomplexonlineshopping
tasks,albeitmuchmoreslowlyduetoitsexhaustivetreesearch.
22
<!-- 出典: https://arxiv.org/pdf/2312.04511 | 取得日: 2026-07-15 | 取得方法: MarkItDown（PDF、bytes確認） | 確度: 中（function-calling中心の著者実験。repository writer schedulingへの一般化は未実証） -->
