Graph-enhanced Large Language Models in Asynchronous Plan Reasoning
FangruLin1 EmanueleLaMalfa12 ValentinHofmann134 ElleMichelleYang1
|     |     |     | AnthonyG.Cohn25 |     |     | JanetB.Pierrehumbert1 |     |     |     |     |     |
| --- | --- | --- | --------------- | --- | --- | --------------------- | --- | --- | --- | --- | --- |
Abstract
Planningisafundamentalpropertyofhumanin-
| telligence. | Reasoningaboutasynchronousplans |     |     |     |     |     |     |     |     |     |     |
| ----------- | ------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
4202 nuJ 3  ]IA.sc[  2v50820.2042:viXra
ischallengingsinceitrequiressequentialandpar-
| allelplanningtooptimizetimecosts. |                                    |                |                 |           | Canlarge   |     |     |     |     |     |     |
| --------------------------------- | ---------------------------------- | -------------- | --------------- | --------- | ---------- | --- | --- | --- | --- | --- | --- |
| language                          | models                             | (LLMs)         | succeed         | at        | this task? |     |     |     |     |     |     |
| Here,                             | we present                         | the first      | large-scale     |           | study in-  |     |     |     |     |     |     |
| vestigating                       |                                    | this question. | We              | find that | a repre-   |     |     |     |     |     |     |
| sentative                         | set                                | of closed      | and open-source |           | LLMs,      |     |     |     |     |     |     |
| including                         | GPT-4                              | and LLaMA-2,   |                 | behave    | poorly     |     |     |     |     |     |     |
| when                              | not supplied                       | with           | illustrations   |           | about the  |     |     |     |     |     |     |
| task-solving                      |                                    | process in     | our benchmark   |           | Asyn-      |     |     |     |     |     |     |
| cHow.                             | WeproposeanoveltechniquecalledPlan |                |                 |           |            |     |     |     |     |     |     |
LikeaGraph(PLaG)thatcombinesgraphswith
naturallanguagepromptsandachievesstate-of-
| the-art   | results. | We show      | that | although | PLaG       |     |     |     |     |     |     |
| --------- | -------- | ------------ | ---- | -------- | ---------- | --- | --- | --- | --- | --- | --- |
| can boost | model    | performance, |      | LLMs     | still suf- |     |     |     |     |     |     |
ferfromdrasticdegradationwhentaskcomplex-
| ity increases, |     | highlighting | the | limits | of utiliz- |     |     |     |     |     |     |
| -------------- | --- | ------------ | --- | ------ | ---------- | --- | --- | --- | --- | --- | --- |
ing LLMs for simulating digital devices. We Figure1.Aplanningtask(top)canbeexecutedsequentially,in
see our study as an exciting step towards using parallel,orasynchronously. Bluearrowsdenoteactionordering
constraints.Althoughcompleteparallelismislogicallythemost
| LLMsasefficientautonomousagents. |     |     |     |     | Ourcode |                |           |            |     |         |                       |
| -------------------------------- | --- | --- | --- | --- | ------- | -------------- | --------- | ---------- | --- | ------- | --------------------- |
|                                  |     |     |     |     |         | time-efficient | strategy, | it results | in  | invalid | reasoning steps (e.g. |
anddataareavailableathttps://github.com/
|     |     |     |     |     |     | ‘Baking’ | cannot | happen at | the same | time | with ‘Rolling the |
| --- | --- | --- | --- | --- | --- | -------- | ------ | --------- | -------- | ---- | ----------------- |
fangru-lin/graph-llm-asynchow-plan.
dough’);atthesametime,sequentiallyexecutingeachtaskneg-
|     |     |     |     |     |     | atively affects | efficiency. |     | Given infinite | resources, | an optimal |
| --- | --- | --- | --- | --- | --- | --------------- | ----------- | --- | -------------- | ---------- | ---------- |
(asynchronous)planshouldparallelizeactionswhereverpossible.
1.Introduction
Aslargelanguagemodels(LLMs)showunprecedentedca- et al., 2023; Song et al., 2023). Although LLMs gener-
pabilities,claimssurgethatartificialgeneralintelligenceis ate reasonable elementary planning steps when informed
close(Bubecketal.,2023). Planningisanimportantprop- withappropriateguidance(Huangetal.,2022b;Yuanetal.,
ertyofhumanintelligence(Sternberg,1984;Colometal.,
2023),theycannotcombinethoseunitseffectivelyandde-
2010),anditisalsovitalinmanydownstreamtaskssuchas velopoptimalplanswithoutexternalprocessors(Silveretal.,
developingautonomousroboticagents(Huangetal.,2022a; 2022;Daganetal.,2023;Yangetal.,2023). Thismightbe
Shinnetal.,2023). Whilesymbolicprocessorshavebeen anissueifLLMsaredeployedforrelatedtasks.
historicallyusedforhandlingplandesign(Fikes&Nilsson,
ThisworkexploresthereasoningabilityofLLMsinnatu-
1971;McDermott,2000),LLMshaverecentlyemergedasa
ralisticasynchronousplanning,whichwedefineascomplex
relevantcomplementaryapproach(Ahnetal.,2022;Dagan
planningtasksinvolvingbothsequentialandparallelactions.
1UniversityofOxford2AlanTuringInstitute3AllenInstitute Givenasetofstepsforatask,thetimerequiredforeach
forAI4LMUMunich5UniversityofLeeds.
|     |     |     |     | Correspondenceto: |     | step,andsteporderingconstraints,weaskwhetherLLMs |     |     |     |     |     |
| --- | --- | --- | --- | ----------------- | --- | ------------------------------------------------ | --- | --- | --- | --- | --- |
FangruLin<fangru.lin@ling-phil.ox.ac.uk>. cancomputetheshortestpossibletimeneededforanopti-
|             |        | 41st          |     |            |            | malplanforthetask(Figure1). |          |         |          | Wenotethatasynchronous |            |
| ----------- | ------ | ------------- | --- | ---------- | ---------- | --------------------------- | -------- | ------- | -------- | ---------------------- | ---------- |
| Proceedings | of the | International |     | Conference | on Machine |                             |          |         |          |                        |            |
|             |        |               |     |            |            | planning                    | problems | involve | (i) time | summation              | (correctly |
Learning,Vienna,Austria.PMLR235,2024.Copyright2024by
addingtimedurations),(ii)timecomparison(correctlymak-
theauthor(s).
1

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Figure2.ComparingstandardInput-Output(IO)promptingwithourmethod(PLaG).Here,weillustratePLaG(explicitgraph)withan
adjacencylist,butitcanbeofanygraphtypeinpractice.ThestandardIOmethodissimilarlydeployedinzero-shot,zero-shot+CoT,
k-shot,k-shot+CoTinthispaper.PleaserefertoAppendixA.8formoredetails.
thatwhileGPT-4withfew-shottasksolutionillustrations
|     |     |     |     |     |     |     | dominates | other  | models  | in terms      | of  | accuracy, | all    | models |
| --- | --- | --- | --- | --- | --- | --- | --------- | ------ | ------- | ------------- | --- | --------- | ------ | ------ |
|     |     |     |     |     |     |     | perform   | poorly | without | illustrations |     | about     | how to | solve  |
thetask. However,evenwithfew-shotillustrations,model
|     |     |     |     |     |     |     | performance | is       | unsatisfactory, |             | with | the LLMs  | failing | on   |
| --- | --- | --- | --- | --- | --- | --- | ----------- | -------- | --------------- | ----------- | ---- | --------- | ------- | ---- |
|     |     |     |     |     |     |     | instances   | that are | trivial         | for humans. |      | To remedy | this,   | we   |
|     |     |     |     |     |     |     | propose     | a novel  | prompting       | technique,  |      | namely    | Plan    | Like |
aGraph(PLaG;Figure2),toinstructmodelstorepresent
|     |     |     |     |     |     |     | a planning | problem | like | a graph. | By  | converting |     | natural- |
| --- | --- | --- | --- | --- | --- | --- | ---------- | ------- | ---- | -------- | --- | ---------- | --- | -------- |
isticquestionstoequivalentgraphproblems,wefindthat
|     |     |     |     |     |     |     | our method | boosts | the | performance |     | of all | tested | models. |
| --- | --- | --- | --- | --- | --- | --- | ---------- | ------ | --- | ----------- | --- | ------ | ------ | ------- |
Moreover,itcanbeappliedofftheshelftomodelssuchas
GPT-4toachievenewstate-of-the-art(SOTA)resultsand
consistentlyimproveonalltaskcomplexitylevels(Figure3,
| Figure3.GPT-3.5 |     | and GPT-4 | accuracy |     | as a function | of asyn- |     |     |     |     |     |     |     |     |
| --------------- | --- | --------- | -------- | --- | ------------- | -------- | --- | --- | --- | --- | --- | --- | --- | --- |
lower). Nonetheless,wefindthattheimprovedmodelsstill
| chronous | planning | task complexity |     | |V|+|E| |     | (see Section 2), |             |         |             |     |             |     |            |     |
| -------- | -------- | --------------- | --- | ------- | --- | ---------------- | ----------- | ------- | ----------- | --- | ----------- | --- | ---------- | --- |
|          |          |                 |     |         |     |                  | suffer from | drastic | performance |     | degradation |     | on complex |     |
afterbinningresultsbywidthof2.Theupperfigureplotstheper-
planningtasks.
formanceofmethodswithoutPLaG(ourmethod),andthelower
plotdisplaysthebestmethodwith/withoutPLaG.
Insummary,themaincontributionsofthispaperare:
|     |     |     |     |     |     |     | • We | automatically |     | generate | a   | high-quality |     | natural- |
| --- | --- | --- | --- | --- | --- | --- | ---- | ------------- | --- | -------- | --- | ------------ | --- | -------- |
ingtimedurationcomparisons),and(iii)constrainedreason-
|     |     |     |     |     |     |     | istic | benchmark | for | asynchronous |     | plan | reasoning, |     |
| --- | --- | --- | --- | --- | --- | --- | ----- | --------- | --- | ------------ | --- | ---- | ---------- | --- |
ing(correctlysolvingconstrainedoptimizationproblems)
AsyncHow,andopen-sourceit.
—thiscompositionalityofskillsmakesasynchronousplan-
ningachallengingtask,anditisyetunclearwhetherLLMs
• WeshowthatLLMscannotefficientlyexecuteasyn-
| are capable | of  | solving | it. To | enable | a large-scale | evalu- |     |     |     |     |     |     |     |     |
| ----------- | --- | ------- | ------ | ------ | ------------- | ------ | --- | --- | --- | --- | --- | --- | --- | --- |
chronousplansunlesstheyaresuppliedwithdetailed
| ation of | LLMs, | we automatically |     | generate |     | a new bench- |     |     |     |     |     |     |     |     |
| -------- | ----- | ---------------- | --- | -------- | --- | ------------ | --- | --- | --- | --- | --- | --- | --- | --- |
solutionillustrations.
| mark, Asynchronous |     | WikiHow |     | (AsyncHow), |     | with 1.6K |     |     |     |     |     |     |     |     |
| ------------------ | --- | ------- | --- | ----------- | --- | --------- | --- | --- | --- | --- | --- | --- | --- | --- |
high-qualityinstancesforreal-lifetasks. • We provide a formalism to define the complexity of
We use AsyncHow to evaluate GPT-3.5-turbo (GPT-3.5), naturalisticasynchronousplanningtasks,whichsuc-
cessfullypredictsLLMs’performancetrends.
| GPT-4    | (OpenAI, | 2023), | Cohere      | Command1, |                     | LLaMA-2- |     |     |     |     |     |     |     |     |
| -------- | -------- | ------ | ----------- | --------- | ------------------- | -------- | --- | --- | --- | --- | --- | --- | --- | --- |
| 70B-chat | (Touvron | et     | al., 2023), | and       | Mistral-7B-Instruct |          |     |     |     |     |     |     |     |     |
• WeproposePLaG,anoff-the-shelfmethodtoconsis-
(v0.2;Jiangetal.,2023)onasynchronousplanning.Wefind
tentlyboostSOTAmodelperformanceacrossallcon-
| 1https://cohere.com/models/command |     |     |     |     |     |     | sideredtaskcomplexities. |     |     |     |     |     |     |     |
| ---------------------------------- | --- | --- | --- | --- | --- | --- | ------------------------ | --- | --- | --- | --- | --- | --- | --- |
2

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
2.1.ComplexityofNaturalisticPlanning
Webrieflyintroducethecomplexitymeasureforourtask
inthissubsection,whichwewilllatershowcorrelateswith
|     |     |     |     |     |     |     | LLMbehavior. | Withinfiniteresources,theformalismofa |     |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ------------ | ------------------------------------- | --- | --- | --- | --- | --- | --- |
DAGcapturesthecomplexityoffindingtheoptimalexecu-
|     |     |     |     |     |     |     | tionorderofcompulsoryactionsainaplanP |     |                       |     |     |     | tominimize |     |
| --- | --- | --- | --- | --- | --- | --- | ------------------------------------- | --- | --------------------- | --- | --- | --- | ---------- | --- |
|     |     |     |     |     |     |     | thetimecostTC(P).                     |     | ADAGG(P)representingP |     |     |     |            |     |
canbe
Figure4.Theseries-parallelDAGusedtosolvetheplanningtask defined as G(P) = ⟨V,E,w⟩, where V is a set of nodes
v, eachrepresentinganactionaintheplanningproblem,
| in Figure | 1. The | path for | calculating | optimal | time | duration is |     |     |     |     |     |     |     |     |
| --------- | ------ | -------- | ----------- | ------- | ---- | ----------- | --- | --- | --- | --- | --- | --- | --- | --- |
highlightedinred. including auxiliary START (v src ) and END (v dst ). E is a
directedsetofflowrelationserepresentingorderingcon-
|     |     |     |     |     |     |     | straints, | whilew | isafunctionthatassignsaweighttoall |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | --------- | ------ | ---------------------------------- | --- | --- | --- | --- | --- |
R+.
|                                                |      |              |     |             |        |      | edgesinthegraphw                   |     | :   | E → | Eachflowrelatione |                |     |     |
| ---------------------------------------------- | ---- | ------------ | --- | ----------- | ------ | ---- | ---------------------------------- | --- | --- | --- | ----------------- | -------------- | --- | --- |
| • We                                           | show | that despite | the | performance | boost, | SOTA |                                    |     |     |     |                   |                |     | i,j |
|                                                |      |              |     |             |        |      | isassociatedwithapositivenumberw(e |     |     |     |                   | )toexpressthat |     |     |
| LLMssufferfromdrasticdegradationwithincreasing |      |              |     |             |        |      |                                    |     |     |     |                   | i,j            |     |     |
taskcomplexity,whichindicatesthattherearelimits node/actionv i isconnectedtonode/actionv j andrequires
|                              |     |     |     |     |     |     | w(e ) | time to be | completed. |     | The | edges | also represent |     |
| ---------------------------- | --- | --- | --- | --- | --- | --- | ----- | ---------- | ---------- | --- | --- | ----- | -------------- | --- |
| tousingLLMsasdigitaldevices. |     |     |     |     |     |     | i,j   |            |            |     |     |       |                |     |
causallinksinthatthepreconditionforanaction/nodeais
metifandonlyifallactions/nodeslinkedtoandpreceding
|                                |     |     |     |                       |     |     | aareperformed. |     | Forsimplicity,wedenoteG(P)asGin |     |     |     |     |     |
| ------------------------------ | --- | --- | --- | --------------------- | --- | --- | -------------- | --- | ------------------------------- | --- | --- | --- | --- | --- |
| Thepaperisstructuredasfollows. |     |     |     | Section2introducesour |     |     |                |     |                                 |     |     |     |     |     |
asynchronousplanningtask,andformallydefinesitscom- theremainingpartofthepaper.
plexityasanoptimizationproblemaswellasourtechnique.
Inthissetting,findingthetimecostforanoptimalplanP∗
| Section3describeshowwegeneratethebenchmark. |     |     |     |     |     | Sec- |     |     |     |     |     |     |     |     |
| ------------------------------------------- | --- | --- | --- | --- | --- | ---- | --- | --- | --- | --- | --- | --- | --- | --- |
inaplanningproblemisequivalenttofindingthelongest
tion4laysouttheexperimentalsettingandoverallresults.
pathG∗onGandcanbecastasthefollowingoptimization
| The results | are | then analyzed | in  | more detail | in  | Section 5. |         |               |     |      |            |     |      |        |
| ----------- | --- | ------------- | --- | ----------- | --- | ---------- | ------- | ------------- | --- | ---- | ---------- | --- | ---- | ------ |
|             |     |               |     |             |     |            | problem | on a subgraph |     | G′ = | ⟨V′,E′,w⟩, |     | G′ ⊆ | G. Ex- |
Wereviewrelevantrelatedworksandconcludethearticle
|     |     |     |     |     |     |     | haustively | searching | a   | graph and | comparing |     | every | path’s |
| --- | --- | --- | --- | --- | --- | --- | ---------- | --------- | --- | --------- | --------- | --- | ----- | ------ |
withourmaincontributionsinSections6to7.
|     |     |     |     |     |     |     | lengthcandeterministicallyfindthegoldanswer. |                   |     |        |       |     | Onseries-  |     |
| --- | --- | --- | --- | --- | --- | --- | -------------------------------------------- | ----------------- | --- | ------ | ----- | --- | ---------- | --- |
|     |     |     |     |     |     |     | parallel                                     | graphs (Eppstein, |     | 1992), | which | are | sufficient | to  |
2.Preliminaries: NaturalisticAsynchronous describeplanningtaskswithinfiniteresources,theaverage
| Planning |     |     |     |     |     |     | timecomplexityisO(|V|+|E|)(Takamizawaetal.,1982), |             |         |     |     |        |          |     |
| -------- | --- | --- | --- | --- | --- | --- | ------------------------------------------------- | ----------- | ------- | --- | --- | ------ | -------- | --- |
|          |     |     |     |     |     |     | i.e., it is                                       | linear with | respect | to  | the | number | of nodes | and |
Wedefineourtaskasfollows: assuminginfiniteresources edgesinG.2 Wedefineourtaskcomplexityaccordingly.
(e.g.,asmanyagentsandtoolsasneededtoachieveoptimal
parallelismareavailable)foranaturalistictaskwithasetof
|     |     |     |     |     |     |     | 2.2.Method: | PlanLikeaGraph |     |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ----------- | -------------- | --- | --- | --- | --- | --- | --- |
compulsorysteps,thetimeneededforeachstep,andstep
orderingconstraints,weassesswhetherLLMscancompute Inourwork,weproposeanovelpromptingtechniquePlan
|                                 |     |     |     |                    |     |     | LikeaGraph(PLaG,Figure2). |     |     |     | Takinginspirationfrom |     |     |     |
| ------------------------------- | --- | --- | --- | ------------------ | --- | --- | ------------------------- | --- | --- | --- | --------------------- | --- | --- | --- |
| theoptimaltimeneededforthetask. |     |     |     | Formally,wecancast |     |     |                           |     |     |     |                       |     |     |     |
thisastheproblemtofindthelongestpathonaDirected Discourse Representation Theory (Wolf et al., 2004) and
AcyclicGraph(DAG,Figure4). Akeyadvantageofdoing relevantworksongraphicalpromptrepresentations(Fatemi
|            |        |        |          |                |     |        | et al., 2023; | Wang | et al., | 2023), | PLaG | includes | a   | graph |
| ---------- | ------ | ------ | -------- | -------------- | --- | ------ | ------------- | ---- | ------- | ------ | ---- | -------- | --- | ----- |
| so is that | we can | easily | estimate | the complexity |     | of our |               |      |         |        |      |          |     |       |
taskdespitethefactthatitisanaturallanguageprocessing representationintheprompt,wherewegivemodelsk-shot
|          |      |               |     |      |           |       | illustrations | with | graphs | describing |     | the task | and instruct |     |
| -------- | ---- | ------------- | --- | ---- | --------- | ----- | ------------- | ---- | ------ | ---------- | --- | -------- | ------------ | --- |
| problem. | This | distinguishes | our | work | from many | other |               |      |        |            |     |          |              |     |
studies. Weempiricallyprovethatourcomplexitymeasure themtoeitherreasonbasedonagivengraph(i.e.,explicit
predictsLLMbehaviorinallpromptsettings(Figure3and graph)ortogenerateagraphthemselvesandthenreason
|     |     |     |     |     |     |     | aboutit(i.e.,BuildaGraph/BaG; |     |     |     | Wangetal.,2023). |     |     | We  |
| --- | --- | --- | --- | --- | --- | --- | ----------------------------- | --- | --- | --- | ---------------- | --- | --- | --- |
Section5.1),withvarianceexplainedinSection5.4.
instructmodelstoproducegraphrepresentationsofthenat-
SinceourtaskisessentiallysimilartoDAGsearch,itsheds
|          |            |         |     |                 |     |           | uralistic | question | and | then use | the | information | to  | solve |
| -------- | ---------- | ------- | --- | --------------- | --- | --------- | --------- | -------- | --- | -------- | --- | ----------- | --- | ----- |
| light on | the limits | of LLMs | as  | digital devices |     | (La Malfa |           |          |     |          |     |             |     |       |
relevanttasks.
| et al., 2024) | and, | specifically, |     | as solvers | of discrete | opti- |     |     |     |     |     |     |     |     |
| ------------- | ---- | ------------- | --- | ---------- | ----------- | ----- | --- | --- | --- | --- | --- | --- | --- | --- |
mizationproblemsongraphs(Wangetal.,2023). Italso 2Whileweassumeinfiniteresourcestocompleteaplanning
task,thenaturalextensiontothecaseoffiniteresources(i.e.,not
servesas(i)anexampleofanoptimalsuccinctroutinethat
allindependentactionscanbeparallelized)isbettercapturedby
anLLMmightbeabletoimplementinternally(Weissetal.,
theformalismofaPetrinet(ordiscrete-timeMarkovchainswith
2021) to solve a planning problem and (ii) a baseline to constraints).WeintroducethecurrentformalismandPetrinetin
measurethelossinducedbyspecifyingaprobleminnatural moredetailinAppendixA.1.
language,namelyanLLM’slanguagedivide.
3

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Figure5.OverviewoftheAsyncHowbenchmark.Thethreebarchartsontheleftdisplaytheinstancenumbersfortheshortest/longest
sequentialpathlengthand|V|+|E|indifferentplans. Thepiechartontherightshowsthetopicdistributioninourdataset. See
AppendixA.3fordetailsaboutthetopicassignment.
3.TheAsyncHowBenchmarkforPlanning
2023). Furthermore,ourinterestisinassessingwhetheran
LLMoutputstheoptimalplanforatask,andweexpectend
Sincethereisnoexistingdatasetappropriateforourdefined
|     |     |     |     |     |     | users to supply |     | different | time durations | when | querying | a   |
| --- | --- | --- | --- | --- | --- | --------------- | --- | --------- | -------------- | ---- | -------- | --- |
task,wegenerateanewnaturalisticasynchronousplanning
model.
| benchmark | called Asynchronous |     | WikiHow | (AsyncHow). |     |     |     |     |     |     |     |     |
| --------- | ------------------- | --- | ------- | ----------- | --- | --- | --- | --- | --- | --- | --- | --- |
Thissectiondescribesandvalidatesanautomaticmethod Wenowbrieflydescribethedatagenerationprocess,with
forgeneratingthisbenchmark. WithLLMsthatconsume moredetailsinAppendixA.2.
newbenchmarksatanunprecedentedpace,ourcontribution First,wepreprocessthedatasettocollecthigh-qualityplans
goesbeyondAsyncHowandcanbeusedbypractitionersto
|     |     |     |     |     |     | rated by | WikiHow | users. | Then, given | our | task definition |     |
| --- | --- | --- | --- | --- | --- | -------- | ------- | ------ | ----------- | --- | --------------- | --- |
synthesizenewdatasets.
(e.g.,allstepsneedtobeexecuted,etc.),wefilteroutplans
InadditiontotheexistingdatainProScript(Sakaguchietal., withoptionalstepsandothersthatdonotfitintoourresearch
2021), an end-to-end human-annotated partial-order plan goalbybothmatchingkeywordsandpromptingGPT-3.5
dataset3,weuseWikiHow(Koupaee&Wang,2018;Zhang toanswerrelevantquestions(e.g.,Are all steps needed
etal.,2020)tocollecttheplanningtasksweneed. Inline in this plan?). Then,weuseGPT-3.5toestimatethe
timedurationperstepandexcludeinstanceswhosestep
withrecentworks,weuseLLMsasdataannotators(Gilardi
etal.,2023;Huangetal.,2023). Specifically,weusethe durationscannotbequantifiednumerically.
| GPT models | for part of | pre-processing, |     | time | annotation, |     |     |     |     |     |     |     |
| ---------- | ----------- | --------------- | --- | ---- | ----------- | --- | --- | --- | --- | --- | --- | --- |
Next,weuseGPT-4toannotatestepdependencieswith
andstepdependencyannotation,astheyexhibitimpressive
|     |     |     |     |     |     | thedotlanguage. |     | Afterremovingredundantdependencies |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --------------- | --- | ---------------------------------- | --- | --- | --- | --- |
annotationcapabilities(Heetal.,2023).However,wewould
|                   |              |       |                       |          |         | (e.g.,inananswersaying‘step |      |         | 1           | → step           | 2’, ‘step |       |
| ----------------- | ------------ | ----- | --------------------- | -------- | ------- | --------------------------- | ---- | ------- | ----------- | ---------------- | --------- | ----- |
| like tostressthat | (i)anyLLM(or |       | equivalentalgorithmic |          |         |                             |      |         |             |                  |           |       |
|                   |              |       |                       |          |         | 2 → step                    | 3’,  | ‘step   | 1 → step    | 3’,weremove‘step |           |       |
| procedure)        | can be used  | as an | annotator             | and (ii) | the LLM |                             |      |         |             |                  |           |       |
|                   |              |       |                       |          |         | 1 → step                    | 3’), | we keep | data points | that             | have at   | least |
usedtoannotateisnotinvolvedinthegroundtruthanswer
fourconsistentanswersthatformasynchronousplansand
generation,whereweusedeterministicproceduressuchas
discardtheothers.
thelongestpathonaDAG.ThismeansthattheGPTmodels
usedforannotationshouldnotbeconsideredoraclesinthe After the above steps, we combine all asynchronous in-
benchmarkingexperiments. stances with complete time annotation for all meaning-
fulstepsinProScriptwithourgeneratedasynchronousin-
| This process | culminates | in AsyncHow, |     | a curated | list of |     |     |     |     |     |     |     |
| ------------ | ---------- | ------------ | --- | --------- | ------- | --- | --- | --- | --- | --- | --- | --- |
stancesfromWikiHow,afterwhichweobtainacollection
| 1.6K data   | points for asynchronous |     | planning. |           | We provide |                    |       |        |                  |         |               |     |
| ----------- | ----------------------- | --- | --------- | --------- | ---------- | ------------------ | ----- | ------ | ---------------- | ------- | ------------- | --- |
|             |                         |     |           |           |            | of 1.6K instances. |       | We     | then generate    | natural | language      |     |
| an overview | of the benchmark        |     | structure | in Figure | 5. We      |                    |       |        |                  |         |               |     |
|             |                         |     |           |           |            | prompts            | based | on the | task information | in      | dot language, |     |
evaluatethedependencyannotationqualityautomatically
asuserstendtousenaturallanguagedescriptionstospec-
andthegeneralgenerationqualitywithhumanannotators
|               |                                       |     |     |     |     | ify such | a task. | We have | 10 trivially | different | plausible |     |
| ------------- | ------------------------------------- | --- | --- | --- | --- | -------- | ------- | ------- | ------------ | --------- | --------- | --- |
| (Section3.1). | Wedonotverifythetimeannotationbecause |     |     |     |     |          |         |         |              |           |           |     |
templateswiththeirsuccinctusecasesinourdataset(e.g.
thetasktimeestimationinalessgroundedsettingsuchas
|     |     |     |     |     |     | ‘step 1 | -> step | 2,  | step 1 -> | step | 3’ may | be ex- |
| --- | --- | --- | --- | --- | --- | ------- | ------- | --- | --------- | ---- | ------ | ------ |
ourstendsnottohaveauniquegoldanswer(e.g.,‘finding
|     |     |     |     |     |     | pressed as | ‘Step | 1 must | precede | step | 2, step | 1   |
| --- | --- | --- | --- | --- | --- | ---------- | ----- | ------ | ------- | ---- | ------- | --- |
a gym’maytakefiveminutesoraweektodifferentpeople),
|             |            |        |     |                  |     | must precede |      | step 3’,andsuccinctlyas‘Step |                                 |     | 1   | must |
| ----------- | ---------- | ------ | --- | ---------------- | --- | ------------ | ---- | ---------------------------- | ------------------------------- | --- | --- | ---- |
| and GPT-3.5 | (the model | we use | for | time annotation) | is  |              |      |                              |                                 |     |     |      |
|             |            |        |     |                  |     | precede      | step | 2 and                        | 3’)toallowforrelevantparaphrase |     |     |      |
reportedtobeareliableannotatorforthistask(Jainetal.,
robustnessstudies(Elazaretal.,2021).
3ProScriptissimilartoourdataset,butitisnotsuitableenough
Last,wegenerateequivalentDAGsrepresentingthework-
forourtask.SeeSection6fordiscussions.
4

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Table1.ComparisonofourstepdependencyannotationfortheProScriptdevandtestset,withmeanandstandarddeviationperformance
onthreerandomizedexperiments(100instancesperexperiment).
|     |     |        |       | dev(in-domain) |       |       |       |       | test(cross-domain) |       |       |       |     |     |
| --- | --- | ------ | ----- | -------------- | ----- | ----- | ----- | ----- | ------------------ | ----- | ----- | ----- | --- | --- |
|     |     |        | F1    |                | P     |       | R     | F1    |                    | P     |       | R     |     |     |
|     |     | Humans | 89.32 |                | 89.60 | 89.21 |       | 89.28 |                    | 89.91 |       | 88.86 |     |     |
|     |     | GPT-4  | 89.80 |                | 90.65 | 89.30 |       | 85.59 |                    | 85.95 | 85.77 |       |     |     |
|     |     |        |       | ±1.70          | ±1.36 |       | ±2.09 | ±2.92 |                    | ±2.43 |       | ±3.56 |     |     |
flowandcomputetheoptimaltimedurationforaplanby shot(Brownetal.,2020)andChainofThoughtprompting
calculatingthetimedurationforthelongestone. Eachplan- (CoT;Weietal.,2022)? Second,canwedevelopabetter
ningtaskiseventuallyaccompaniedbyfourtypesofgraph method to prompt models to improve their performance?
representations: theadjacencyandtheedgelist, theadja- Third,howdoscaleeffectsmanifestwhenvaryingproblem
cencymatrix,andthecompressedsparserow(csr),which complexityandmodelsize? Last,isanLLM’sperformance
canbeusedtoaidLLMsinstructuralreasoningandassess robusttotriviallydifferentlinguisticorgraphicalprompts?
LLMs’robustnessagainstdifferentgraphrepresentations. Wedesigntheexperimentsaccordingly.
| We do not | further | vary | natural | language | representations |     |     |     |     |     |     |     |     |     |
| --------- | ------- | ---- | ------- | -------- | --------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
forgraphsbecauserelevantinvestigationscanbefoundin 4.1.ExperimentalSettingandDesign
Fatemietal.(2023).
WeconductexperimentswithGPT-3.5,GPT-4,andCom-
|     |     |     |     |     |     |     | mand, | three | closed-source |     | LLMs, | as well | as  | LLaMA-2- |
| --- | --- | --- | --- | --- | --- | --- | ----- | ----- | ------------- | --- | ----- | ------- | --- | -------- |
3.1.QualityCheck
70B-chatandMistral-7B-Instruct(v0.2),twoopen-source
Ontopoftheintermediatequalitycheckstagesintheabove LLMs.5 We first experiment with different language de-
process (e.g., filtering out inconsistent answers and low- scriptions of our problem in a zero-shot setting with 100
scoredscripts,etc.),wefinallyperformtwootherroundsof sampledprompts(seedetailsinAppendixA.7)andusethe
qualitycheckstofurtherensurehighdataquality. best-performingoneforthesuccessiveexperiments.
First,weassessstepdependencyannotationquantitatively: Wethenbenchmarkourmodelsinfullscaleinfourprompt-
inthreerandomizedexperiments,wesample100instances ingregimes:(i)zero-shot:onlypromptingmodelswithtask
fromtheProScriptdevandtestsets. FollowingSakaguchi descriptionswithoutadditionalinformationortraining;(ii)
et al. (2021), we compare the pair-wise precision, recall, k-shot(Brownetal.,2020): promptingwithk in-context
andF1scoreofourgenerateddependencyannotationswith instanceswithdesiredoutputsprecedingthetaskdescrip-
humanperformance,whichisobtainedviaaskingcrowd- tion; (iii) zero-shot with CoT (zero-shot+CoT; Kojima
workerstoannotatepartially-orderedscriptsforrandomly etal.,2022): promptingthemodelwiththetaskdescription
shuffled steps.4 Our annotation method has near human- alongwiththeinstruction‘Let’s think step by step’,
levelperformance,asreportedinTable1. and(iv)k-shotwithCoT(k-shot+CoT;Weietal.,2022):
promptingthemodelwithkin-contextinstanceswithCoT
Inaddition,werandomlysample80instanceswithamix-
|             |     |                 |     |      |                   |     | illustrations |     | for the | problem-solving |     | process |     | and desired |
| ----------- | --- | --------------- | --- | ---- | ----------------- | --- | ------------- | --- | ------- | --------------- | --- | ------- | --- | ----------- |
| ture of LLM | and | human-annotated |     | data | and qualitatively |     |               |     |         |                 |     |         |     |             |
outputsprecedingthetaskdescriptionwithCoT.6
surveyexpertswithoutinformingthemwhichdatapointsare
human-annotated. We follow the ‘prescriptive’ approach Then, we experiment by sampling 100 instances for the
in Ro¨ttger et al. (2021) by instructing them to consider adjacency list, edge list, adjacency matrix, and csr in the
| theacceptabilityof |     | thetasktimeestimationsandstep   |     |     |     | or- |               |       |             |     |             |     |       |             |
| ------------------ | --- | ------------------------------- | --- | --- | --- | --- | ------------- | ----- | ----------- | --- | ----------- | --- | ----- | ----------- |
|                    |     |                                 |     |     |     |     |               | 5In a | preliminary |     | experiment, |     | we    | also tested |
| deringconstraints. |     | Human-annotatedandLLM-generated |     |     |     |     |               |       |             |     |             |     |       |             |
|                    |     |                                 |     |     |     |     | CodeLlama-34B |       | (Roziere    | et  | al., 2023)  | and | Phi-2 | (Gunasekar  |
instancesreceivesimilarlevelsofacceptability.
|     |     |     |     |     |     |     | et  | al., 2023) | , but we | exclude | them | from the | evaluation | due to |
| --- | --- | --- | --- | --- | --- | --- | --- | ---------- | -------- | ------- | ---- | -------- | ---------- | ------ |
poorperformance.Ourobservationthatthecodemodelsperform
poorlyisinlinewithLaMalfaetal.(2024)andLiuetal.(2024),
4.BenchmarkingExperiment
showingthatsimulationismoredifficultthangeneration.
|            |            |              |     |                    |     |            |     | 6Weusek         | = 3. | Wedonotconductfull-scalebenchmarking |      |                     |     |       |
| ---------- | ---------- | ------------ | --- | ------------------ | --- | ---------- | --- | --------------- | ---- | ------------------------------------ | ---- | ------------------- | --- | ----- |
| We are     | interested | in answering |     | the following      |     | questions. |     |                 |      |                                      |      |                     |     |       |
|            |            |              |     |                    |     |            | on  | other prompting |      | techniques                           | such | as Chain-of-Thought |     | Self- |
| First, can | a model    | efficiently  |     | solve asynchronous |     | plan-      |     |                 |      |                                      |      |                     |     |       |
Consistency(CoT-SC;Wangetal.,2022)andTreeofThought
ning tasks with existing prompting techniques such as k- (ToT;Yaoetal.,2024)astheyprimarilyusestandardIOprompts
likeCoT,andourmethodcanbedeployedinadditiontothese
4Precision,
recall, and F1 score are defined as follows: promptingtechniques. Weshowthatourmethodissuperiorto
|     |     | ˆ|,Recall |     | ˆ|,F |     |     |     |     |     |     |     |     |     |     |
| --- | --- | --------- | --- | ---- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
Precision = |E ∩E = |E ∩ E = 2 ∗ P r e c i si o n∗ R e c a ll,with usingCoT-SCandToTaloneforamorecomprehensivecompar-
|     | |E  | |   | |E ˆ | | 1   | P r e c is i o n + R | ec a l l |     |     |     |     |     |     |     |     |
| --- | --- | --- | ------ | --- | -------------------- | -------- | --- | --- | --- | --- | --- | --- | --- | --- |
beingthegoldedgesandEˆ ison in Appendix A.10. See also the latency analysis for cost-
| E   |     |     | denotingthepredictionsineach |     |     |     |     |     |     |     |     |     |     |     |
| --- | --- | --- | ---------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
performancetrade-offsinAppendixA.11.
discoursegraph,respectively.
5

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Table2.Model accuracy in different settings on the AsyncHow benchmark. Model performances without our method are in plain
background,whilethosewithourmethodareinbluebackground.Wemarkthebestperformancepermodelinbold.FollowingDroretal.
(2018),weuseMcNemar’stests(McNemar,1947)toobtainp-valuesandHolm-Bonferronimethod(Holm,1979)tocorrectthemfor
eachevaluationtotestthestatisticalsignificanceofperformancedifferencebetweenexperimentwithandwithoutourproposedmethod.
Wedenotewith†whentheperformanceswithPLaGaresignificantlybetter(p<0.05)thanthebestresultwithout.
|     |     |     |     | WithoutPLaG |     |     |     |     | WithPLaG |     |     |
| --- | --- | --- | --- | ----------- | --- | --- | --- | --- | -------- | --- | --- |
Model zero-shot zero-shot+CoT k-shot k-shot+CoT PLaG(explicitgraph) PLaG(BaG)
|                               |     |     |                     |       |       |       |     | 0.730† |     | 0.777† |     |
| ----------------------------- | --- | --- | ------------------- | ----- | ----- | ----- | --- | ------ | --- | ------ | --- |
| GPT-4                         |     |     | 0.130               | 0.129 | 0.107 | 0.657 |     |        |     |        |     |
| GPT-3.5                       |     |     | 0.199               | 0.224 | 0.248 | 0.226 |     | 0.290† |     | 0.355† |     |
| Command                       |     |     | 0.078               | 0.015 | 0.050 | 0.078 |     | 0.100  |     | 0.050  |     |
| LLaMA-2-70B-chat              |     |     | 0.039               | 0.038 | 0.053 | 0.076 |     | 0.101† |     | 0.069  |     |
| Mistral-7B-Instruct           |     |     | 0.078               | 0.070 | 0.098 | 0.149 |     | 0.161  |     | 0.146  |     |
| settingofPLaG(explicitgraph). |     |     | Weusethebesttypefor |       |       |       |     |        |     |        |     |
full-scalePLaGexperiments(explicitgraph/BaG).Prompt
examplesaregiveninAppendixA.8.
4.2.ExperimentResults
Weevaluateeachmodel’sperformancebytheaccuracyof
| correctly | reporting | the | shortest time | needed for different |     |     |     |     |     |     |     |
| --------- | --------- | --- | ------------- | -------------------- | --- | --- | --- | --- | --- | --- | --- |
plans. MainresultsareinTable2.7
ThestrongestperformanceisobtainedbyGPT-4withPLaG
| (BaG). | This is | surprising | given that | GPT-3.5 does | better |     |     |     |     |     |     |
| ------ | ------- | ---------- | ---------- | ------------ | ------ | --- | --- | --- | --- | --- | --- |
thanGPT-4(thoughnotverywell)onthezero-shot,zero-
shot+CoT,andk-shotsettings,whichlackexplicitillustra-
tions. Asolidperformancegapdividesopen-sourcemodels
Figure6.Theupperplotreferstoaveragemodelaccuracywith
fromGPTmodels,althoughMistral-7B-Instructperforms
100instancesofPLaG(explicitgraph)indifferentgraphs.Colored
betterdespitebeingmuchsmallerthanLLaMA-2-70B-chat.
barsrefertomodelperformancewithdifferentgraphtypes.Black
dashedlinesrefertoaverageaccuracywithdifferentgraphtypes.
PLaG(ourmethod)successfullybooststheperformanceof
|            |                                              |     |     |     | The | lower | plot refers to | the average | zero-shot | accuracy | in 100 |
| ---------- | -------------------------------------------- | --- | --- | --- | --- | ----- | -------------- | ----------- | --------- | -------- | ------ |
| allmodels. | Thisisparticularlyinterestingconsideringthat |     |     |     |     |       |                |             |           |          |        |
instancesofdifferenttextprompts(withouteconomicusage).Error
whilenaturallanguagepromptsinthevanillasettingessen-
barsinbothplotsrefertoworst/bestperformancepermodel.
tiallyrepresentthesameinformationasthegraphs,explic-
itlyprovidingprototypicalgraph-structureddataenhances
LLMperformanceandhighlightsitsinherentlimitationof
| reasoningataconceptuallevel. |     |     | Furthermore,manyother |     |     |     |     |     |     |     |     |
| ---------------------------- | --- | --- | --------------------- | --- | --- | --- | --- | --- | --- | --- | --- |
real-worldtasksinnaturallanguagesuchasdialoguestate
tracking(Linetal.,2021)canbeabstractedasgraphs. Thus, LLMsbyaddinggraphinformationandindicatesthepoten-
| our finding | is  | relevant | for future research | on enhancing |     |     |     |     |     |     |     |
| ----------- | --- | -------- | ------------------- | ------------ | --- | --- | --- | --- | --- | --- | --- |
tialofboostingcapablemodels’performanceinplanning
| conceptualrepresentationsinLLMs. |     |     |     |     | withoutexternalprocessors. |     |     |     |     |     |     |
| -------------------------------- | --- | --- | --- | --- | -------------------------- | --- | --- | --- | --- | --- | --- |
Surprisingly,PLaGwithBaG,whichdoesnotrequireexter-
|     |     |     |     |     | Next, | we  | report our | experiment | results | on different | text |
| --- | --- | --- | --- | --- | ----- | --- | ---------- | ---------- | ------- | ------------ | ---- |
nalprocessingtosupplynewgraphsexplicitlyineverytask promptsandgraphtypes. AsshowninFigure6,different
description,improvestheperformanceofthemostcapable
|     |     |     |     |     | text | prompts | and graph | types | induce variations | in  | model |
| --- | --- | --- | --- | --- | ---- | ------- | --------- | ----- | ----------------- | --- | ----- |
models(GPT-3.5andGPT-4)acrossallcomplexitylevels performance, and models have different preferences for
off the shelf.8 These results suggest that PLaG benefits thesevariables. Ingeneral,usingmoresuccinctandmore
naturalexpressions(seeAppendixA.2.4fordetails)tends
7Ifaclosed-sourcemodeldoesnotreturnanythingduetocon-
todowngrademodelperformance(resultsarereportedin
tentfiltering,weconsidertheanswertobefalse.InAppendixA.9,
weprovideanalyseswhereweexcludesuchinvalidinstances. AppendixA.13),ahintthatmodelscannotadapttoslight
8We emphasize that the superior performance of BaG does variationsofthesameprompts.
notresultfromnoiseinsampling(seeAppendixA.12fordiscus-
sion).Wehypothesizethatthesuperiorperformanceoftheexplicit graphinothermodelsresultsfromtheirincapabilityofgenerating
accurategraphrepresentations.
6

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
5.FurtherAnalysisofGPT-3.5/4Results
Thissectioninvestigateswhichfactorsinfluencethemost
potentmodelsinourtask,namelyGPT-3.5andGPT-4. We
firstrelateanLLM’saccuracywithtaskcomplexities,then
provideanablationstudytoidentifythesalientcharacteris-
ticsthatmakeaplanningprobleminherentlycomplex.Next,
weuseasyntheticdatasetthatcoversandgoesbeyondthe
distributionofAsyncHowtoestimatemodelperformancein
thepotentialscenariosthatmightfalloutofthedistribution Figure7.Comparisonofparallel/sequentialplanexecutionaccu-
ofourbenchmark. Last,weperformaqualitativeanalysis racywithasynchronousplans. Allexperimentsaredoneinthe
toprovidefurtherrationalesforsomesurprisingphenomena settingofk-shot+CoT.BlueandredlinesrefertoGPT-4and
observedinourresults. GPT-3.5results,respectively.
5.1.Accuracyvs. Complexity
aretrivialwhilehigheronesaresparseinAsyncHow,which
In Figure 3(Section 1), we plot the accuracy ofGPT-3.5
canpotentiallyleadtosamplingbias. Weexperimentwith
andGPT-4asafunctionofthetaskcomplexity|V|+|E|.9
k-shot+CoTandcomparemodelperformanceacrossstep
Generally,theaccuracynegativelycorrelateswiththecom-
numbersindifferentplantypesinFigure7.
plexityofthetaskforallmodelsandallsettings,withgraphs
ofcomplexity|V|+|E|≥18alreadyresultinginchalleng- WhileGPT-3.5andGPT-4haveasimilaraccuracyinpar-
ingproblemsforthemostcapablemodelandbestsetting. alleltasksrequiringtimecomparison,GPT-4outperforms
Thecomplexitymeasurealsopredictsthemodelaccuracy GPT-3.5onsequentialtasks,i.e.,attimesummation.Ourre-
trends well in settings without graphs. We notice a little sultssuggestaperformancegapbetweenparallel/sequential
jump at complexity |V| + |E| ≥ 20, for which we will andasynchronousplansforbothmodels. Weconcludethat
discusspossiblereasonsinSection5.4. reasoningabouttaskconstraintsaddsspecialdifficultyon
topoftimecomparisonandsummationforLLMs.
Withoutourmethod,GPT-4withk-shot+CoTconsistently
outperforms any other settings by a solid margin, while
5.3.Out-of-distributionProbing
alltheothersettingshavecomparableperformancesinde-
pendentlyfromthenumberofillustrationsprovidedorthe WeestimateLLMs’performanceonout-of-distributiondata
modelemployed(Figure3,upper). pointswhosecomplexitiesfalloutofthedata-richpart(i.e.,
complexity |V|+|E| < 20) of AsyncHow. As our nat-
Ourmethod(PLaG)consistentlyimprovesoverk-shot+CoT,
uralistic planning problem can be cast into longest-path
thebestmethodwithoutPLaG,amongtasksofallcomplex-
graphsearch(refertoformalisminSection2),wegenerate
ities(Figure3,lower)forbothGPT-3.5andGPT-4. Inline
asyntheticdatasetof2,000datapointsevenlydistributed
withwhatwasobservedbefore,theaccuracydropssignifi-
betweencomplexity10to40forprototypicalshortest-path
cantlywithcomplexplanningtasks,onceagainprovingthat
graphsearch(wecancastthelongest-pathsearchtoshortest-
LLMsarenotyetrobustenoughtobedeployedasgenerally
pathsearchbynegatingedgeweights). Byprototypical,we
intelligentagentsinplanning.
refer to formulating prompts for dynamic programming
problemswhereanLLMisqueriedtocomputethelongest
5.2.AblationStudy
pathonagraphwithnumericaledgeweightstosimulate
Solvingourplanningtaskrequiresacertaindegreeofcom- timedurationsforeachnodetheedgestartsfrom. Forcon-
positionalityincombiningtimecomparison,timesumma- sistency,wesamplethegraphsassimilartoAsyncHowdata
tion, and constraint reasoning correctly. We perform an as possible (see details in Appendix, Section A.14). We
ablation study to identify which skills LLMs lack. We promptGPT-3.5andGPT-4inzero-shot+CoTwiththeir
sample200sequentialplanningtasks(i.e.,theoptimaltime respectivebestgraphrepresentationsfoundinSection4.2.
calculationonlyrequiressummation)andfullyparalleltasks Wecompareitsaccuracywiththeaccuracyinzero-shot+
(i.e.,theoptimaltimecalculationonlyrequirescomparison) CoTinthenaturalisticexperiment.
from the non-asynchronous part in our generated dataset.
AsshowninFigure8,graphsearchaccuracyshowsadown-
Wesampleequalnumbersofplansperstepwithaminimum
goingtrendsimilartothein-domainnaturalisticdata,which
of three steps and a maximum of seven, as smaller plans
indicatesthatmodelperformanceinnaturalisticplanning
9WeshowinAppendixA.14that|V|and|E|equallycontribute tasks is likely to follow the pattern of synthetic data and
tothecomplexityofaplanningtask,withnocleardominanceof continuetodropwithcomplexityfurtherincreasing. This
oneovertheother. outcomestrengthensotherfindingsthatLLMscanbeunre-
7

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
|     |     |     |     |     | complexity. | Weimputethisphenomenonto(i)thesparsity |     |     |     |
| --- | --- | --- | --- | --- | ----------- | -------------------------------------- | --- | --- | --- |
ofgraphsforhighercomplexitiesand(ii)animplicitbias
ofourbenchmarktowardseasierdataconversionsformore
|     |     |     |     |     | complexplanningtasks. |     | Seeamorein-depthdiscussionof |     |     |
| --- | --- | --- | --- | --- | --------------------- | --- | ---------------------------- | --- | --- |
thisphenomenoninAppendixA.15.
|     |     |     |     |     | WhyisBaGbetterthanexplicitgraph? |     |     |     | Asymbolicpro- |
| --- | --- | --- | --- | --- | -------------------------------- | --- | --- | --- | ------------- |
cessordeterministicallygeneratescorrectgraphrepresenta-
tions,whileBaGpromptsamodeltogenerateitsinternal
Figure8.GPT-3.5andGPT-4performanceonprototypicallongest
representationoftheproblemwithnopromiseofcomplete
pathsearchproblemandonnaturalAsyncHowtaskwithzero-shot
+CoT.Models’respectivebestgraphtypesfoundinSection4.2 correctness. However, among PLaG methods, BaG per-
areusedinprototypicalprobing. forms slightly better than explicit graphs (i.e., generated
|     |     |     |     |     | algorithmically). | Wesamplesomeinstancesandfindthat |     |     |     |
| --- | --- | --- | --- | --- | ----------------- | -------------------------------- | --- | --- | --- |
BaG-generatedgraphsareofthesameformatasprovidedin
liableroutinesimulators(LaMalfaetal.,2024). thek-shotprompt,andwethusimputetheperformancegap
Interestingly,althoughsolvingessentiallythesametask,the toasub-optimalpositioningofthegraphintheformerset-
|     |     |     |     |     | ting(Liuetal.,2023b;Maoetal.,2023): |     |     | theexplicitgraph |     |
| --- | --- | --- | --- | --- | ----------------------------------- | --- | --- | ---------------- | --- |
performanceofGPT-4ismuchhigherintheprototypical
‘[Task
settingthanthenaturalisticone. Incomparison,GPT-3.5de- prompt setting expresses the prompt in the form
riveslittlebenefitfromtheprototypicalsetting. Weimpute description with graph] Answer:’,withthegraphap-
|                                    |     |     |                    |     | pearinginthemiddleofthecontext, |     |     | whichcanbeeasily |     |
| ---------------------------------- | --- | --- | ------------------ | --- | ------------------------------- | --- | --- | ---------------- | --- |
| thisgaptoseveralconcurrentfactors. |     |     | First,computingthe |     |                                 |     |     |                  |     |
optimalplanwithdurationsexpressedasnumbersiseasier ignored by the model. For BaG, by contrast, the prompt
than naturalistic time conversion (we will discuss this in hastheform‘[Task description] Answer: [Graph]’,
wherethegraphisgeneratedatasuccessivestepandeasier
| thenextsubsection). | Second,naturalisticplanningrequires |     |     |     |     |     |     |     |     |
| ------------------- | ----------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- |
turninglanguageintoaneffectiveprocedure,whichaddsto formodelstotakeintoaccount.
| thedifficultyofprocessingprototypicalgraphs. |                |        |           | Theresults |               |     |     |     |     |
| -------------------------------------------- | -------------- | ------ | --------- | ---------- | ------------- | --- | --- | --- | --- |
| also shed light                              | on the reasons | behind | the boost | of perfor- | 6.RelatedWork |     |     |     |     |
mancecausedbyPLaG:PLaGpointsamodeltoasettingit
|     |     |     |     |     | LLMs for | planning. | Works focusing | on  | automatically |
| --- | --- | --- | --- | --- | -------- | --------- | -------------- | --- | ------------- |
isalreadyfamiliarwithandbettermasters.
generatingplausibleplansfordailytasksshowthatLLMs
canbeusedtodevelopreasonableandorderedactionsor
5.4.QualitativeStudy
|     |     |     |     |     | goals (Madaan | et al., | 2022; Xie | et al., 2023; | Yuan et al., |
| --- | --- | --- | --- | --- | ------------- | ------- | --------- | ------------- | ------------ |
Wequalitativelyoverviewsomefailuresandsuccessesof 2023). The work most similar to ours is Sakaguchi et al.
LLMs,whichshedlightonedgecasesthatareofinterestto (2021):theycollected6.4Korderedplansviacrowdsourcing
understandingtheircapabilitiesandlimitations.
|     |     |     |     |     | forProScript. | However,thedatasetisinsufficienttoserve |     |     |     |
| --- | --- | --- | --- | --- | ------------- | --------------------------------------- | --- | --- | --- |
asabenchmarkforasynchronousplanningasrelevantdata
| Wrong answers | in easy | problems. | Even | for low- |     |     |     |     |     |
| ------------- | ------- | --------- | ---- | -------- | --- | --- | --- | --- | --- |
pointsaresparseandlackdiversity.
| complexity | planning instances, | GPT-4 | may | incur trivial |     |     |     |     |     |
| ---------- | ------------------- | ----- | --- | ------------- | --- | --- | --- | --- | --- |
Anotherlineofworkfocusesonfindingtheoptimalplan
errors. Itemergesthaterrorstendtofallintoafewmacro-
categories: (i)parallelismerror whereLLMscannotef- fordomain-orientedtaskssuchasrobotics. AlthoughLLMs
canbereadilydeployedtoparsenaturallanguageintolog-
| ficientlyparallelizeasmanystepsaspossible: |     |     |     | e.g.,when |     |     |     |     |     |
| ------------------------------------------ | --- | --- | --- | --------- | --- | --- | --- | --- | --- |
icalelements,theyalonecannotdevelopoptimalplansto
| step 3 (10 | min) can be done | together | with | step 1 (5 min) |     |     |     |     |     |
| ---------- | ---------------- | -------- | ---- | -------------- | --- | --- | --- | --- | --- |
accomplishagivengoalwithoutexternalsymbolicproces-
| and 2 (15 | min), the model | only parallelizes |     | 1 and 3 but |     |     |     |     |     |
| --------- | --------------- | ----------------- | --- | ----------- | --- | --- | --- | --- | --- |
sors(Collinsetal.,2022;Valmeekametal.,2022;Lawless
schedulesstep2tofollowthem;(ii)timeunitconversion
errorwhereLLMscannotefficientlyconverttimeunitsto etal.,2023;Linetal.,2023;Liuetal.,2023a;Yangetal.,
2023). Whiletheseworksfocusondomain-orientedtasks
| commonmeasuresforcalculation: |              | e.g.,3weeksand1hour |     |             |                |          |             |          |             |
| ----------------------------- | ------------ | ------------------- | --- | ----------- | -------------- | -------- | ----------- | -------- | ----------- |
|                               |              |                     |     |             | using external | symbolic | processors, | we close | the gap be- |
| is wrongly                    | converted to | be 5,041 hours      | (30 | weeks and 1 |                |          |             |          |             |
tweenstructuredandnaturalistictasksandshowthepoten-
| hour)inthefinalanswer. |     | OurfindingsareinlinewithDziri |     |     |     |     |     |     |     |
| ---------------------- | --- | ----------------------------- | --- | --- | --- | --- | --- | --- | --- |
tialofsolelyusingLLMsforthesetasks.
etal.(2023)andLaMalfaetal.(2024)inthatLLMstend
topreferlinearpatternmatchingandarepronetomistakes
intimecarries(Wang&Zhao,2023). LLMsforgraphreasoning. Twocomplementarylines
ofworkinformLLMswithgraphsandcanbecategorized
Correctanswersinhardproblems. Forgraphsofcom- intoimplicit andexplicit methods. Implicitmethodshelp
plexity|V|+|E|≥20,GPT-3.5andGPT-4performslightly decomposetaskgoalsintoatomicsteps(Huangetal.,2022a;
betterthanthatat|V|+|E|=18,whichhavelower-class Valmeekametal.,2022;Sakib&Sun,2024)andhelpex-
8

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
plain complex reasoning processes (Madaan et al., 2021; interestingtofurtherelaborateonourbenchmarkwiththe
Saha et al., 2021; Besta et al., 2023; Dziri et al., 2023). proposedtechniquesandourdatasettoaddmoreelements
Worksonexplicitgraphsincorporateexternalknowledge suchasresourceconstraints,multimodality,multilingualism,
andreasonaboutmorecomplexproblemssuchasmulti-hop orotherrobotics/reinforcementlearningfeatures. Practition-
questionanswering(Chenetal.,2023b;Parketal.,2023;Ye erscanalsoscaleupthecomplexityofthebenchmarkto
etal.,2023). OurworkshowsthatinstructingLLMstocon- morecomplicatedtasks. Anotherpromisingavenueofre-
siderproblemslikegraphscanimprovetheirperformance searchistocomparetheperformancepatternsofLLMsto
in planning. It also complements recent discoveries sug- those of humans (i.e. are LLMs likely to make the same
gestingthatLLMs’performancesnegativelycorrelatewith mistakesashumansinasynchronousplanreasoning).
thecomplexityofgraphproblems(Fatemietal.,2023;Guo
etal.,2023;Wangetal.,2023),showingthattheconclusion DataAccessStatement
alsoholdsinrelevantnaturalistictasks.
https://
|     |     |     |     |     |     |     | The dataset | used | in this | paper can | be found | in  |     |
| --- | --- | --- | --- | --- | --- | --- | ----------- | ---- | ------- | --------- | -------- | --- | --- |
github.com/fangru-lin/graph-llm-asynchow-plan.
| DiscourseRepresentationTheory. |          |     |                 |     | Humansproduceand |           |     |     |     |     |     |     |     |
| ------------------------------ | -------- | --- | --------------- | --- | ---------------- | --------- | --- | --- | --- | --- | --- | --- | --- |
| understand                     | language |     | in a structured |     | way. For         | instance, |     |     |     |     |     |     |     |
ImpactStatement
| when writing |           | a paragraph, | people         |     | can have | a main point |     |     |     |     |     |     |     |
| ------------ | --------- | ------------ | -------------- | --- | -------- | ------------ | --- | --- | --- | --- | --- | --- | --- |
| and then     | elaborate | on           | the supporting |     | elements | of the dis-  |     |     |     |     |     |     |     |
course(Floweretal.,1992;Limpo&Alves,2018). Graphs Thispaperpresentsworkwhosegoalistoadvancethefield
|     |     |     |     |     |     |     | of machine | learning. | There | are | many potential | societal |     |
| --- | --- | --- | --- | --- | --- | --- | ---------- | --------- | ----- | --- | -------------- | -------- | --- |
offerastructuredrepresentationofthediscourse,withele-
|     |     |     |     |     |     |     | consequences |     | of our work. | It not | only unveils | the | limi- |
| --- | --- | --- | --- | --- | --- | --- | ------------ | --- | ------------ | ------ | ------------ | --- | ----- |
mentsasnodesandrelationsasedgesrepresentingelabora-
tionandparallelortemporally/causallylinkedactions(Wolf tationsofSOTALLMsbutcanalsopotentiallyinfluence
|                                              |     |     |     |     |     |        | many downstream                    |     | tasks | such as job | scheduling        | with | the |
| -------------------------------------------- | --- | --- | --- | --- | --- | ------ | ---------------------------------- | --- | ----- | ----------- | ----------------- | ---- | --- |
| etal.,2004;Presuttietal.,2012;Maetal.,2022). |     |     |     |     |     | Recent |                                    |     |       |             |                   |      |     |
|                                              |     |     |     |     |     |        | wideapplicationofsuchtechnologies. |     |       |             | Ethically,sincewe |      |     |
workssuggestthatLLMsdonotpossessidenticallinguistic
generatepartofourbenchmarkingdatasetfromWikiHow,
representationsashumanssincetheydonotcompositionally
awebdatasource,usersmayfindrelevantcontentunsafe
| process | languageand |     | performtasks |     | ina human-likeway |     |     |     |     |     |     |     |     |
| ------- | ----------- | --- | ------------ | --- | ----------------- | --- | --- | --- | --- | --- | --- | --- | --- |
(Bertolinietal.,2022;Pressetal.,2022;Chenetal.,2023a; or uncomfortable. We try our best in the data generation
processtoleveragethemetadatainGPTmodeloutputsto
| Dzirietal.,2023). |     | Wefindinourworkthatenrichingnatu- |     |     |     |     |     |     |     |     |     |     |     |
| ----------------- | --- | --------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
filteroutallinstancesinwhicheitherthepromptitselfor
rallanguagepromptsinastructuredmannerhelpsLLMsin
thereplyisflaggedasnotcompletelysafeconcerninghate,
relevanttasks.
|     |     |     |     |     |     |     | self-harm,violence,orsexualaspects. |     |     |                      | Furthermore,unlike |     |     |
| --- | --- | --- | --- | --- | --- | --- | ----------------------------------- | --- | --- | -------------------- | ------------------ | --- | --- |
|     |     |     |     |     |     |     | socialmediaforgeneralusage,         |     |     | WikiHowisdesignedfor |                    |     |     |
7.Conclusion
gainingtipsforreal-lifetasks,whichmakesitlesslikelyto
containharmfulcontent.
Inthispaper,weautomaticallygenerateabenchmark,Asyn-
| cHow, and | assess | LLMs | for | their | performance | in asyn- |     |     |     |     |     |     |     |
| --------- | ------ | ---- | --- | ----- | ----------- | -------- | --- | --- | --- | --- | --- | --- | --- |
chronousplanreasoning. Wefindthatifnotprovidedwitha Acknowledgement
detailedillustrationofthetasksolutionprocess,allmodels
Wethankallthebodieswhohaveprovidedfundingforthe
| behave | extremely | poorly | in  | our task. | We propose | a for- |                                    |     |     |     |                 |     |     |
| ------ | --------- | ------ | --- | --------- | ---------- | ------ | ---------------------------------- | --- | --- | --- | --------------- | --- | --- |
|        |           |        |     |           |            |        | authorsandfortheassociatedproject. |     |     |     | FLissupportedby |     |     |
malismtoclassifynaturalisticasynchronousplanningtasks,
|     |     |     |     |     |     |     | ClarendonandJasonHustudentship. |     |     |     | ELMissupportedby |     |     |
| --- | --- | --- | --- | --- | --- | --- | ------------------------------- | --- | --- | --- | ---------------- | --- | --- |
whichsuccessfullypredictsLLMs’performancepatterns.
|     |     |     |     |     |     |     | the Alan | Turing | Institute. | AGC is | supported | by the | Eco- |
| --- | --- | --- | --- | --- | --- | --- | -------- | ------ | ---------- | ------ | --------- | ------ | ---- |
WeproposePLaG,amethodthatconsistentlyboostsSOTA
model performance across all task complexity levels off nomic and Social Research Council (ESRC) under grant
ES/W003473/1,bytheFundamentalResearchpriorityarea
| the shelf. | Despite | this, | we  | find that | model | performance |        |             |            |     |        |                |     |
| ---------- | ------- | ----- | --- | --------- | ----- | ----------- | ------ | ----------- | ---------- | --- | ------ | -------------- | --- |
|            |         |       |     |           |       |             | of The | Alan Turing | Institute, | and | by the | Turing Defence |     |
stilldrasticallydowngradeswithincreasingtaskcomplexity,
andSecurityprogrammethroughapartnershipwiththeUK
whichcallsintoquestionusingthemasdigitaldevicesor
governmentinaccordancewiththeframeworkagreement
generallyintelligentagents.
|     |     |     |     |     |     |     | betweenGCHQandtheAlanTuringInstitute. |     |     |     |     | JBPissup- |     |
| --- | --- | --- | --- | --- | --- | --- | ------------------------------------- | --- | --- | --- | --- | --------- | --- |
portedbytheEngineeringandPhysicalSciencesResearch
LimitationsandFutureWork
|     |     |     |     |     |     |     | Council(EP/T023333/1). |     |     | ThesupportofMicrosoftunder |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ---------------------- | --- | --- | -------------------------- | --- | --- | --- |
Somelimitationsofthisworkareasfollows.Weassumethat theirAcceleratingFoundationModelsResearchinitiative
inprovidingAzurecreditstoAGCisgratefullyacknowl-
infiniteresourcesareavailableinourbenchmarking,while
edged. Thisworkwasalsosupportedbycomputecredits
onlyfiniteresourcesmaybeavailablefortasksinreallife.
fromaCohereForAIResearchGranttoFL.Thesegrants
| Second,              | we only | consider | time          | cost | in plan optimization, |              |              |     |         |          |          |            |     |
| -------------------- | ------- | -------- | ------------- | ---- | --------------------- | ------------ | ------------ | --- | ------- | -------- | -------- | ---------- | --- |
|                      |         |          |               |      |                       |              | are designed | to  | support | academic | partners | conducting | re- |
| while realistically, |         | other    | restrictions, |      | such as               | preferences, |              |     |         |          |          |            |     |
should be considered. Regarding future work, it will be searchwiththegoalofreleasingscientificartifactsanddata
9

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
forgoodprojects. Last,wearegratefultothepeoplewho improvinglargelanguagemodelstowardsmorehuman-
offeredinvaluablefeedbackandsuggestionsalongtheway, likebehaviorinout-of-distributionreasoningtasks. arXiv
andinparticulartoallreviewersofthispaper. preprintarXiv:2205.05718,2022.
|     |     |     |     |     |     |     | Colom,R.,Karama,S.,Jung,R.E.,andHaier,R.J. |     |     |     |     | Human |     |
| --- | --- | --- | --- | --- | --- | --- | ------------------------------------------ | --- | --- | --- | --- | ----- | --- |
References
|     |     |     |     |     |     |     | intelligence | and brain | networks. |     | Dialogues | in clinical |     |
| --- | --- | --- | --- | --- | --- | --- | ------------ | --------- | --------- | --- | --------- | ----------- | --- |
neuroscience,12(4):489–501,2010.
Ahn,M.,Brohan,A.,Brown,N.,Chebotar,Y.,Cortes,O.,
David,B.,Finn,C.,Fu,C.,Gopalakrishnan,K.,Hausman,
|     |     |     |     |     |     |     | Dagan,G.,Keller,F.,andLascarides,A. |     |     |     | Dynamicplanning |     |     |
| --- | --- | --- | --- | --- | --- | --- | ----------------------------------- | --- | --- | --- | --------------- | --- | --- |
K.,etal. DoasIcan,notasIsay: Groundinglanguage arXivpreprintarXiv:2308.06391,2023.
withaLLM.
| inroboticaffordances. |     |     | arXivpreprintarXiv:2204.01691, |     |     |     |                                             |       |            |             |              |     |     |
| --------------------- | --- | --- | ------------------------------ | --- | --- | --- | ------------------------------------------- | ----- | ---------- | ----------- | ------------ | --- | --- |
| 2022.                 |     |     |                                |     |     |     | Dror,R.,Baumer,G.,Shlomov,S.,andReichart,R. |       |            |             |              |     | The |
|                       |     |     |                                |     |     |     | hitchhiker’s                                | guide | to testing | statistical | significance |     | in  |
Bertolini,L.,Weeds,J.,andWeir,D. TestingLargeLan- naturallanguageprocessing. InGurevych,I.andMiyao,
| guage | Models | on compositionality |     |     | and inference | with |            |             |     |          |        |         |     |
| ----- | ------ | ------------------- | --- | --- | ------------- | ---- | ---------- | ----------- | --- | -------- | ------ | ------- | --- |
|       |        |                     |     |     |               |      | Y. (eds.), | Proceedings | of  | the 56th | Annual | Meeting | of  |
phrase-leveladjective-nounentailment. InCalzolari,N., theAssociationforComputationalLinguistics(Volume1:
Huang,C.-R.,Kim,H.,Pustejovsky,J.,Wanner,L.,Choi, LongPapers),pp.1383–1392,Melbourne,Australia,July
K.-S., Ryu, P.-M., Chen, H.-H., Donatelli, L., Ji, H., 2018. Association for Computational Linguistics. doi:
Kurohashi, S., Paggio, P., Xue, N., Kim, S., Hahm, Y., 10.18653/v1/P18-1128. URLhttps://aclanthology.
| He, Z.,    | Lee,        | T. K., | Santus, | E., Bond, | F., and       | Na, S.- | org/P18-1128. |     |     |     |     |     |     |
| ---------- | ----------- | ------ | ------- | --------- | ------------- | ------- | ------------- | --- | --- | --- | --- | --- | --- |
| H. (eds.), | Proceedings |        | of the  | 29th      | International | Con-    |               |     |     |     |     |     |     |
Dziri,N.,Lu,X.,Sclar,M.,Li,X.L.,Jian,L.,Lin,B.Y.,
| ference | on Computational |     | Linguistics, |     | pp. 4084–4100, |     |     |     |     |     |     |     |     |
| ------- | ---------------- | --- | ------------ | --- | -------------- | --- | --- | --- | --- | --- | --- | --- | --- |
West,P.,Bhagavatula,C.,Bras,R.L.,Hwang,J.D.,etal.
| Gyeongju, | Republic |     | of Korea, | October | 2022. | Interna- |     |     |     |     |     |     |     |
| --------- | -------- | --- | --------- | ------- | ----- | -------- | --- | --- | --- | --- | --- | --- | --- |
Faithandfate:Limitsoftransformersoncompositionality.
| tional | Committee | on  | Computational |     | Linguistics. | URL |     |     |     |     |     |     |     |
| ------ | --------- | --- | ------------- | --- | ------------ | --- | --- | --- | --- | --- | --- | --- | --- |
arXivpreprintarXiv:2305.18654,2023.
https://aclanthology.org/2022.coling-1.359.
Elazar,Y.,Kassner,N.,Ravfogel,S.,Ravichander,A.,Hovy,
Besta,M.,Blach,N.,Kubicek,A.,Gerstenberger,R.,Gi-
|                                 |     |        |              |     |                  |     | E.,Schu¨tze,H.,andGoldberg,Y.             |     |     | Measuringandimprov- |     |          |     |
| ------------------------------- | --- | ------ | ------------ | --- | ---------------- | --- | ----------------------------------------- | --- | --- | ------------------- | --- | -------- | --- |
| aninazzi,                       | L., | Gajda, | J., Lehmann, |     | T., Podstawski,  | M., |                                           |     |     |                     |     |          |     |
|                                 |     |        |              |     |                  |     | ingconsistencyinpretrainedlanguagemodels. |     |     |                     |     | Transac- |     |
| Niewiadomski,H.,Nyczyk,P.,etal. |     |        |              |     | Graphofthoughts: |     |                                           |     |     |                     |     |          |     |
tionsoftheAssociationforComputationalLinguistics,9:
Solvingelaborateproblemswithlargelanguagemodels.
1012–1031,2021.
arXivpreprintarXiv:2308.09687,2023.
|     |     |     |     |     |     |     | Eppstein,D. | Parallelrecognitionofseries-parallelgraphs. |     |     |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ----------- | ------------------------------------------- | --- | --- | --- | --- | --- |
Brown,T.,Mann,B.,Ryder,N.,Subbiah,M.,Kaplan,J.D., InformationandComputation,98(1):41–55,1992.
| Dhariwal,       | P., | Neelakantan,                       |     | A., Shyam, | P., Sastry, | G., |                                             |              |         |          |     |      |        |
| --------------- | --- | ---------------------------------- | --- | ---------- | ----------- | --- | ------------------------------------------- | ------------ | ------- | -------- | --- | ---- | ------ |
|                 |     |                                    |     |            |             |     | Fatemi,                                     | B., Halcrow, | J., and | Perozzi, | B.  | Talk | like a |
| Askell,A.,etal. |     | Languagemodelsarefew-shotlearners. |     |            |             |     |                                             |              |         |          |     |      |        |
|                 |     |                                    |     |            |             |     | graph:Encodinggraphsforlargelanguagemodels. |              |         |          |     |      | arXiv  |
Advancesinneuralinformationprocessingsystems,33:
preprintarXiv:2310.04560,2023.
1877–1901,2020.
|         |                     |     |     |            |             |     | Fikes,R.E.andNilsson,N.J. |     |     | Strips: | Anewapproachto |     |     |
| ------- | ------------------- | --- | --- | ---------- | ----------- | --- | ------------------------- | --- | --- | ------- | -------------- | --- | --- |
| Bubeck, | S., Chandrasekaran, |     |     | V., Eldan, | R., Gehrke, | J., |                           |     |     |         |                |     |     |
theapplicationoftheoremprovingtoproblemsolving.
Horvitz, E., Kamar, E., Lee, P., Lee, Y. T., Li, Y., Artificialintelligence,2(3-4):189–208,1971.
| Lundberg, | S.,                        | et al. | Sparks | of artificial | general       | intel- |                                                    |     |     |     |     |     |     |
| --------- | -------------------------- | ------ | ------ | ------------- | ------------- | ------ | -------------------------------------------------- | --- | --- | --- | --- | --- | --- |
|           |                            |        |        |               | arXivpreprint |        | Flower,L.,Schriver,K.A.,Carey,L.,Haas,C.,andHayes, |     |     |     |     |     |     |
| ligence:  | EarlyexperimentswithGPT-4. |        |        |               |               |        |                                                    |     |     |     |     |     |     |
arXiv:2303.12712,2023. J.R. Planninginwriting: Thecognitionofaconstructive
|     |     |     |     |     |     |     | process. | Arhetoricofdoing: |     | Essaysonwrittendiscourse |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | -------- | ----------------- | --- | ------------------------ | --- | --- | --- |
inhonorofJamesL.Kinneavy,pp.181–243,1992.
| Chen, J., | Pan, X., | Yu,               | D., Song, | K.,        | Wang, X., | Yu, D., |                                    |     |     |     |                |     |     |
| --------- | -------- | ----------------- | --------- | ---------- | --------- | ------- | ---------------------------------- | --- | --- | --- | -------------- | --- | --- |
| and Chen, | J.       | Skills-in-context |           | prompting: | Unlocking |         |                                    |     |     |     |                |     |     |
|           |          |                   |           |            |           |         | Gilardi,F.,Alizadeh,M.,andKubli,M. |     |     |     | ChatGPToutper- |     |     |
compositionalityinlargelanguagemodels.arXivpreprint
|     |     |     |     |     |     |     | forms | crowd-workers | for | text-annotation | tasks. |     | arXiv |
| --- | --- | --- | --- | --- | --- | --- | ----- | ------------- | --- | --------------- | ------ | --- | ----- |
arXiv:2308.00304,2023a.
preprintarXiv:2303.15056,2023.
Chen,Z.,Mao,H.,Li,H.,Jin,W.,Wen,H.,Wei,X.,Wang,
Graham,R.L.,Lawler,E.L.,Lenstra,J.K.,andKan,A.R.
S.,Yin,D.,Fan,W.,Liu,H.,etal.Exploringthepotential Optimizationandapproximationindeterministicsequenc-
oflargelanguagemodels(LLMs)inlearningongraphs.
|     |     |     |     |     |     |     | ingandscheduling: |     | asurvey. | InAnnalsofdiscretemath- |     |     |     |
| --- | --- | --- | --- | --- | --- | --- | ----------------- | --- | -------- | ----------------------- | --- | --- | --- |
arXivpreprintarXiv:2307.03393,2023b.
ematics,volume5,pp.287–326.Elsevier,1979.
Collins,K.M.,Wong,C.,Feng,J.,Wei,M.,andTenenbaum, Grice, H. P. Logic and conversation. In Speech acts, pp.
| J.B. Structured,flexible,androbust: |     |     |     |     | benchmarkingand |     | 41–58.Brill,1975. |     |     |     |     |     |     |
| ----------------------------------- | --- | --- | --- | --- | --------------- | --- | ----------------- | --- | --- | --- | --- | --- | --- |
10

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Gunasekar, S., Zhang, Y., Aneja, J., Mendes, C. C. T., Kojima,T.,Gu,S.S.,Reid,M.,Matsuo,Y.,andIwasawa,
Del Giorno, A., Gopi, S., Javaheripi, M., Kauffmann, Y. Largelanguagemodelsarezero-shotreasoners. Ad-
P.,deRosa,G.,Saarikivi,O.,etal. Textbooksareallyou vances in neural information processing systems, 35:
| need.    | arXivpreprintarXiv:2306.11644,2023. |          |               |     |     |            | 22199–22213,2022.      |     |          |     |                 |     |
| -------- | ----------------------------------- | -------- | ------------- | --- | --- | ---------- | ---------------------- | --- | -------- | --- | --------------- | --- |
|          |                                     |          |               |     |     |            | Koupaee,M.andWang,W.Y. |     | Wikihow: |     | Alargescaletext |     |
| Guo, J., | Du, L.,                             | and Liu, | H. GPT4Graph: |     | Can | large lan- |                        |     |          |     |                 |     |
guagemodelsunderstandgraphstructureddata? anem- summarizationdataset. arXivpreprintarXiv:1810.09305,
| pirical | evaluation | and | benchmarking. |     | arXiv | preprint | 2018. |     |     |     |     |     |
| ------- | ---------- | --- | ------------- | --- | ----- | -------- | ----- | --- | --- | --- | --- | --- |
arXiv:2305.15066,2023.
|     |     |     |     |     |     |     | La Malfa, | E., Weinhuber, | C., | Torre, | O., Lin, | F., Cohn, |
| --- | --- | --- | --- | --- | --- | --- | --------- | -------------- | --- | ------ | -------- | --------- |
He,X.,Lin,Z.,Gong,Y.,Jin,A.,Zhang,H.,Lin,C.,Jiao, A.G.,Shadbolt,N.,andWooldridge,M. Codesimula-
|          |        |       |           |     |                 |     | tionchallengesforlargelanguagemodels. |     |     |     | arXivpreprint |     |
| -------- | ------ | ----- | --------- | --- | --------------- | --- | ------------------------------------- | --- | --- | --- | ------------- | --- |
| J., Yiu, | S. M., | Duan, | N., Chen, | W., | et al. AnnoLLM: |     |                                       |     |     |     |               |     |
Makinglargelanguagemodelstobebettercrowdsourced arXiv:2401.09074, 2024. URL https://arxiv.org/
pdf/2401.09074.
| annotators. | arXivpreprintarXiv:2303.16854,2023. |     |     |     |     |     |     |     |     |     |     |     |
| ----------- | ----------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
Holm,S. Asimplesequentiallyrejectivemultipletestpro- Lawless, C., Schoeffer, J., Le, L., Rowan, K., Sen, S.,
|         |              |     |         |                |     |        | Hill, C.S., | Suh, J., | andSarrafzadeh, |     | B. ”iwantitthat |     |
| ------- | ------------ | --- | ------- | -------------- | --- | ------ | ----------- | -------- | --------------- | --- | --------------- | --- |
| cedure. | Scandinavian |     | journal | of statistics, | pp. | 65–70, |             |          |                 |     |                 |     |
way”: Enablinginteractivedecisionsupportusinglarge
1979.
|     |     |     |     |     |     |     | language | models | and constraint | programming. |     | arXiv |
| --- | --- | --- | --- | --- | --- | --- | -------- | ------ | -------------- | ------------ | --- | ----- |
preprintarXiv:2312.06908,2023.
| Huang, F.,                         | Kwak,       | H., andAn, |           | J. IsChatGPTbetterthan |               |          |                                 |     |                             |     |                   |     |
| ---------------------------------- | ----------- | ---------- | --------- | ---------------------- | ------------- | -------- | ------------------------------- | --- | --------------------------- | --- | ----------------- | --- |
| human                              | annotators? |            | Potential | and limitations        |               | of Chat- |                                 |     |                             |     |                   |     |
|                                    |             |            |           |                        |               |          | Limpo,T.andAlves,R.A.           |     | Effectsofplanningstrategies |     |                   |     |
| GPTinexplainingimplicithatespeech. |             |            |           |                        | arXivpreprint |          |                                 |     |                             |     |                   |     |
|                                    |             |            |           |                        |               |          | onwritingdynamicsandfinaltexts. |     |                             |     | Actapsychologica, |     |
arXiv:2302.07736,2023.
188:97–109,2018.
| Huang,W.,Abbeel,P.,Pathak,D.,andMordatch,I. |           |              |              |           |            | Lan-     |                 |                                     |     |             |     |           |
| ------------------------------------------- | --------- | ------------ | ------------ | --------- | ---------- | -------- | --------------- | ----------------------------------- | --- | ----------- | --- | --------- |
|                                             |           |              |              |           |            |          | Lin, K., Agia,  | C., Migimatsu,                      |     | T., Pavone, | M., | and Bohg, |
| guage                                       | models    | as zero-shot |              | planners: | Extracting | ac-      |                 |                                     |     |             |     |           |
|                                             |           |              |              |           |            |          | J. Text2motion: | Fromnaturallanguageinstructionsto   |     |             |     |           |
| tionable                                    | knowledge |              | for embodied | agents.   | In         | Interna- |                 |                                     |     |             |     |           |
|                                             |           |              |              |           |            |          | feasibleplans.  | arXivpreprintarXiv:2303.12153,2023. |     |             |     |           |
tionalConferenceonMachineLearning,pp.9118–9147.
PMLR,2022a.
|                                             |     |     |     |     |                   |      | Lin, W., Tseng, | B.-H.,        | and Byrne,   | B.       | Knowledge-aware |             |
| ------------------------------------------- | --- | --- | --- | --- | ----------------- | ---- | --------------- | ------------- | ------------ | -------- | --------------- | ----------- |
|                                             |     |     |     |     |                   |      | graph-enhanced  | GPT-2         | for dialogue |          | state tracking. | In          |
| Huang,W.,Abbeel,P.,Pathak,D.,andMordatch,I. |     |     |     |     |                   | Lan- |                 |               |              |          |                 |             |
|                                             |     |     |     |     |                   |      | Moens,          | M.-F., Huang, | X., Specia,  |          | L., and         | Yih, S. W.- |
| guagemodelsaszero-shotplanners:             |     |     |     |     | Extractingaction- |      |                 |               |              |          |                 |             |
|                                             |     |     |     |     |                   |      | t. (eds.),      | Proceedings   | of the       | 2021     | Conference      | on Em-      |
| ableknowledgeforembodiedagents.             |     |     |     |     | InChaudhuri,K.,   |      |                 |               |              |          |                 |             |
|                                             |     |     |     |     |                   |      | pirical Methods | in            | Natural      | Language | Processing,     | pp.         |
Jegelka,S.,Song,L.,Szepesvari,C.,Niu,G.,andSabato,
7871–7881,OnlineandPuntaCana,DominicanRepub-
S.(eds.),Proceedingsofthe39thInternationalConfer-
lic,November2021.AssociationforComputationalLin-
enceonMachineLearning,volume162ofProceedingsof
|     |     |     |     |     |     |     | guistics. | doi: 10.18653/v1/2021.emnlp-main.620. |     |     |     | URL |
| --- | --- | --- | --- | --- | --- | --- | --------- | ------------------------------------- | --- | --- | --- | --- |
MachineLearningResearch,pp.9118–9147.PMLR,17–
https://aclanthology.org/2021.emnlp-main.620.
23Jul2022b.URLhttps://proceedings.mlr.press/
v162/huang22a.html. Liu, B., Jiang, Y., Zhang, X., Liu, Q., Zhang, S., Biswas,
|                       |     |     |                               |     |     |     | J.,andStone,P.                        | LLM+p: | Empoweringlargelanguage |     |               |     |
| --------------------- | --- | --- | ----------------------------- | --- | --- | --- | ------------------------------------- | ------ | ----------------------- | --- | ------------- | --- |
| Jain,A.S.andMeeran,S. |     |     | Deterministicjob-shopschedul- |     |     |     |                                       |        |                         |     |               |     |
|                       |     |     |                               |     |     |     | modelswithoptimalplanningproficiency. |        |                         |     | arXivpreprint |     |
ing: Past,presentandfuture. Europeanjournalofopera- arXiv:2304.11477,2023a.
tionalresearch,113(2):390–434,1999.
|     |     |     |     |     |     |     | Liu, C., Zhang, | S. D., | and Jabbarvand, |     | R. Codemind: | A   |
| --- | --- | --- | --- | --- | --- | --- | --------------- | ------ | --------------- | --- | ------------ | --- |
Jain, R., Sojitra, D., Acharya, A., Saha, S., Jatowt, A., frameworktochallengelargelanguagemodelsforcode
| andDandapat,S.      |     | Dolanguagemodelshaveacommon |                               |     |     |     |            |                                     |     |     |     |     |
| ------------------- | --- | --------------------------- | ----------------------------- | --- | --- | --- | ---------- | ----------------------------------- | --- | --- | --- | --- |
|                     |     |                             |                               |     |     |     | reasoning. | arXivpreprintarXiv:2402.09664,2024. |     |     |     |     |
| senseregardingtime? |     |                             | Revisitingtemporalcommonsense |     |     |     |            |                                     |     |     |     |     |
reasoning in the era of large language models. In Pro- Liu, N. F., Lin, K., Hewitt, J., Paranjape, A., Bevilac-
ceedingsofthe2023ConferenceonEmpiricalMethods qua, M., Petroni, F., and Liang, P. Lost in the middle:
inNaturalLanguageProcessing,pp.6750–6774,2023. Howlanguagemodelsuselongcontexts. arXivpreprint
arXiv:2307.03172,2023b.
| Jiang, A. | Q., Sablayrolles, |     | A., | Mensch, | A., Bamford, | C., |     |     |     |     |     |     |
| --------- | ----------------- | --- | --- | ------- | ------------ | --- | --- | --- | --- | --- | --- | --- |
Chaplot,D.S.,Casas,D.d.l.,Bressand,F.,Lengyel,G., Ma,Y.,Zhu,J.,andLiu,J. Enhancedsemanticrepresenta-
Lample,G.,Saulnier,L.,etal. Mistral7b. arXivpreprint tionlearningforimplicitdiscourserelationclassification.
| arXiv:2310.06825,2023. |     |     |     |     |     |     | AppliedIntelligence,pp.1–13,2022. |     |     |     |     |     |
| ---------------------- | --- | --- | --- | --- | --- | --- | --------------------------------- | --- | --- | --- | --- | --- |
11

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Madaan, A., Rajagopal, D., Tandon, N., Yang, Y., and linguisticframes. InKnowledgeEngineeringandKnowl-
Hovy, E. Could you give me a hint? Generating in- edgeManagement:18thInternationalConference,EKAW
ference graphs for defeasible reasoning. In Zong, C., 2012,GalwayCity,Ireland,October8-12,2012.Proceed-
Xia, F., Li, W., and Navigli, R. (eds.), Findings of the ings18,pp.114–129.Springer,2012.
| AssociationforComputationalLinguistics: |     |     |     |     | ACL-IJCNLP |     |     |     |     |     |     |     |     |     |
| --------------------------------------- | --- | --- | --- | --- | ---------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
Ro¨ttger,P.,Vidgen,B.,Hovy,D.,andPierrehumbert,J.B.
2021,pp.5138–5147,Online,August2021.Association
Twocontrastingdataannotationparadigmsforsubjective
| forComputationalLinguistics. |     |     |     | doi: 10.18653/v1/2021. |     |     |     |     |     |     |     |     |     |     |
| ---------------------------- | --- | --- | --- | ---------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
https://aclanthology.org/ nlptasks. arXivpreprintarXiv:2112.07475,2021.
| findings-acl.456. |     | URL |     |     |     |     |     |     |     |     |     |     |     |     |
| ----------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
2021.findings-acl.456.
|     |     |     |     |     |     |     | Roziere, | B., Gehring, |     | J., Gloeckle, |            | F., Sootla, | S.,    | Gat, I.,   |
| --- | --- | --- | --- | --- | --- | --- | -------- | ------------ | --- | ------------- | ---------- | ----------- | ------ | ---------- |
|     |     |     |     |     |     |     | Tan, X.  | E., Adi,     | Y., | Liu,          | J., Remez, | T.,         | Rapin, | J., et al. |
Madaan,A.,Zhou,S.,Alon,U.,Yang,Y.,andNeubig,G.
Language models of code are few-shot commonsense CodeLlama: Openfoundationmodelsforcode. arXiv
preprintarXiv:2308.12950,2023.
| learners.                            | arXivpreprintarXiv:2210.07128,2022. |     |     |     |                |     |          |          |        |         |     |            |              |     |
| ------------------------------------ | ----------------------------------- | --- | --- | --- | -------------- | --- | -------- | -------- | ------ | ------- | --- | ---------- | ------------ | --- |
|                                      |                                     |     |     |     |                |     | Russell, | S. J. S. | J. and | Norvig, | P.  | Artificial | intelligence |     |
| Mao,J.,Middleton,S.E.,andNiranjan,M. |                                     |     |     |     | Promptposition |     |          |          |        |         |     |            |              |     |
reallymattersinfew-shotandzero-shotNLUtasks.arXiv : a modern approach. Prentice Hall series in artificial
preprintarXiv:2305.14493,2023. intelligence.PrenticeHall,UpperSaddleRiver,N.J,1995.
ISBN0131038052.
| McDermott,D.M. |     | The1998AIplanningsystemscompeti- |     |     |     |     |           |        |     |        |     |             |     |        |
| -------------- | --- | -------------------------------- | --- | --- | --- | --- | --------- | ------ | --- | ------ | --- | ----------- | --- | ------ |
|                |     |                                  |     |     |     |     | Saha, S., | Yadav, | P., | Bauer, | L., | and Bansal, |     | M. Ex- |
tion. AImagazine,21(2):35–35,2000.
|     |     |     |     |     |     |     | plaGraphs: |     | An explanation |     | graph | generation |     | task for |
| --- | --- | --- | --- | --- | --- | --- | ---------- | --- | -------------- | --- | ----- | ---------- | --- | -------- |
McNemar, Q. Note on the sampling error of the differ- structured commonsense reasoning. In Moens, M.-F.,
| encebetweencorrelatedproportionsorpercentages. |     |     |     |     |     | Psy- |        |     |         |     |          |          |         |      |
| ---------------------------------------------- | --- | --- | --- | --- | --- | ---- | ------ | --- | ------- | --- | -------- | -------- | ------- | ---- |
|                                                |     |     |     |     |     |      | Huang, | X., | Specia, | L., | and Yih, | S. W.-t. | (eds.), | Pro- |
chometrika,12(2):153–157,1947. ceedings of the 2021 Conference on Empirical Meth-
|               |                                           |                 |     |     |          |         | ods in                                | Natural     | Language |       | Processing,   |           | pp. 7716–7740, |        |
| ------------- | ----------------------------------------- | --------------- | --- | --- | -------- | ------- | ------------------------------------- | ----------- | -------- | ----- | ------------- | --------- | -------------- | ------ |
| Mikolov,      | T., Grave,                                | E., Bojanowski, |     | P., | Puhrsch, | C., and |                                       |             |          |       |               |           |                |        |
|               |                                           |                 |     |     |          |         | Online                                | and Punta   |          | Cana, | Dominican     | Republic, |                | Novem- |
| Joulin,A.     | Advancesinpre-trainingdistributedwordrep- |                 |     |     |          |         |                                       |             |          |       |               |           |                |        |
|               |                                           |                 |     |     |          |         | ber 2021.                             | Association |          | for   | Computational |           | Linguistics.   |        |
| resentations. | InCalzolari,N.,Choukri,K.,Cieri,C.,De-    |                 |     |     |          |         |                                       |             |          |       |               |           |                |        |
|               |                                           |                 |     |     |          |         | doi: 10.18653/v1/2021.emnlp-main.609. |             |          |       |               |           | URL            | https: |
clerck,T.,Goggi,S.,Hasida,K.,Isahara,H.,Maegaard,
//aclanthology.org/2021.emnlp-main.609.
B.,Mariani,J.,Mazo,H.,Moreno,A.,Odijk,J.,Piperidis,
S.,andTokunaga,T.(eds.),ProceedingsoftheEleventh Sakaguchi, K., Bhagavatula, C., LeBras, R., Tandon, N.,
International Conference on Language Resources and Clark, P., and Choi, Y. proScript: Partially ordered
| Evaluation | (LREC | 2018), | Miyazaki, |     | Japan, May | 2018. |         |             |     |           |     |        |        |          |
| ---------- | ----- | ------ | --------- | --- | ---------- | ----- | ------- | ----------- | --- | --------- | --- | ------ | ------ | -------- |
|            |       |        |           |     |            |       | scripts | generation. |     | In Moens, |     | M.-F., | Huang, | X., Spe- |
European Language Resources Association (ELRA). cia,L.,andYih,S.W.-t.(eds.),FindingsoftheAssoci-
URLhttps://aclanthology.org/L18-1008.
|     |     |     |     |     |     |     | ationforComputationalLinguistics: |     |     |     |     | EMNLP2021,pp. |     |     |
| --- | --- | --- | --- | --- | --- | --- | --------------------------------- | --- | --- | --- | --- | ------------- | --- | --- |
2138–2149,PuntaCana,DominicanRepublic,Novem-
| Narang,S.,Chowdhery,A.,andZhou,D. |     |     |     |     | Self-consistency |     |           |             |     |     |               |     |              |     |
| --------------------------------- | --- | --- | --- | --- | ---------------- | --- | --------- | ----------- | --- | --- | ------------- | --- | ------------ | --- |
|                                   |     |     |     |     |                  |     | ber 2021. | Association |     | for | Computational |     | Linguistics. |     |
improveschainofthoughtreasoninginlanguagemodels.
|     |     |     |     |     |     |     | doi: 10.18653/v1/2021.findings-emnlp.184. |     |     |     |     |     | URLhttps: |     |
| --- | --- | --- | --- | --- | --- | --- | ----------------------------------------- | --- | --- | --- | --- | --- | --------- | --- |
2023.
//aclanthology.org/2021.findings-emnlp.184.
| OpenAI.              | GPT-4 | technical                 | report. |     | ArXiv | preprint, |           |        |      |     |               |     |          |         |
| -------------------- | ----- | ------------------------- | ------- | --- | ----- | --------- | --------- | ------ | ---- | --- | ------------- | --- | -------- | ------- |
|                      |       |                           |         |     |       |           | Sakib, M. | S. and | Sun, | Y.  | Consolidating |     | trees of | robotic |
| abs/2303.08774,2023. |       | URLhttps://arxiv.org/abs/ |         |     |       |           |           |        |      |     |               |     |          |         |
plansgeneratedusinglargelanguagemodelstoimprove
2303.08774.
|           |              |           |        |               |        |          | reliability.           | arXivpreprintarXiv:2401.07868,2024. |            |                              |          |                 |      |        |
| --------- | ------------ | --------- | ------ | ------------- | ------ | -------- | ---------------------- | ----------------------------------- | ---------- | ---------------------------- | -------- | --------------- | ---- | ------ |
| Park, J., | Patel, A.,   | Khan,     | O. Z., | Kim,          | H. J., | and Kim, |                        |                                     |            |                              |          |                 |      |        |
|           |              |           |        |               |        |          | Shinn, N.,             | Cassano,                            | F.,        | Gopinath,                    |          | A., Narasimhan, |      | K.R.,  |
| J.-K.     | Graph-guided | reasoning |        | for multi-hop |        | question |                        |                                     |            |                              |          |                 |      |        |
|           |              |           |        |               | arXiv  | preprint | and Yao,               | S.                                  | Reflexion: |                              | Language | agents          | with | verbal |
| answering | in large     | language  |        | models.       |        |          |                        |                                     |            |                              |          |                 |      |        |
|           |              |           |        |               |        |          | reinforcementlearning. |                                     |            | InThirty-seventhConferenceon |          |                 |      |        |
arXiv:2311.09762,2023.
NeuralInformationProcessingSystems,2023.
| Petri,C.A. | Kommunikationmitautomaten. |     |     |     | 1962. |     |     |     |     |     |     |     |     |     |
| ---------- | -------------------------- | --- | --- | --- | ----- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
Silver,T.,Hariprasad,V.,Shuttleworth,R.S.,Kumar,N.,
Press,O.,Zhang,M.,Min,S.,Schmidt,L.,Smith,N.A., Lozano-Pe´rez,T.,andKaelbling,L.P. PDDLplanning
and Lewis, M. Measuring and narrowing the com- withpretrainedlargelanguagemodels. InNeurIPS2022
positionality gap in language models. arXiv preprint FoundationModelsforDecisionMakingWorkshop,2022.
arXiv:2210.03350,2022.
Song,C.H.,Wu,J.,Washington,C.,Sadler,B.M.,Chao,
Presutti, V., Draicchio, F., and Gangemi, A. Knowledge W.-L.,andSu,Y. LLM-planner:Few-shotgroundedplan-
extractionbasedondiscourserepresentationtheoryand ningforembodiedagentswithlargelanguagemodels. In
12

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
ProceedingsoftheIEEE/CVFInternationalConference Xie, Y., Yu, C., Zhu, T., Bai, J., Gong, Z., and Soh,
onComputerVision,pp.2998–3009,2023. H. Translatingnaturallanguagetoplanninggoalswith
|                |     |                                     |     |     |     | large-languagemodels. |     |     | arXivpreprintarXiv:2302.05128, |     |     |
| -------------- | --- | ----------------------------------- | --- | --- | --- | --------------------- | --- | --- | ------------------------------ | --- | --- |
| Sternberg,R.J. |     | Towardatriarchictheoryofhumanintel- |     |     |     |                       |     |     |                                |     |     |
2023.
| ligence.    | BehavioralandBrainSciences,7(2):269–287, |            |     |            |            |              |           |            |             |             |                |
| ----------- | ---------------------------------------- | ---------- | --- | ---------- | ---------- | ------------ | --------- | ---------- | ----------- | ----------- | -------------- |
| 1984.       |                                          |            |     |            |            | Yang, Z.,    | Ishay,    | A., and    | Lee,        | J. Coupling | large lan-     |
|             |                                          |            |     |            |            | guage models |           | with logic | programming |             | for robust and |
| Takamizawa, | K.,                                      | Nishizeki, | T., | and Saito, | N. Linear- |              |           |            |             |             |                |
|             |                                          |            |     |            |            | general      | reasoning | from       | text.       | In Rogers,  | A., Boyd-      |
timecomputabilityofcombinatorialproblemsonseries- Graber, J., and Okazaki, N. (eds.), Findings of the As-
| parallelgraphs. |             | JournaloftheACM(JACM),29(3):623– |        |             |                   |                                       |          |         |                           |                        |             |
| --------------- | ----------- | -------------------------------- | ------ | ----------- | ----------------- | ------------------------------------- | -------- | ------- | ------------------------- | ---------------------- | ----------- |
|                 |             |                                  |        |             |                   | sociationforComputationalLinguistics: |          |         |                           |                        | ACL2023,pp. |
| 641,1982.       |             |                                  |        |             |                   | 5186–5219,                            | Toronto, | Canada, |                           | July 2023.             | Association |
|                 |             |                                  |        |             |                   | forComputationalLinguistics.          |          |         |                           | doi: 10.18653/v1/2023. |             |
| Touvron,        | H., Martin, | L.,                              | Stone, | K., Albert, | P., Almahairi,    |                                       |          |         |                           |                        |             |
|                 |             |                                  |        |             |                   | findings-acl.321.                     |          | URL     | https://aclanthology.org/ |                        |             |
| A., Babaei,     | Y.,         | Bashlykov,                       | N.,    | Batra,      | S., Bhargava, P., |                                       |          |         |                           |                        |             |
2023.findings-acl.321.
| Bhosale,S.,etal. |     | Llama2: | Openfoundationandfine- |     |     |     |     |     |     |     |     |
| ---------------- | --- | ------- | ---------------------- | --- | --- | --- | --- | --- | --- | --- | --- |
tuned chat models. arXiv preprint arXiv:2307.09288, Yao, S., Yu, D., Zhao, J., Shafran, I., Griffiths, T., Cao,
2023.
|     |     |     |     |     |     | Y., and Narasimhan, |     | K.  | Tree | of Thoughts: | Deliberate |
| --- | --- | --- | --- | --- | --- | ------------------- | --- | --- | ---- | ------------ | ---------- |
ProblemSolvingwithLargeLanguageModels.Advances
Valmeekam,K.,Olmo,A.,Sreedharan,S.,andKambham- inNeuralInformationProcessingSystems,36,2024.
| pati,S. | LargeLanguageModelsstillcan’tplan(abench- |     |     |     |     |     |     |     |     |     |     |
| ------- | ----------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
markforLLMsonplanningandreasoningaboutchange). Ye, R., Zhang, C., Wang, R., Xu, S., and Zhang, Y.
InNeurIPS2022FoundationModelsforDecisionMak- Natural language is all a graph needs. arXiv preprint
| ingWorkshop,2022. |     |     |     |     |     | arXiv:2308.07134,2023. |     |     |     |     |     |
| ----------------- | --- | --- | --- | --- | --- | ---------------------- | --- | --- | --- | --- | --- |
Vicentini, A. Theeconomyprincipleinlanguage. Notes Yuan, S., Chen, J., Fu, Z., Ge, X., Shah, S., Jankowski,
|     |     |     |     |     |     | C., Xiao, | Y., | and Yang, | D.  | Distilling | script knowl- |
| --- | --- | --- | --- | --- | --- | --------- | --- | --------- | --- | ---------- | ------------- |
andObservationsfromearlymodernEnglishgrammars.
Mots,Palabras,Words,3:37–57,2003. edge from large language models for constrained lan-
|     |     |     |     |     |     | guage planning. |     | In Proceedings |     | of the | 61st Annual |
| --- | --- | --- | --- | --- | --- | --------------- | --- | -------------- | --- | ------ | ----------- |
Wang,H.,Feng,S.,He,T.,Tan,Z.,Han,X.,andTsvetkov,
|     |     |     |     |     |     | Meeting | of the | Association | for | Computational | Linguis- |
| --- | --- | --- | --- | --- | --- | ------- | ------ | ----------- | --- | ------------- | -------- |
Y. Canlanguagemodelssolvegraphproblemsinnatural tics(Volume1: LongPapers),pp.4303–4325,Toronto,
language? arXivpreprintarXiv:2305.10037,2023. Canada,July2023.AssociationforComputationalLin-
|       |          |                 |     |     |                 | guistics. | doi: | 10.18653/v1/2023.acl-long.236. |     |     | URL |
| ----- | -------- | --------------- | --- | --- | --------------- | --------- | ---- | ------------------------------ | --- | --- | --- |
| Wang, | X., Wei, | J., Schuurmans, |     | D., | Le, Q. V., Chi, |           |      |                                |     |     |     |
https://aclanthology.org/2023.acl-long.236.
| E. H., | Narang, | S., Chowdhery, |     | A., and | Zhou, D. Self- |     |     |     |     |     |     |
| ------ | ------- | -------------- | --- | ------- | -------------- | --- | --- | --- | --- | --- | --- |
Consistency Improves Chain of Thought Reasoning in Zhang,L.,Lyu,Q.,andCallison-Burch,C.Reasoningabout
InTheEleventhInternationalConfer-
LanguageModels. goals, steps, and temporal ordering with WikiHow. In
enceonLearningRepresentations,2022. Webber,B.,Cohn,T.,He,Y.,andLiu,Y.(eds.),Proceed-
ingsofthe2020ConferenceonEmpiricalMethodsinNat-
| Wang, Y. | and Zhao, | Y.  | Tram: | Benchmarking | temporal |     |     |     |     |     |     |
| -------- | --------- | --- | ----- | ------------ | -------- | --- | --- | --- | --- | --- | --- |
uralLanguageProcessing(EMNLP),pp.4630–4639,On-
|     |     |     |     |     | arXiv preprint |     |     |     |     |     |     |
| --- | --- | --- | --- | --- | -------------- | --- | --- | --- | --- | --- | --- |
reasoning for large language models. line,November2020.AssociationforComputationalLin-
arXiv:2310.00835,2023. guistics. doi: 10.18653/v1/2020.emnlp-main.374. URL
https://aclanthology.org/2020.emnlp-main.374.
| Wei, J.,  | Wang,      | X., Schuurmans, |     | D., Bosma, | M., Xia, F.,     |     |     |     |     |     |     |
| --------- | ---------- | --------------- | --- | ---------- | ---------------- | --- | --- | --- | --- | --- | --- |
| Chi,      | E., Le, Q. | V., Zhou,       | D., | et al.     | Chain-of-thought |     |     |     |     |     |     |
| prompting | elicits    | reasoning       | in  | large      | language models. |     |     |     |     |     |     |
AdvancesinNeuralInformationProcessingSystems,35:
24824–24837,2022.
| Weiss,     | G., Goldberg, |           | Y., and | Yahav,        | E. Think-  |     |     |     |     |     |     |
| ---------- | ------------- | --------- | ------- | ------------- | ---------- | --- | --- | --- | --- | --- | --- |
| ing like   | transformers. |           | In      | International | Conference |     |     |     |     |     |     |
| on Machine |               | Learning, | pp.     | 11080–11090.  | PMLR,      |     |     |     |     |     |     |
2021. URLhttps://proceedings.mlr.press/v139/
weiss21a/weiss21a.pdf.
| Wolf,F.,Gibson,E.,Fisher,A.,andKnight,M. |                                        |     |     |     | Discourse |     |     |     |     |     |     |
| ---------------------------------------- | -------------------------------------- | --- | --- | --- | --------- | --- | --- | --- | --- | --- | --- |
| graphbank.                               | LinguisticDataConsortium,Philadelphia, |     |     |     |           |     |     |     |     |     |     |
2004.
13

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
A.Appendix
A.1.ExtendedPreliminaries: NaturalisticAsynchronousPlanning
A.1.1.NAIVEASYNCHRONOUSPLANNINGWITHDAG
Assuminginfiniteresources(e.g. asmanyagentsandtoolsasneededtoachieveoptimalparallelismareavailable),ourtask
canbeconsideredasfindingtheoptimaltimecostTC ofapartial-orderplanP. Apartial-orderplanP isclassicallydefined
asP =⟨A,O,C⟩,whereAisasetofactionsa(includingstartandfinish),Oisasetoforderingconstraintswhichtakethe
p
formofa ≺a ,meaninga hastobeperformedbeforea ,andC ascausallinkstakingtheformofa −→a ,meaning
i j i j i j
performinga meetspreconditionpneededfora (Russell&Norvig,1995).
i j
Specificallyforourtask,withinfiniteresources,theformalismofaDAGcapturesthecomplexityoffindingtheoptimalorder
ofexecutionofactionsthatcanorcannotbeparallelizedinP tominimizetimecostTC(P). ADAGG(P)representing
P canbedefinedasG(P)=⟨V,E,w⟩,whereV isasetofnodes,eachrepresentinganactionaintheplanningproblem.
Weservetwoauxiliarynodesv (START)andv (END)thatconnectrespectivelyeachinitialandfinalcomponentinG
src dst
ontopofothermeaningfulnodesbutdonotimpacttheoptimalsolutionoftheproblem(assketchedinFigure4). E isa
directedsetofflowrelationsrepresentingorderingconstraintsO,whilewisafunctionthatassignsweighttoalledgesinthe
graphw :E →R+. Eachflowrelationisassociatedwithapositivenumber(theweightofaconnection),namelyw(e ),
i,j
toexpressthatnode/actionv isconnectedtonode/actionv andrequiresw(e )timetobecompleted. Theedgesalso
i j i,j
representcausallinksC inthatthepreconditionpforanaction/nodeaismetifallactions/nodeslinkedtoandprecedinga
areperformed. Forsimplicity,wedenoteG(P)asGintheremainingpartofthepaper.
Inthissetting,findingthetimecostforanoptimalplanP∗inaplanningproblemisequivalenttofindingthelongestpath
G∗onGandcanbecastasthefollowingoptimizationproblemonasubgraphG′ =⟨V′,E′,w⟩, G′ ⊆G:
P∗ ∈ argmin TC(P)
P=⟨A,O,C⟩
(cid:88)
⇔G∗ ∈ argmax w(e )
i,j
G′=⟨V′,E′,w⟩⊆G
ei,j∈E′
(1)
s.t.∀v′ ∈(V′\v ),∃!v′ ∈v′ |(v′,e′ )∈(V′,E′)
i dst j i.next j i,j
(v ,v )∈V′.
src dst
Inthisformulation,v′ areverticesinGthataresuccessorsofv′.
i.next i
ConsidertheexampleinFigure4,wherewesketchtheDAGtosolvetheplanningtaskofFigure1. Themaximumtime
tocompletethewholetaskis65minutes(i.e. sequentiallyexecutingallactions),whileparallelizingallactionsviolates
constraintsonthepreconditionsofsomeactions(e.g. ‘Roll dough’and‘Add filling’cannotbedonesimultaneously).
Parallelizing ‘Roll dough’, and ‘Preheat oven’, and then executing the other actions allows solving the problem
optimally.
A.1.2.ASYNCHRONOUSPLANNINGWITHPETRINET
Whileweassumeinfiniteresourcestocompleteaplanningtask,thenaturalextensiontothecaseoffiniteresources(i.e.,
notallindependentactionscanbeparallelized)isbettercapturedbytheformalismofaPetrinet. Considerataskwhere
oneneedstomakebreakfastbygrindingcoffee(‘Grind-coffee’,3min),boilingcoffee(‘Coffee’,8min),makingtoast
(‘Bread’,10min),andfryinganegg(‘Egg’,7min). Theproblemoffindingtheoptimalorderofexecutionofactions
thatcanorcannotbeparallelizedisfullycapturedbytheformalismofPetrinets(Petri,1962). APetrinetconsistsofa
tupleN =(P,T,F),whereP andT aredisjointfinitesetsofplacesandtransitions,andF isadirectedsetofflowrelations
associatedwithapositivenumber(theweightofaconnection),namely(i,j,f ≥0). ForaninitialconfigurationofN,an
i,j
actionp∈P ‘fires’,sequentiallyorsimultaneouslywithotheractions,atransactiont∈T,ifitcontainsatoken,usually
representedasacirclethatencompassesasingledot.10 Anoptimalplanningproblemisequivalenttofindingtheshortest
transitioninaPetrinet. ConsidertheexampleinFigure9: whileonecanexecutetheactions{‘Grind-coffee’,‘Bread’,
‘Egg’}simultaneouslyorinparallel,withtheexpectedcompletiontimereportedontheedge,theaction‘Coffee’must
follow‘Grind-coffee’. Ontheotherhand,onecanexecutetheactions{‘Egg’,‘Grind-coffe’}inparallelandstart
theaction‘Coffee’when‘Grind coffee’iscomplete. SimilarlytoFigure1,theminimumamountoftimerequired
10Weassumestatescanhaveatmostonetokenandthatatransactionisactivatedifeach‘firing’statecontainsatoken.
14

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Grind coffee Coffee Grind coffee Coffee
3 3
t1 8 8
Task complete Task complete
Bread Bread
10 10
7
t2
7
Egg Egg
{Bread}, {Egg}, {Grind coffee}, {Coffee} 28 mins
{(Grind-coffe, Coffee), (Bread, Egg)} 11 mins
{(Grind-coffe, Egg)},{(Bread, Coffee)} 17 mins
{Grind-coffe}, {Coffee}, {(Bread, Egg)} 21mins
Figure9.Ontheleft,aPetrinetrepresentationoftheexampleofmakingbreakfast.Afewadmissiblerunsarereportedatthebottomwith
theircompletiontime.Actionsexecutedsequentially(inparallel)arereportedincurly(round)brackets.Ontheright,theDAGusedto
solvetheoptimalplanningproblem.
for the task is 28 minutes, while parallelising {‘Grind-coffee’, ‘Bread’, ‘Egg’} and then execute ‘Coffee’ when
‘Grind-coffee’iscompleteallowssolvingtheproblemoptimally. ForaPetrinetN =(P,T,F)representingaplanning
problem,themaximumcompletiontimeisthesumoftheweightsonthelongestpath(whiletheminimumistheminimum
timetoreachthelasttransitionfromanyparentnode).
A.1.3.ONTHECOMPLEXITYOFAPLANNINGTASKWITHFINITERESOURCES
Withinfiniteresources,i.e.,assumingonetokenperinitialnode(andthuscan‘fire’thetransition),findingtheoptimalplan
isequivalenttofindingthelongestpathfromtheinitialtothefinalstateandcanthusbecomputedefficiently. Adirected
acyclicgraph(DAG)isobtainablefromaPetrinetbydiscardingthesetoftransitionsandreversingthesignoneachedge,
thenusingasearchalgorithmthatislinearincomplexityforseries-parallelgraphs. Formally,aDAGforaplanningtask
hasthefollowingformulation: G=⟨P,W⟩,suchthatw =−f ,(f ,w )∈(F,W),whereP isthesetofstatesand
i,j i,j i,j i,j
F thesetoftransitionsandweightsinthecorrespondentPetrinet. Figure9(right)reportstheDAGformakingbreakfast.
Ontheotherhand,whenresourcesarefinite,findingtheoptimalplanningcorrespondstoanoptimizationproblemthatis
generallyNP-hardtosolve(Grahametal.,1979;Jain&Meeran,1999)asonehastoestimatethenumberofreachable
states(thestatespace)fromacombinatorialnumberofinitialconfigurationswithkresources. Whiletheexactsizeofthe
statespacedependsontheconstraintsonsequentialactions,suchanumberiscombinatorialandupper-boundedby2n(n−1),
where n is the number of actions and equivalently the number of states in the correspondent Petri net. Combinatorial
optimizationalgorithms,includinggeneticalgorithmsandsimulatedannealing,areusuallyappliedtosearchforsolutionsin
NP-hardproblemsassuchsinceexactmethodstendtobetoocomplex.
A.2.DataGenerationDetails
InadditiontoexistingdatainProScript(Sakaguchietal.,2021),weuseWikiHow(Koupaee&Wang,2018;Zhangetal.,
2020)asabasedatasettoderivetheplanningtasksweneed. ThedatagenerationstrategyisschematizedinFigure10,which
consistsoffivesteps: preprocessing,timedurationannotation,steporderingconstraintannotation,naturallanguage
promptgeneration,andgraphandgoldanswergeneration. WefirstleverageGPT-3.5/4togetherwithkeyword-catching
algorithmstofilteroutlow-qualityexamples(SectionA.2.1)andestimatethetimedurationofplanningsteps(SectionA.2.2),
andtheirdependenciesforunannotatedWikiHowdata(SectionA.2.3). ThenwecombinetheLLM-annotatedWikiHow
data(about1k)withqualifiedhuman-annotateddatainProScript(about0.6k),togeneratenaturallanguagepromptsbased
onpre-definedtemplates(SectionA.2.4)andoptimalplanningtimedeterministicallybyPython,whichisbyconstruction
correct(SectionA.2.5). Weperformautomaticandhumandataqualityvalidationandshowthatourdatasetissimilarin
qualitytoend-to-endhuman-annotateddata(Section3.1). ThisprocessculminateswithAsyncHow,acuratedlistof1.6K
datapointsforplanning,whichenablesbenchmarkingmodelsforasynchronousplanningagainstthegoldanswerprovided
bysymbolicprocessors.
Wenowprovidedetailsaboutthedatagenerationprocess. WikiHowdatasetconsistsofdifferentscripttypes,namely(i)flat
scripts,withsolelythetaskthenameandstepdescriptions;(ii)multi-methodscripts,whichdescribedifferentmethodsto
15

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Figure10.Workflow of data generation and experiment setting. During data generation, we first conduct preprocessing to collect
high-qualityscriptsfromWikiHowthatsuitourgoalwithregularexpressionandGPT-3.5,thenpromptGPT-3.5togeneratetime
estimations.Datapointswithnon-numericalestimationsarediscarded.TheremainingdatapointsarerunthroughGPT-4togetstep
dependenciesindotlanguage.Then,wecombineourdatasetwithProScriptandpulltogetherinformationtogeneratenaturallanguage
prompts.Weuseanexternaloraclesymbolicprocessortogenerategraphsrepresentinggiveninformationaswellasgenerateground
truthanswersforoptimaltasktimeduration.Inbenchmarkingexperiment,wepromptLLMswithnaturallanguagetaskdescriptionsand
comparemodels’answerswithgoldsymbolicprocessoroutputs.
solveonetask;and(iii)multi-partscripts,whichdescribecomplementarypartstosolveatask. Weexcludescripttype(i)
and(iii)instancesentirelyifanyoftheirsub-partsdonotmeetourrequirement;weonlyexcludetheunqualifiedmethodsin
scripttype(ii)aswecanviewdifferentmethodsasdifferentindependentscripts. Weclarifythequalificationcriteriabelow.
A.2.1.PRE-PROCESSING
First,wetakethescriptswithacollaborativeratingscore(i.e.,thehelpfulpercentageinWikiHow)higherthan60%to
retainonlyhigh-qualityplansmarkedasusefulbytheusersofWikiHow. WeleverageGPT-3.5andkeywordsmethodsto
filteroutplanswithoptionalsteps(e.g.,‘If you are not happy with the results, proceed to follow steps’)
andothersthatdonotfitintoourresearchgoal(wereportalistoffilteringkeywordsanddescriptionsinAppendixA.4).
InspiredbyWangetal.(2022),plansthatcontainunnecessarystepsarefurtherfilteredwithGPT-3.5inafew-shotsetting
bysamplingthreeanswers(withthetemperaturesettoone)toexcludethoseinwhichthemajorityvotedoesnotagreeon
allparts/stepsbeingnecessaryforascript(seepromptsanddetailsinAppendixA.5).
A.2.2.TIMEANNOTATION
We use GPT-3.5 to estimate the time duration per step. We use a zero-shot setting by sampling three answers (with
temperaturesettoone)andexcludeinstanceswhosestepsdurationanLLMcannotquantifynumerically(seepromptsand
detailsinAppendixA.5). Empirically,wekeepthelongestamongallthetimeestimationsGPT-3.5proposesforeachstep.
Wenotethatthelongesttimeestimationisnotnecessarilyalwaystheonlyacceptableanswer. Wedonotparticularlyverify
timeannotationbecausethetasktimeestimationinalessgroundedsettingasourstendsnottohaveauniquegoldanswer
(e.g. ‘finding a gym’maytakefiveminutesoraweektodifferentpeople),andGPT-3.5isreportedbeingareliable
annotatorforthistask(Jainetal.,2023). Furthermore,ourinterestisinassessingwhetheranLLMoutputstheoptimalplan
foratask,andweexpectenduserstosupplydifferenttimedurationswhenqueryingamodel.
16

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
A.2.3.STEPORDERINGCONSTRAINTANNOTATION
WeuseGPT-4inzeroshotwiththetemperaturesettoonetosamplefiveanswersperprompttoannotatedependencies
amongsteps(seemoredetailsinAppendixA.5). Specifically,wefirstshufflestepsineachscriptandthenusedotlanguage,
anunambiguoussyntax(e.g.,‘step 1 must precede step 2’isexpressedas‘step 1 → step 2’),toobtainstep
dependenciestobecompliantwiththeProScriptformat. Forflatscriptstype(i),weannotatedependenciesamongallsteps,
whileformulti-methodscriptstype(ii),weannotatedependenciesbymethod;multi-parttaskdependenciesintype(iii)are
annotatedfirstamongdifferentpartsandthenamongdifferentstepsperpart,whicharethencombinedtoformulatethefinal
dependencies. Afterremovingredundantdependencies,wekeepdatapointsthathaveatleastfourconsistentanswersthat
formasynchronousplansanddiscardtheothers(e.g. inananswersaying‘step 1 → step 2’, ‘step 2 → step 3’,
‘step 1 → step 3’,weremove‘step 1 → step 3’)inasimilarveintoself-consistencyprompting(Narangetal.,
2023).
A.2.4.NATURALLANGUAGEPROMPTGENERATION
We combine all asynchronous instances with complete time annotation for all meaningful steps in ProScript with our
generatedasynchronousinstancesfromWikiHow. WefilteroutallinstanceswithunannotatedpreparationstepsinProScript
orthoseflaggedasunsafebyeitherGPT-3.5orGPT-4inWikiHowduringtheabovegenerationprocess. Bykeepingonly
high-qualityasynchronousplansfromtheWikiHowandtheProScriptdatasets,weobtainacollectionof1.6Kinstances.
We then generate natural language prompts based on the task information. Dot language, which we used for ordering
constraint generation, provides an unambiguous syntax to formulate a planning problem, yet users tend to use natural
languagedescriptionstospecifysuchatask. WepromptGPT-4toexpressthedependencyconstraintwithdifferentlinguistic
formulations,andweendupwithtenplausibletemplates. WereportalltemplatesinAppendixA.6andincludepromptsfor
theminourfinaldataset.
Wefurthernotethatpeoplecancombinedifferentconstraintexpressionsforsuccinctusage,aphenomenonwidelyaccepted
linguisticallyknownastheprincipleofquantity/economy(Grice,1975;Vicentini,2003). Forexample,theconstraint‘Step
1 must precede step 2, step 1 must precede step 3’canbesimilarlyutteredas‘Step 1 must precede step
2 and 3’. We,therefore,alsoincludeeconomicusageforthesetemplatesbycombiningthestepsfollowingthecommon
precedingstepasexemplifiedabovetoallowstudiesaboutLLMs’robustnesstotriviallydifferentnaturallanguageprompts.
A.2.5.GRAPHANDGOLDANSWERGENERATION
Togenerategoldanswersforaplanningtask,weparsestepdependencieswithregularexpressionsandgenerateanequivalent
DAGrepresentingtheworkflow. Wegeneratetheoptimaltimedurationforaplanbyiteratingeverysequentialpathand
choosing the longest one (the longest path algorithm would produce an equivalent gold label). Each planning task is
eventuallycoupledbyfourtypesofgraphrepresentations: theadjacencyandtheedgelist,theadjacencymatrix,andthe
compressed sparse row (csr). Such representations can be used to aid LLMs in structural reasoning and assess LLMs’
robustnessagainstdifferentrepresentationsofthesamegraphs.
A.3.TopicAssignment
WikiHowdataiscoupledwithmetadata,includingcategoryhierarchy. FortheWikiHowproportionofourbenchmark,we
takethetop-rankedcategoryforeachinstanceasitstopic. ToassigntopicsfordatapointsinProScript,weusefast-textstatic
embedding(Mikolovetal.,2018)trainedon600BCommonCrawldatatoembedtaskdescriptionsforbothWikiHowand
ProScriptdatainourbenchmarkandmean-poolingtherepresentationsafterremovingstopwords. Weassignatopicits
vectorbymean-poolallWikiHowtaskrepresentationsforpromptsassociatedwithit. Wethencalculatethecosinesimilarity
andselectthehighestoneasthecorrespondingcategorybetweeneachtopicvectorandtaskvectorforeachtaskinProScript
andassignthetopicwithhighestsimilarityforeachtask.
A.4.KeywordsExcludedFromWikiHowDataset
Weexcludeinstancesthatcontainthefollowingkeywordsthatfallintocategoriesoutofourbenchmarkgoalduringdataset
pre-processing:
AsourtaskisrepresentedwithoutcontextsuchasimagesintheWikiHowwebpage,weexcludecontext-dependentwords:
17

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
| this, | above, below. |     |     |     |     |     |
| ----- | ------------- | --- | --- | --- | --- | --- |
Weonlymaintaintasksthatcanbecalculatedfortheirexacttimedurationsoweexcludewordsindicatingongoingprocess
| ornotimeduration: |     | keep, | know, knowing, | become, | be, stay, repeat. |     |
| ----------------- | --- | ----- | -------------- | ------- | ----------------- | --- |
Weassumeallstepsinaplanarecompulsorysoweexcludewordsindicatingoptionalprocedures: opt, if.
Wewantallstepsinaplantonotoverlapeachothersoweexcludewordsindicatingparallelconstraints: when, while.
We assume steps to have no intervals among them so we exclude words indicating intervals between steps: after,
before.
A.5.PromptsandSettingsforDatasetGeneration
|     |     |     | Table3. PromptsandsettingsusedtogenerateAsyncHowdataset. |     |     |     |
| --- | --- | --- | -------------------------------------------------------- | --- | --- | --- |
TaskPrompt N-shotExample Shotnumber SystemPrompt Temperature Samplingstrategy
Necessity
Hereisascriptin[TASK]. To ’Make a Chicken Sandwich’, 5 Youareahelpfulplanorganizer. 1 Sample 3 answers
Check
[TASK DESCRIPTION] hereisascriptin’MakingaFried andtakethemajority
|     | Question:                | Is this script     | ChickenSandwich’.step1:Done!;       |                   |              | vote. |
| --- | ------------------------ | ------------------ | ----------------------------------- | ----------------- | ------------ | ----- |
|     | showing                  | different alterna- | step2: Add                          | oil to a          | large frying |       |
|     | tivestocompletethistask? |                    | pan.; step3:                        | Cutthechickeninto |              |       |
|     | Let’s think              | step by            | step thinstripsandaddtoppingsofyour |                   |              |       |
|     | then provide             | final answer       | choice.;step4:Getthenecessaryin-    |                   |              |       |
|     | yesornoindoublequotes.   |                    | gredients.; step5:                  | Mixthebatter.;    |              |       |
|     | Answer:                  |                    | step6: Batterthechicken.;           |                   | step7:       |       |
Puteachpieceofchickeninthepan.
Question:Isthisscriptshowingdif-
ferentalternativestocompletethis
task? Let’sthinkstepbystepthen
providefinalansweryesornoin
|     |     |     | doublequotes. | Answer:Thesteps |     |     |
| --- | --- | --- | ------------- | --------------- | --- | --- |
aspresentedarenotinalogicalse-
quentialorder.However,theydon’t
providealternativemethodstomake
afriedchickensandwichbutrather
arepartsofasinglemethodthatare
|     |     |     | outoforder. | Toproperlymakea |     |     |
| --- | --- | --- | ----------- | --------------- | --- | --- |
sandwich,thesestepsneedtobere-
arrangedintoasensiblesequence
(e.g.,gatheringingredients,prepar-
ingthechickenandbatter,fryingthe
chicken,andassemblingthesand-
wich).
Time Hereisascriptto[TASK]. NONE 0 Youareahelpfulplanorganizer. 1 Sample 3 answers
Annotation
|     | [TASK                   | DESCRIPTION]  |     |     |     | andtakethelongest   |
| --- | ----------------------- | ------------- | --- | --- | --- | ------------------- |
|     | Question:Canyouestimate |               |     |     |     | timeifany. Exclude  |
|     | eachstepinthisscriptfor |               |     |     |     | instanceswhichhave  |
|     | a numerical             | time duration |     |     |     | unannotatablesteps. |
wherepossible?Let’sthink
|     | step by | step and finally |     |     |     |     |
| --- | ------- | ---------------- | --- | --- | --- | --- |
answerinajsonformat”step
|     | index”: | ”duration”, each |     |     |     |     |
| --- | ------- | ---------------- | --- | --- | --- | --- |
|     | entry a | line with double |     |     |     |     |
quotesandnodescription
Step
Dependency Herearerandomlyordered NONE 0 YouareChatGPT. 1 Sample 5 answers
| Annotation | steps needed              | to [TASK].     |     |     |     | andtakethe4consis-  |
| ---------- | ------------------------- | -------------- | --- | --- | --- | ------------------- |
|            | [TASKDESCRIPTION]As-      |                |     |     |     | tentanswersafterre- |
|            | sumeinfiniteresourcesare  |                |     |     |     | movingauxiliaryde-  |
|            | available                 | and that steps |     |     |     | pendencies.Exclude  |
|            | shouldbeparallelizedwhere |                |     |     |     | instances that have |
|            | possible.Foreachstep,does |                |     |     |     | lessthan4consistent |
|            | it logically              | need to follow |     |     |     | answers.            |
othersconsideringthenature
ofthetask?Let’sthinkstep
bystepthenfinallyanswer
indotlanguageforallnec-
essaryconstraints,eachcon-
|     | straint per | line in the | for- |     |     |     |
| --- | ----------- | ----------- | ---- | --- | --- | --- |
matof”precedingstepindex”
−>”followingstepindex”
18

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
A.6.NaturalLanguagePromptsforStepOrderingConstraints
WepromptGPT-4webinterfacetoprovide10differentwaystoexpressdotlanguageconstraintswithnaturallanguage,and
randomlysamplefromthemtoformourprompts.
Prompt
Supposeyouneedtoexecuteseveralstepstocompleteatask. Withdotlanguage,youcanrepresenttemporalconstraintsof
thestepssuchas”precedingstep”−>”followingstep”. Howcanyousuccinctlyexpresstheconstraintinnaturallanguage?
Giveme10differentexpressions.
Response
Toexpressthetemporalconstraintsbetweenaprecedingstepandafollowingstepinnaturallanguage,youcouldsay:
”Beforestarting[followingstep],complete[precedingstep].”
”[Precedingstep]mustprecede[followingstep].”
”Uponcompleting[precedingstep],proceedto[followingstep].”
”After[precedingstep],[followingstep]shouldcommence.”
”Prioritize[precedingstep]beforeadvancingto[followingstep].”
”[Precedingstep]isaprerequisitefor[followingstep].”
”Initiate[followingstep]subsequentto[precedingstep].”
”Ensure[precedingstep]isdonebefore[followingstep].”
”Sequencethetasks: firstly[precedingstep],then[followingstep].”
”[Followingstep]followsthecompletionof[precedingstep].”
A.7.VaryingNaturalLanguagePromptingDetails
Wefirstsample100promptsforalltemplatesinA.6tocomputemodelaccuraciesinthesetemplateswithoutsuccinctusage
(e.g. ‘Step 1 must precede step 2, step 1 must precede step 3’). Then,aswenotethatthesuccinctusageof
suchlinguisticutterancesiswidelyacceptedastheprincipleofeconomy/quantity: donotsaymorethanwhat’sneeded
(Grice,1975;Vicentini,2003),wechoosethebesttemplateandtestwhetheramodelcanachievebetterperformancewith
succinctusage(e.g. ‘Step 1 must precede step 3’). Then,wechoosethebest-performingpromptingsettingforthe
restoftheexperiment.
A.8.PromptExamplesforBenchmarkingExperiment
Zeroshot(zero-shot)
Tocreateavideogame,herearethestepsandthetimesneededforeachstep.
Step1. Learnthebasicsofprogramming(180days)
Step2. Learntousealanguagethatisusedingames(60days)
Step3. Learntouseanexistinggameengine(30days)
Step4. Programthegame(90days)
Step5. Testthegame(30days)
Theseorderingconstraintsneedtobeobeyedwhenexecutingabovesteps:
Step1mustprecedestep2.
Step1mustprecedestep3.
Step2mustprecedestep4.
Step3mustprecedestep4.
Step4mustprecedestep5.
Question: Assume that you need to execute all the steps to complete the task and that infinite resources are avail-
able. Whatistheshortestpossibletimetocreateavideogame? Answerthetimeindoublequotes.
Answer:
19

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Zeroshot+CoT(zero-shot+CoT)
Tocreateavideogame,herearethestepsandthetimesneededforeachstep.
Step1. Learnthebasicsofprogramming(180days)
Step2. Learntousealanguagethatisusedingames(60days)
Step3. Learntouseanexistinggameengine(30days)
Step4. Programthegame(90days)
Step5. Testthegame(30days)
Theseorderingconstraintsneedtobeobeyedwhenexecutingabovesteps:
Step1mustprecedestep2.
Step1mustprecedestep3.
Step2mustprecedestep4.
Step3mustprecedestep4.
Step4mustprecedestep5.
Question: Assume that you need to execute all the steps to complete the task and that infinite resources are avail-
able. Whatistheshortestpossibletimetocreateavideogame? Let’sthinkstepbystepandthenanswerthetimeindouble
quotes.
Answer:
k-shot
###Examples:
ToMakeCalzones,herearethestepsandthetimesneededforeachstep.
Step1. Preheattheovento425degrees. (10min)
Step2. Rolloutthedough. (10min)
Step3. Addthefilling. (15min)
Step4. Foldandpinchthedough. (5min)
Step5. Bakethecalzones. (25min)
Theseorderingconstraintsneedtobeobeyedwhenexecutingabovesteps:
Step1mustprecedestep5.
Step2mustprecedestep3.
Step3mustprecedestep4.
Step4mustprecedestep5.
Question: Assume that you need to execute all the steps to complete the task and that infinite resources are avail-
able. WhatistheshortestpossibletimetoMakeCalzones? Answerthetimeindoublequotes.
Answer: TheshortestpossibletimetoMakeCalzonesis”55min”.
...[TWOMOREEXAMPLES]...
###
[ZEROSHOTPROMPT]
k-shot+CoT
###Examples:
ToMakeCalzones,herearethestepsandthetimesneededforeachstep.
Step1. Preheattheovento425degrees. (10min)
Step2. Rolloutthedough. (10min)
Step3. Addthefilling. (15min)
Step4. Foldandpinchthedough. (5min)
Step5. Bakethecalzones. (25min)
20

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Theseorderingconstraintsneedtobeobeyedwhenexecutingabovesteps:
Step1mustprecedestep5.
Step2mustprecedestep3.
Step3mustprecedestep4.
Step4mustprecedestep5.
Question: Assume that you need to execute all the steps to complete the task and that infinite resources are avail-
able. WhatistheshortestpossibletimetoMakeCalzones? Answerthetimeindoublequotes.
Answer: Sincestep1mustprecedestep5,step2mustprecedestep3,step3mustprecedestep4,step4mustprecedestep5,
wecanconcludethatwemustexecutestep2,step3,step4,thenstep5sequentially,andsincestep1happensbeforestep5,
itcanbedoneinparallelwithstep2,3,and4,precedingstep5. Sincesequentiallyexecutingstep2,3,4,and5takes10+
15+5+25=55min,whilesequentiallyexecutingstep1thenstep5onlytakes10+25=35min,theshortestpossibletime
toMakeCalzonesis”55min”.
...[TWOMOREEXAMPLES]...
###
[ZEROSHOT+COTPROMPT]
PLaG(explicitgraph,graphisadjacencylist)
###Examples:
ToMakeCalzones,herearethestepsandthetimesneededforeachstep.
Step1. Preheattheovento425degrees. (10min)
Step2. Rolloutthedough. (10min)
Step3. Addthefilling. (15min)
Step4. Foldandpinchthedough. (5min)
Step5. Bakethecalzones. (25min)
Theseorderingconstraintsneedtobeobeyedwhenexecutingabovesteps:
Step1mustprecedestep5.
Step2mustprecedestep3.
Step3mustprecedestep4.
Step4mustprecedestep5.
Hereistheadjacencylistrepresentationofthesteporderingconstraints:
{’1’: [’5’],’2’: [’3’],’3’: [’4’],’4’: [’5’],’5’: [’END’],’END’:[],’START’:[’1’,’2’]}
Timeforeachstepcanberepresentedasadictionary:
{’1’: ’10min’,’2’: ’10min’,’3’: ’15min’,’4’: ’5min’,’5’: ’25min’}
Question: Assume that you need to execute all the steps to complete the task and that infinite resources are avail-
able. WhatistheshortestpossibletimetoMakeCalzones? Answerthetimeindoublequotes.
Answer: Sincestep1mustprecedestep5,step2mustprecedestep3,step3mustprecedestep4,
step4mustprecedestep5,wecanconcludethatwemustexecutestep2,step3,step4,thenstep5sequentially,andsince
step1happensbeforestep5,itcanbedoneinparallelwithstep2,3,and4,precedingstep5. Sincesequentiallyexecuting
step2,3,4,and5takes10+15+5+25=55min,whilesequentiallyexecutingstep1thenstep5onlytakes10+25=35
min,theshortestpossibletimetoMakeCalzonesis”55min”.
...[TWOMOREEXAMPLES]...
###
Tocreateavideogame,herearethestepsandthetimesneededforeachstep.
Step1. Learnthebasicsofprogramming(180days)
Step2. Learntousealanguagethatisusedingames(60days)
Step3. Learntouseanexistinggameengine(30days)
Step4. Programthegame(90days)
21

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Step5. Testthegame(30days)
Theseorderingconstraintsneedtobeobeyedwhenexecutingabovesteps:
Step1mustprecedestep2.
Step1mustprecedestep3.
Step2mustprecedestep4.
Step3mustprecedestep4.
Step4mustprecedestep5.
Hereistheadjacencylistrepresentationofthesteporderingconstraints:
{’1’: [’2’,’3’],’2’: [’4’],’3’: [’4’],’4’: [’5’],’5’: [’END’],’END’:[],’START’:[’1’]}
Timeforeachstepcanberepresentedasadictionary:
{’1’: ’180days’,’5’: ’30days’,’2’: ’60days’,’4’: ’90days’,’3’: ’30days’}
Question: Assume that you need to execute all the steps to complete the task and that infinite resources are avail-
able. Whatistheshortestpossibletimetocreateavideogame? Let’sthinkstepbystepandthenanswerthetimeindouble
quotes.
Answer:
PLaG(BaG,graphisadjacencylist)
###Examples:
ToMakeCalzones,herearethestepsandthetimesneededforeachstep.
Step1. Preheattheovento425degrees. (10min)
Step2. Rolloutthedough. (10min)
Step3. Addthefilling. (15min)
Step4. Foldandpinchthedough. (5min)
Step5. Bakethecalzones. (25min)
Theseorderingconstraintsneedtobeobeyedwhenexecutingabovesteps:
Step1mustprecedestep5.
Step2mustprecedestep3.
Step3mustprecedestep4.
Step4mustprecedestep5.
Question: Assume that you need to execute all the steps to complete the task and that infinite resources are avail-
able. What is the shortest possible time to Make Calzones? Let’s construct a graph with the nodes and edges first to
representsteporderingconstraints,andalsoconstructadictionarytorepresenttimeneededforeachstep. Usethegraphand
dictionarytocalculatetheshortestpossibletimeneededforthetask. Let’sthinkstepbystepandthenanswerthetimein
doublequotes.
Answer: Hereistheadjacencylistrepresentationofthesteporderingconstraints:
{’1’: [’5’],’2’: [’3’],’3’: [’4’],’4’: [’5’],’5’: [’END’],’END’:[],’START’:[’1’,’2’]}
Timeforeachstepcanberepresentedasadictionary:
{’1’: ’10min’,’2’: ’10min’,’3’: ’15min’,’4’: ’5min’,’5’: ’25min’}
Sincestep1mustprecedestep5,step2mustprecedestep3,step3mustprecedestep4,step4mustprecedestep5,wecan
concludethatwemustexecutestep2,step3,step4,thenstep5sequentially,andsincestep1happensbeforestep5,itcan
bedoneinparallelwithstep2,3,and4,precedingstep5. Sincesequentiallyexecutingstep2,3,4,and5takes10+15+5
+25=55min,whilesequentiallyexecutingstep1thenstep5onlytakes10+25=35min,theshortestpossibletimeto
makeCalzonesis”55min”.
...[TWOMOREEXAMPLES]...
###
22

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Tocreateavideogame,herearethestepsandthetimesneededforeachstep.
Step1. Learnthebasicsofprogramming(180days)
Step2. Learntousealanguagethatisusedingames(60days)
Step3. Learntouseanexistinggameengine(30days)
Step4. Programthegame(90days)
Step5. Testthegame(30days)
Theseorderingconstraintsneedtobeobeyedwhenexecutingabovesteps.
Step1mustprecedestep2.
Step1mustprecedestep3.
Step2mustprecedestep4.
Step3mustprecedestep4.
Step4mustprecedestep5.
Question: Assume that you need to execute all the steps to complete the task and that infinite resources are avail-
able. Whatistheshortestpossibletimetocreateavideogame? Let’sconstructagraphwiththenodesandedgesfirstto
representsteporderingconstraints,andalsoconstructadictionarytorepresenttimeneededforeachstep. Usethegraphand
dictionarytocalculatetheshortestpossibletimeneededforthetask. Let’sthinkstepbystepandthenanswerthetimein
doublequotes.
Answer:
Prototypicaltask(edgelist)
Thefollowinglistsofnodes[0,1,2,3,4,5,6,7,8,9,10]andedges[[0,1,1],[1,2,1],[1,3,1],[2,10,1],...,[9,10,5]]
defineadirectedacyclicgraph. Eachelementinthelistofedgesisexpressedintheform(i,j,w),andspecifiesthatnodei
connectstonodejwithweightw. Whatisthelengthofthelongestpathfromnode0tonode10? Thinkstepbystepand
thenreplywiththenumericalvalueoftheshortestpathenclosedby<result><result>tags.
Answer:
A.9.ResultsafterExcludingInvalidInstances
Wereportresultsafterexcludinginvalidinstancesaltogetherinallmodelsandsettingsperexperimentifaninstanceis
filteredinanysettinginanexperiment(e.g. ifinstanceindexed0isinvalidinzero-shotGPT-4experiment,weremoveit
fromallthetestresultsforallmodelsandsettings). Generalconclusionsremainthesameasourmaincontent.
Table4.Model accuracy in different settings on the AsyncHow benchmark. Model performances without our method are in plain
background,whilethosewithourmethodareinbluebackground.Wemarkthebestperformancepermodelinbold.FollowingDroretal.
(2018),weuseMcNemar’stests(McNemar,1947)toobtainp-valuesandHolm-Bonferronimethod(Holm,1979)tocorrectthemfor
eachevaluationtotestthestatisticalsignificanceofperformancedifferencebetweenexperimentwithandwithoutourproposedmethod.
Wedenotewith†whentheperformanceswithPLaGaresignificantlybetter(p<0.05)thanthebestresultwithout.
Model zero-shot zero-shot+CoT k-shot k-shot+CoT PLaG(explicitgraph) PLaG(BaG)
GPT-4 0.128 0.128 0.108 0.657 0.728† 0.771†
GPT-3.5 0.191 0.217 0.241 0.224 0.284† 0.348†
Command 0.079 0.015 0.051 0.078 0.098 0.052
LLaMA-2-70B-chat 0.039 0.036 0.053 0.074 0.101† 0.069
Mistral-7B-Instruct 0.074 0.070 0.099 0.142 0.155 0.144
23

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Figure11.Leftplotreferstoaveragemodelperformanceaccuracywithkshot+CoTindifferentgraphs.Dotsrefertomodelperformance
withdifferentgraphtypes. Greylinesrefertoaverageaccuracywithdifferentgraphtypes. Therightplotreferstoaveragezero-shot
accuracyindifferenttextprompts.Errorbarsinbothplotsrefertoworst/bestperformance
Figure12.Comparingparallel/sequentialplanexecutionaccuracywithasynchronousplans.Allexperimentsaredoneinthesettingof
k-shot+CoT.BlueandorangelinesrefertoGPT-4andGPT-3.5resultsrespectively.
Figure13.Modelaccuracyconcerningtaskcomplexity.Theleftfigureplotsmodelperformancewithoutourmethod(PLaG),andthe
rightplotdisplaysthemodels’bestperformancewith/withoutourmethod.
A.10.FurtherComparisonwithChain-of-ThoughtSelf-consistencyandTreeofThought
WefurtheraddedexperimentsonChain-of-ThoughtSelf-Consistency(CoT-SC)(Wangetal.,2022)andToT(Yaoetal.,
2024)(bothforkshot,k=3asinourmainpaper). Wereportresultsfork-shotCoT-SCandToT,incomparisontoPLaG
below(bestresultsareinbold). Weseethatourmethodoutperformsbothmethodswhileinducingmuchlesscost(see
AppendixA.11).
Table5.Comparingk-shotCoT-SC/ToTwithPLaGonGPT-3.5andGPT-4. Thebestresultspermodelareinbold. Ourmethodsare
alwayssuperior.
k-shotCoT-SC k-shotToT PLaG(explicitgraph) PLaG(BaG)
GPT-3.5 0.240 0.263 0.290 0.355
GPT-4 0.625 0.624 0.730 0.777
24

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
A.11.LatencyAnalysis
Weanalyzethecost-performancetrade-offforPLaGhere. PLaGintroducessignificantlylongerinferencesequencesthan
thezero-shotsetting,butwenotethatitscostisreasonablecomparedtootheradvancedpromptingmethods. Weprovidea
statisticalcomparisonoftheaverageinput/outputtokencountpertaskforGPT-4below.
WenotethattheoutputtokenlengthsofPLaG(explicitgraph)arecomparabletothatofk-shotCoT,whilek-shotCoT-SC
andk-shotToTaremuchmoreexpensiveandunderperformbothPLaGmethods(seeAppendixA.10).
|     | Table6. | Latencyanalysis:comparingPLaGwithotherpromptingmethods. |     |     |
| --- | ------- | ------------------------------------------------------- | --- | --- |
zeroshot k-shotCoT PLaG(explicitgraph) PLaG(BaG) k-shotCoT-SC k-shotToT
tokens(input/output) 207/5 1289/135 1698/138 1775/242 1289/407 5212/335
TheincreasedinputandoutputlengthcausedbyPLaGmayraiseconcernsaboutthescalingpotentialofthetechnique(i.e.,
whetheritisstillapplicablewhentherearehundredsofnodesormoreinagraph). First,weconsiderthistobeaproblem
mainlyforLLMcontextwindowlength,whichisuniversaltoallNLPproblemsingeneral. Insummarizationtasks,for
example,anLLMcan’tsummarizeabookwhoselengthgoesbeyondtheLLM’scontextlength,butthisdoesn’tinvalidate
summarizationasatask. Second,thelengthofgraphrepresentationalsodependsonthegraphformat: ifagraphisprovided
asitsdependencylist,itssizewillgrowlinearlywiththenumberofnodesandedges,asopposedtotheadjacencymatrix,
whichscalesquadratically.
Second,ourdataset,whichisgeneratedfromreal-lifetaskswithoutspecificpruningforcomplexones,showsverysparse
datapointsforcomplexitywhichgoesbeyond20(Figure5). Thisobservationmotivatesustoconsideradditionalgraph
promptingasavalidtechniquetoimproveLLMperformanceinawiderangeoftasks.
A.12.ComparingPLaGPerformanceonModel-generatedandHuman-annotatedData
Here,wecompareGPT-3.5/4performanceonmodel-generatedandhuman-annotateddatatoshowthattheperformancegap
betweentheexplicitgraphandBaGusedinPLaGisnotcausedbynoiseinsampling. Weperformadditionalexperimentsto
compareBaGandexplicitgraphontaskcomplexity14,whichhas> 100datapointsforboththesyntheticandhuman-
annotatedpartsofourdataset. WefindthattheBaGframeworkperformsconsistentlybetterthantheexplicitgraphasshown
below,whichmeansthesuperiorperformanceofBaGshouldnotbeattributedtonoisesampling.
Table7.Compareexplicitgraph(left)andBaG(right)asPLaGmethodsinhuman-annotateddataandmodel-generateddata.Thebest
resultsareinbold.
|     |                            | Human-annotateddata |             | Generateddata |
| --- | -------------------------- | ------------------- | ----------- | ------------- |
|     | GPT-3.5(explicitgraph/BaG) |                     | 0.239/0.279 | 0.315/0.389   |
|     | GPT-4(explicitgraph/BaG)   |                     | 0.614/0.701 | 0.778/0.796   |
A.13.ModelPerformancewithEconomicLinguisticExpressions
WereportresultscomparingLLMs’performancebetweendirectandeconomicexpressionsinFigure8. Generally,models’
performancedowngradeswhenusingeconomicexpressionsexceptLLaMA-2-70B-chat.
Table8. Comparemodelperformancewithunambiguousdirectexpressionwitheconomicexpressions.
Model Bestdirectexpressionperformance Performancedifferenceafterusingeconomicexpressions
| GPT-3.5             |     | 0.222 |     | -0.012 |
| ------------------- | --- | ----- | --- | ------ |
| GPT-4               |     | 0.171 |     | -0.021 |
| Command             |     | 0.06  |     | -0.01  |
| LLaMA-2-70B-chat    |     | 0.06  |     | +0.06  |
| Mistral-7B-Instruct |     | 0.08  |     | -0.01  |
25

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
A.14.ThePrototypicalDistributionasaProxyoftheNaturalisticBenchmark
Inthissubsection,weshowthat|V|and|E|equallycontributetothecomplexityofaplanningtask,withnocleardominance
ofoneovertheotherFigure14andthesimilarityofprototypicalandnaturalisticgraphsFigure15.
Figure14.Comparison of the cumulative number of vertices |V| and edges |E| per-complexity task for the prototypical (left) vs.
naturalisticdatasets.
Figure15.Comparisonofthegraphdistributionofprototypicalgraphsandthatofrandomgraphs.Inblueandred,acomparisonbetween
thenumberofnodes/edgesandflowsofprototypicalandnaturalisticgraphs.Ingreen,comparisonofnodes/edgesandflowsofprototypical
andrandomgraphs(baseline). Forlargercomplexities,prototypicalgraphsbecomesimilartoDAGintermsofthenumberofedges,
nodesandflows(i.e.,tasksthatcanbeexecutedsimultaneously).
A.15.AnalysingTimeUnitsDifferencesinComplexityLevels20+and18
Wedefinealistoftimeunits[’sec’,’min’,’h’,’day’,’week’,’month’,’year’]anddefinetimeunitdistanceperinstanceas
thedifferencebetweentheunitwiththehighestandlowestindex. Forinstance,ascriptwithstepstimedas5sec,and10
minrespectivelyisconsideredashavingadistanceof1,whileascriptwithstepstimedas15hand50hhasadistanceof0.
Wefindthattheaveragetimedistanceoverallscriptsat20+(0.339)isconsiderablylowerthantheaveragedistanceat
complexity18(0.801),whichpartiallyexplainswhytheaccuracyat20+hasajump.
A.16.ExperimentDetailsandHyperparameters
AllexperimentsareperformedfromDecember2023toMay2024.
26

Graph-enhancedLargeLanguageModelsinAsynchronousPlanReasoning
Fordatageneration,weuseAzureOpenAIAPIandsettemperature=1forbothGPT-35-turboandGPT-4. Independency
validation,wesamplepromptsbyseed0,1,and2.
Duringtheexperiment(i.e. inferencestage),weuseAzureOpenAIAPIandsettemperature=0forGPTmodelstoenable
asmuchreproducibilityaspossible. WeuseCohereAPItoquerytheCommandmodelandalsosettemperature=0. As
GPTmodelsandCommandfiltercontents,wequeryAPI3timestoseeifthecorrespondingmodeliswillingtoanswerthe
prompt.
We use Huggingface Inference API to query LLaMA-70B-Chat and set do sample=False, max new tokens=4096, and
seed=0. Weuse2V100GPUsand1A100GPUforMistral-7B-instructinference,withdo sample=False,temperature=0,
maxnewtokens=4096andtorchmanualseed=2024.
A.17.DatasetInformation
WeuseProScriptandWikiHowasourbasedatasetindatageneration. WefollowthelicensingguideofACLanddetermine
ProScripttobeunderCCBY4.0. WikiHowdatasetweuseisunderMITLicense. Wefollowthelicensesusedbythe
existingdatasetsforourdataset.
A.18.HumanValidation
WeconducthumanvalidationofWikiHowonavoluntarybasiswithfourexperts. Consentwasobtainedviadiscussionwith
them. Wedonotprovidepersonallyidentifiableinformationinthedataset.
A.19.StatementofContribution
FL wrote the paper, developed the initial idea, developed part of formalism, generated the AsyncHow dataset, ran all
experiments,andconductedallanalysesunlessspecifiedbelow. EMYhelpedinpolishingideas,rephrasingprompts,and
editingthepaper. ELMdevelopedpartofformalism,generatedasyntheticdataset,ransyntheticexperiments,andadvised
andeditedthepaper. AGCobtainedfunding,advised,andeditedthepaper. VHandJBPadvisedandeditedthepaper.
27
<!-- 出典: https://arxiv.org/pdf/2402.02805 | 取得日: 2026-07-15 | 取得方法: MarkItDown（PDF、bytes確認） | 確度: 中〜高（ICML 2024。非同期plan reasoning benchmarkでありcode変更の安全性は扱わない） -->
