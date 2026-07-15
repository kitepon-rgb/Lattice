DynTaskMAS: A Dynamic Task Graph-driven
Framework for Asynchronous and Parallel
LLM-based Multi-Agent Systems

Junwei Yu*
The University of Tokyo
Tokyo, Japan
yujw@satolab.itc.u-tokyo.ac.jp

Yepeng Ding*
Hiroshima University
Hiroshima, Japan
yepengd@acm.org

Hiroyuki Sato
National Institute of Informatics
Tokyo, Japan
schuko@nii.ac.jp

5
2
0
2

c
e
D
2

]

A
M

.
s
c
[

2
v
5
7
6
7
0
.
3
0
5
2
:
v
i
X
r
a

Abstract—The emergence of Large Language Models (LLMs)
in Multi-Agent Systems (MAS) has opened new possibilities
for artificial intelligence, yet current implementations face sig-
nificant challenges in resource management, task coordination,
and system efficiency. While existing frameworks demonstrate
the potential of LLM-based agents in collaborative problem-
solving, they often lack sophisticated mechanisms for parallel
execution and dynamic task management. This paper introduces
DynTaskMAS, a novel framework that orchestrates asynchronous
and parallel operations in LLM-based MAS through dynamic
task graphs. The framework features four key innovations: (1) a
Dynamic Task Graph Generator that intelligently decomposes
complex tasks while maintaining logical dependencies, (2) an
Asynchronous Parallel Execution Engine that optimizes resource
utilization through efficient task scheduling, (3) a Semantic-
Aware Context Management System that enables efficient in-
formation sharing among agents, and (4) an Adaptive Workflow
Manager that dynamically optimizes system performance. Ex-
perimental evaluations demonstrate that DynTaskMAS achieves
significant improvements over traditional approaches: a 21-33%
reduction in execution time across task complexities (with higher
gains for more complex tasks), a 35.4% improvement in resource
utilization (from 65% to 88%), and near-linear throughput scal-
ing up to 16 concurrent agents (3.47× improvement for 4× agents).
Our framework establishes a foundation for building scalable,
high-performance LLM-based multi-agent systems capable of
handling complex, dynamic tasks efficiently.

Index Terms—Large Language Model, Multi-Agent System,

Planning

I. INTRODUCTION

The rapid advancement of LLMs has revolutionized the
intelligence, demonstrating unprece-
landscape of artificial
dented capabilities in natural
language understanding and
generation [1]. These models have shown remarkable pro-
ficiency in tasks ranging from text completion to complex
reasoning, opening new avenues for intelligent system design.
Concurrently,
the concept of MAS has gained significant
traction, offering a distributed approach to problem-solving
that leverages the collective intelligence of multiple entities

*These authors contributed equally. This is the preprint version of the
conference paper ”DynTaskMAS: A Dynamic Task Graph-driven Framework
for Asynchronous and Parallel LLM-based Multi-Agent Systems” in Proc.
35th International Conference on Automated Planning and Scheduling.

[2]–[7]. The convergence of these two paradigms presents a
promising frontier in AI research, with the potential to address
increasingly complex and dynamic challenges across various
domains

LLM-driven multi-agent systems have exhibited substantial
potential in tackling intricate problems that require diverse ex-
pertise and collaborative reasoning. However, current research
in this field has predominantly focused on simplified architec-
tures with single topology structures and straightforward task
flows. While these approaches have yielded valuable insights,
they fall short in addressing the multifaceted demands of real-
world applications, where task complexity and environmental
dynamics can vary significantly.

As the complexity of tasks escalates,

traditional MAS
architectures face several critical challenges. Firstly, the task
decomposition process becomes increasingly intricate, requir-
ing more sophisticated mechanisms to break down complex
problems into manageable subtasks while maintaining logical
coherence. Secondly, the parallel processing capabilities of ex-
isting systems are often underutilized, leading to inefficiencies
in resource allocation and execution time. Thirdly, context
management across multiple agents becomes exponentially
more challenging as the number of interactions and the volume
of shared information grow.

To address these limitations, we propose DynTaskMAS,
a Dynamic Task Graph-driven Framework for Asynchronous
and Parallel LLM-based Multi-Agent Systems. By placing a
dynamic task graph, DynTaskMAS enables flexible task de-
composition and efficient parallel execution, effectively over-
coming the aforementioned challenges. The key contributions
of this work are as follows:

1) This work proposes a novel framework for dynamic
task orchestration in LLM-based MAS. The approach
introduces new principles for decomposing complex
language tasks while maintaining semantic coherence
and causal dependencies.

2) The research advances the understanding of parallel
execution patterns in LLM-based systems through new
abstractions for managing asynchronous agent interac-
tions. This theoretical foundation enables more efficient

Fig. 1. The Overview of DynTaskMAS Framework. The diagram depicts the architecture of the DynTaskMAS framework as a multi-layered structure
characterized by bidirectional information flow. At the top, the ”Input Task” node serves as the entry point for complex tasks. Below it, DTGG acts as a
core component, continuously analyzing and updating task graphs, with arrows connecting to the input task to signify this iterative process. The third layer
comprises two parallel modules: APEE and SACMS. Both are linked to DTGG above and AWM below, reflecting their interdependent functions. Positioned
in the fourth layer, AWM maintains bidirectional connections with all upper components, underscoring its role in managing and optimizing workflows. At
the base, multiple ”LLM-based Agent” nodes are connected to APEE and SACMS, illustrating the distributed execution of tasks and continuous exchange of
information.

resource utilization while preserving the complex rea-
soning capabilities inherent to language models.

3) A systematic approach to context management in multi-
agent LLM systems addresses the fundamental challenge
of maintaining semantic relevance across distributed
agents. The methodology introduces new ways to bal-
ance information sharing with computational efficiency,
establishing principles for scalable LLM-based architec-
tures.

4) Experimental results demonstrate substantial improve-
ments over traditional approaches: 21-33% reduction in
execution time, 35.4% increase in resource utilization,
and near-linear throughput scaling up to 16 concurrent
agents.

II. BACKGROUND

A. Planning with LLMs

Recent studies have explored the capacity of LLMs to
perform zero-shot planning, converting high-level natural lan-
guage tasks into actionable steps without additional training,
albeit with noted challenges in precision mapping to exe-
cutable actions [8]. Other research has focused on enhancing
LLMs’ reasoning capabilities through structured prompting
techniques, eliciting more deliberate and logical reasoning
processes [9]. The integration of LLMs with robotic affor-
dances has been demonstrated to enable complex instruction
following in real-world scenarios, showcasing the potential
for LLMs to ground language in physical interactions [10].
Further advancements have been made in few-shot grounded
planning, where LLMs are employed to generate plans for
embodied agents within visual environments. Interactive plan-
ning methods have been developed to facilitate open-world
multi-tasking, leveraging LLMs to describe, explain, plan, and
select actions [11]. Additionally, frameworks that empower

LLMs with optimal planning proficiency have been proposed,
aiming to solve planning problems articulated in natural lan-
guage [12]. Problem-solving and decision-making capabilities
of LLMs have been augmented through novel frameworks
designed to mimic human strategic planning [13]. Collectively,
these contributions underscore the evolving role of LLMs in
planning and reasoning, highlighting their potential to enhance
embodied agent performance across a spectrum of tasks.

Building upon these contributions, which have significantly
advanced the understanding of LLMs in planning and rea-
soning, there is a notable gap in research focusing on the
operational efficiency and practical considerations of resource
allocation, particularly in the context of real-time GPU re-
source management. While these studies have underscored
the evolving role of LLMs in enhancing embodied agent
performance,
they have largely overlooked the challenges
associated with the asynchronous and parallel execution of
tasks within multi-agent systems.

B. Multi-Agent System

In the field of multi-agent systems utilizing large language
models, several notable approaches have emerged. AutoGPT
demonstrates an autonomous system where agents collabo-
ratively achieve goals through iterative planning, execution,
and evaluation cycles [7]. Building on this concept, MetaGPT
emulates a startup team structure, employing role-specific
agents to tackle complex tasks like software development
and project planning [14]. Camel (Collaborative Agents for
Multi-agent Environment Learning) further enhances collab-
orative problem-solving by simulating scenarios that require
communication, knowledge sharing, and collective decision-
making among language models [6]. Stanford University’s
Generative Agents take a different approach, focusing on
simulating lifelike behavior in digital environments by creating

personas with memory systems and adaptive behaviors [5].
While these multi-agent systems showcase innovative ap-
proaches to collaboration and task execution, they have not yet
provided superior solutions for parallel and serial processing
challenges, indicating an area for potential future research and
development in the field.

III. DYNTASKMAS

DynTaskMAS is a novel framework designed to enhance the
efficiency and adaptability of LLM-based multi-agent systems
in handling complex, dynamic tasks. The architecture com-
prises four primary components that work in concert to achieve
flexible task management and optimized resource utilization:
Dynamic Task Graph Generator (DTGG): This component
analyzes incoming tasks and automatically constructs a di-
rected acyclic graph (DAG) representing subtasks and their
interdependencies. The DTGG continuously updates the graph
as new information becomes available or task requirements
change, ensuring adaptability to dynamic environments.
Asynchronous Parallel Execution Engine (APEE): The
APEE orchestrates the concurrent execution of subtasks across
multiple LLM-based agents. It employs sophisticated schedul-
ing algorithms to maximize parallelism while respecting task
dependencies defined in the dynamic task graph.
Semantic-Aware Context Management System (SACMS):
This subsystem facilitates efficient information sharing among
agents by maintaining a hierarchical, distributed context repos-
itory. The SACMS employs semantic analysis to determine
the relevance of information, ensuring agents have access to
pertinent data without unnecessary overhead.
Adaptive Workflow Manager (AWM): The AWM oversees
the overall execution process, dynamically adjusting work-
flows based on real-time performance metrics and environmen-
tal changes. It interfaces with all other components to optimize
system behavior and resource allocation.

In the illustrated Figure 1,

these components interact
through a central coordination mechanism that ensures coher-
ent system operation. The modular design of DynTaskMAS
allows for scalability and easy integration of additional agents
or task types, making it adaptable to various application
domains.

A. Dynamic Task Graph Generator

The Dynamic Task Graph Generator is a crucial component
of DynTaskMAS, responsible for decomposing complex tasks
into manageable subtasks and representing their dependencies
as a DAG. The DTGG continuously updates this graph based
on new information and changing task requirements [15].
Graph Structural Composition: Let T = t1, t2, ..., tn be the
set of all tasks in the system. The dynamic task graph G is
defined as:

G = (V, E, W )

(1)

where V = {v1, v2, . . . , vm} is the set of vertices representing
subtasks, E ⊆ V × V is the set of edges indicating dependen-
cies, and W : E → R+ is a weight function assigning positive
real values to the edges.

The DTGG employs a recursive decomposition algorithm
to break down complex tasks. For each task ti ∈ T , we define
a decomposition function D:

D(ti) = si1, si2, ..., sik

(2)

where sij are subtasks of ti. The decomposition continues
until a predefined granularity level is reached.

The weight of an edge (vi, vj) ∈ E is calculated based on
the estimated computational complexity and data dependency
between subtasks:

W (vi, vj) = α · C(vj) + β · I(vi, vj)

(3)

where C(vj) denotes the estimated computational complexity
of subtask vj, I(vi, vj) represents the context transfer time
managed by SACMS from vi to vj, and α, β are balancing
coefficients. For optimal parameter selection, we recommend:
, where Tc is the average computation time per

• α = 1
Tc

complexity unit

• β = 1
Tt

unit of information

, where Tt is the average context transfer time per

This normalization ensures that both computational complexity
and context transfer time contribute proportionally to the edge
weight, enabling more accurate task scheduling decisions.
The ratio α
β should be adjusted based on the system’s rela-
tive speeds of computation versus context transfer, typically
ranging from 0.5 to 2.0 depending on the specific hardware
configuration and network conditions.
Control of Cyclic Dependencies: To manage the complexity
of reflection cycles in the DTGG, it is essential to distinguish
between true cyclic dependencies and apparent cyclic struc-
tures. In LLM-based MAS, where each prompt functions as
an agent, genuine cyclic dependencies primarily manifest in
reflection processes, where an agent evaluates and refines its
output. Other apparent cycles, such as iterative refinement or
progressive enhancement, are essentially linear task sequences
with clear hierarchical dependencies.

To prevent infinite loops or excessive processing in reflec-
tion cycles, we implement a maximum iteration threshold N
(typically N ≤ 3). The reflection terminates when either:

• The quality assessment meets the predetermined thresh-

old

• The number of reflection cycles reaches N
• The improvement between successive iterations falls be-

low a minimum threshold ε

The DTGG continuously updates the task graph based on
new information and task progress. Let Gt be the graph at
time t, and ∆t be the set of changes at time t. The update
function U is defined as:

Gt+1 = U (Gt, ∆t)

(4)

The pseudocode of the main DTGG algorithm is provided in
Algorithm 1. DTGG Receives complex tasks and updates from
the system’s input layer. The DTGG’s output, a continuously
updated task graph, serves as the foundation for efficient task
distribution and execution in the DynTaskMAS framework. Its

Fig. 2. The architecture of Semantic-Aware Context Management System. The SACMS architecture comprises five core components: (1) the Context
Repository, a distributed, hierarchical data store designed for efficient storage and retrieval of contextual information; (2) the Semantic Analyzer, which employs
advanced natural language processing and domain-specific ontologies to extract meaningful semantic tags and relationships; (3) the Context Distribution
Manager, responsible for the efficient dissemination of relevant contextual information to agents based on task requirements and semantic relevance; (4)
the Query Processor, which utilizes semantic matching to process context retrieval requests and deliver the most pertinent information; and (5) the Update
Handler, which integrates new or updated context data into the repository while maintaining the semantic index. Together, these components enable intelligent,
context-aware task execution within the DynTaskMAS system.

Algorithm 1 Dynamic Task Graph Generator

for each ti in Tnew do

1: function UPDATETASKGRAPH(G, Tnew, ∆)
2:
3:
4:
5:
6:

Si ← DECOMPOSETASK(ti)
V ← V ∪ Si
for each sij, sik in Si where j < k do

E ← E ∪ (sij, sik)
W (sij, sik) ← CALCULATEWEIGHT(sij, sik)

7:

8:
9:

16:
17:

for each change δ in ∆ do

G ← APPLYCHANGE(G, δ)

return G

10:
11: function DECOMPOSETASK(t)
if ISATOMICTASK(t) then
12:
13:
14:
15:

return t

else

S ← ∅
for each subtask s of t do

S ← S ∪ DECOMPOSETASK(s)

return S

18:
19: function CALCULATEWEIGHT(vi, vj)
Cj ← ESTIMATECOMPLEXITY(vj)
20:
Iij ← ESTIMATEINFORMATIONTRANSFER(vi, vj)
return α · Cj + β · Iij

21:
22:

ability to dynamically adjust to changing conditions ensures
the system’s adaptability in complex, evolving environments.

B. Asynchronous Parallel Execution Engine

The Asynchronous Parallel Execution Engine is a criti-
cal component of DynTaskMAS, responsible for efficiently
scheduling and executing tasks across multiple LLM-based
agents. It leverages the dynamic task graph generated by the
DTGG to maximize parallelism while respecting task depen-
dencies. The APEE consists of the following sub-components:
Task Scheduler, Execution Queue Manager, Agent Pool Man-
ager, Load Balancer and Asynchronous Communication Han-
dler.

Task Scheduler: The Task Scheduler is responsible for de-
termining the execution order of tasks based on the dynamic
task graph. It employs a priority-based scheduling algorithm
that considers task dependencies, estimated execution time,
and system load. Let G = (V, E, W ) be the current task graph.
For each task vi ∈ V , we define its priority P (vi) as:

P (vi) =

C(vi)
maxvj ∈Succ(vi)(W (vi, vj) + P (vj))

(5)

where C(vi) is the estimated computational complexity of task
vi, Succ(vi) is the set of immediate successors of vi in the
graph, and W (vi, vj) is the weight of the edge (vi, vj).
Execution Queue Manager: The Execution Queue Manager
maintains a priority queue of ready-to-execute tasks. It contin-
uously updates the queue based on the Task Scheduler’s output
and the current system state.

Algorithm 2 Execution Queue Manager

R ← v ∈ V : Pred(v) = ∅
for each v ∈ R do

1: function UPDATEEXECUTIONQUEUE(G, Q)
2:
3:
4:
5:

priority ← CALCULATEPRIORITY(v, G)
Q.ENQUEUE(v, priority)

▷ Ready tasks

return Q

6:
7: function CALCULATEPRIORITY(v, G)
8:
9:
10:
11:

if Succ(v) = ∅ then
return C(v)

return

else

C(v)
maxu∈Succ(v)(W (v,u)+CALCULATEPRIORITY(u,G))

Agent Pool Manager and Load Balancer: The Agent Pool
Manager and Load Balancer work together to efficiently
manage and distribute tasks among LLM-based agents. The
Agent Pool Manager oversees the pool of available agents,
tracking their status, capabilities, and workload. It provides
the necessary interface for the Load Balancer, which ensures
optimal task distribution based on task priorities, agent capa-
bilities, and current system load. Together, they coordinate to

allocate tasks to the most suitable agents, maintaining efficient
system performance.
Asynchronous Communication Handler: The Asynchronous
Communication Handler manages the non-blocking communi-
cation between the APEE and the LLM-based agents. It uses
an event-driven architecture (task completion notifications,
agent availability updates, and task failure reports) to handle
task assignments, status updates, and result collections to
ensure high throughput and responsiveness.

By leveraging the dynamic task graph and employing
sophisticated scheduling and load balancing algorithms, the
APEE enables DynTaskMAS to achieve high levels of par-
allelism and efficiency in executing complex, interdependent
tasks across multiple LLM-based agents.

C. Semantic-Aware Context Management System

The SACMS is a pivotal component of DynTaskMAS,
designed to efficiently manage and distribute contextual in-
formation among LLM-based agents. Figure 2 depicts the ar-
chitecture and key algorithms of SACMS, highlighting its role
in enabling intelligent and context-aware task execution. By
leveraging advanced semantic analysis techniques, distributed
architecture, and adaptive mechanisms, SACMS enables LLM-
information
based agents to access and utilize contextual
effectively, thereby enhancing the overall performance and
adaptability of the system.
Context Repository: The Context Repository serves as the
central data store for contextual information. It is implemented
as a distributed, hierarchical structure to facilitate efficient
storage and retrieval of context data.

The repository is organized as a forest of trees, where each
tree represents a distinct context domain. This structure allows
for natural representation of hierarchical relationships within
contexts.

ContextForest = T1, T2, ..., Tn

where each Ti is a context tree defined as:

Ti = (Vi, Ei, ri)

(6)

(7)

with Vi being the set of nodes, Ei the set of edges, and ri the
root node of the tree.

Each node in the context tree is defined as follows:

ContextNode = (id, data, children, semanticT ags)

(8)

where id is a unique identifier, data contains the actual
context information, children is a set of child nodes, and
semanticT ags is a set of semantic labels associated with the
node.
Semantic Analyzer: The Semantic Analyzer is responsible
for processing contextual information to extract meaningful
semantic tags and relationships. It employs specialized LLMs
and domain-specific ontologies to achieve this.

The semantic analysis process can be formalized as follows:

Algorithm 3 Context Distribution

1: function DISTRIBUTECONTEXT(update, agents)
2:

R ← ∅
tags ← EXTRACTSEMANTICTAGS(update)
for agent ∈ agents do

▷ Relevant agents set

agentT ags ← GETTAGS(agent)
if RELEVANCE(tags, agentT ags) > θ then

R ← R ∪ {agent}

for agent ∈ R do

SENDUPDATE(agent, update)

3:
4:
5:
6:
7:

8:
9:

where D is the input context data, T is the set of extracted
tags, E is the set of identified entities, and R is the set of
relationships between entities.

The analyzer constructs a semantic graph Gs = (Vs, Es)

where:

Vs = T ∪ E

Es = (ei, ej, r)|ei, ej ∈ E, r ∈ R

(10)

(11)

This graph representation enables efficient semantic querying
and reasoning over the context data.
Context Distribution Manager: The Context Distribution
Manager ensures that relevant contextual information is ef-
ficiently disseminated to the appropriate agents based on their
current tasks and semantic relevance.

The relevance of a context update to an agent is computed

using a semantic similarity measure:

Relevance(u, a) =

|ST (u) ∩ ST (a)|
|ST (u) ∪ ST (a)|

(12)

where ST (u) and ST (a) are the sets of semantic tags as-
sociated with the update and the agent’s current context,
respectively.

The distribution process follows Algorithm 9.

Query Processor The Query Processor handles context re-
trieval requests from agents, utilizing semantic matching to
return the most relevant information.

Given a query q, we extract its semantic representation:

Sq = AnalyzeQuery(q)

(13)

This transformation ensures consistent interpretation of queries
across the distributed system while preserving their semantic
intent.

Relevance Assessment employs cosine similarity between
vectorized semantics. The relevance of a context node n to a
query q is computed as:

Relevance(n, q) = cos(V (Sn), V (Sq))

(14)

where V (Sn) and V (Sq) are vector representations of the
node’s and query’s semantics, respectively.

The final set of results R is obtained by applying an access

control filter:

R = {n ∈ N |Relevance(n, q) > θ ∧

SA : D → (T, E, R)

(9)

AccessLevel(n) ≤ AccessLevel(agent)}

(15)

where θ is a relevance threshold and N is the set of all context
nodes. Controlled Filtering applies a dual-constraint mech-
anism that ensures both relevance optimization and security
compliance in result generation.
Update Handler: Then, the Update Handler manages the
process of integrating new or updated context information into
the repository, which uses a two-phase commit protocol to
maintain context consistency.

Integration Phase performs atomic updates while preserving
semantic relationships. The update process for a node n with
new data d is defined as:

n′ = (idn, Merge(datan, d), childrenn,

semanticT agsn ∪ ExtractTags(d))

(16)

After each update, the semantic index is updated to reflect

the new information:

I ′ = UpdateIndex(I, n′)

(17)

where I is the current semantic index and I ′ is the updated
index. Index Synchronization ensures query consistency post-
update. This operation maintains the system’s ACID properties
while minimizing query latency.

The Semantic-Aware Context Management System provides
a robust and efficient solution for context management in
DynTaskMAS. By leveraging semantic analysis capabilities
from LLMs, SACMS enables LLM-based agents to access and
utilize contextual information effectively, thereby enhancing
the overall performance and adaptability of the system.

D. Adaptive Workflow Manager (AWM)

The Adaptive Workflow Manager is a crucial component
of DynTaskMAS, responsible for dynamically adjusting work-
flows based on real-time performance metrics and environmen-
tal changes. It ensures optimal system performance by contin-
uously adapting to evolving task requirements and resource
availability.

The Performance Monitor implements continuous system-
wide metric tracking through M (t), encompassing critical
operational parameters including throughput, latency, agent
utilization rates, and task completion metrics. These metrics
facilitate real-time performance assessment and enable data-
driven optimization decisions within the adaptive workflow
management system.

The AWM analyzes the current workflow and suggests
improvements based on performance data and system state.
The optimization objective can be formally stated as follows:

min
ω∈Ω

f (ω, M (t))

(18)

where ω is a workflow configuration, Ω is the set of all possible
configurations, and f is an objective function that evaluates
workflow performance based on metrics M (t).

The workflow optimization algorithm employs an iter-
ative approach to identify the optimal workflow config-
uration based on current performance metrics. The algo-
rithm generates potential workflow candidates through the

GenerateCandidates function, which produces variations of
the current workflow adhering to system constraints. Each
candidate undergoes evaluation using an objective function f
that considers current system metrics M (t). The algorithm
maintains and updates the best-performing workflow config-
uration through successive comparisons, ultimately returning
the configuration that minimizes the objective function.

Algorithm 4 Workflow Optimization

1: function

OPTIMIZEWORK-

FLOW(currentW orkf low, M (t))

candidateW orkf lows

GENERATECANDIDATES(currentW orkf low)
bestW orkf low ← currentW orkf low
bestScore ← f (currentW orkf low, M (t))
for candidate ∈ candidateW orkf lows do

←

score ← f (candidate, M (t))
if score < bestScore then

bestW orkf low ← candidate
bestScore ← score

2:

3:
4:
5:

6:
7:
8:
9:

10:

return bestW orkf low

The resource allocation mechanism integrates seamlessly
with the workflow optimization through a greedy allocation
strategy that prioritizes immediate system efficiency. Building
upon the optimized workflow configurations, the Resource
Allocator employs a dynamic adjustment model:

R(t + 1) = R(t) + ∆R(t)

(19)

where R(t) is the resource allocation at time t, and ∆R(t)
is the adjustment made based on current performance and
predicted future demands.

The allocation strategy aims to balance load across agents

while prioritizing critical tasks:

Allocation(ai, t) =

· TotalResources(t)

wi · Load(ai, t)
j wj · Load(aj, t)

(cid:80)

(20)
where wi is the priority weight of agent ai, and Load(ai, t)
is the current load on agent ai. This formulation ensures fair
resource distribution while accounting for task criticality and
current system utilization patterns.

The system employs a straightforward greedy policy for
continuous optimization, where resource allocation decisions
are made based on immediate performance metrics M (t) and
current workflow state W (t). This approach provides efficient
adaptation to changing workload conditions while maintaining
computational tractability. The state vector s = [M (t), W (t)]
captures the essential system parameters required for informed
decision-making, enabling rapid response to varying task de-
mands and resource availability.

This streamlined approach to resource management comple-
ments the workflow optimization process, creating a cohesive
system that efficiently handles dynamic task allocation and
resource distribution in the multi-agent environment.

Fig. 3. The comparison between traditional processing and DynTaskMAS framework. The system was deployed on an NVIDIA RTX 3090 GPU with
Llama-3.1-8B serving as the foundation model for all agents. Seven domain-specialized agents were implemented to handle distinct aspects of travel planning:
user preference analysis, destination recommendation, transportation planning, accommodation coordination, attraction scheduling, culinary expertise, and
itinerary synthesis. The experimental results showed that DynTaskMAS (3.7s) achieved faster execution compared to serial execution (4.7s).

The AWM maintains seamless integration with other Dyn-
TaskMAS components, receiving task graph updates, commu-
nicating with the execution engine, and leveraging contextual
information to make informed adaptations. This comprehen-
sive approach enables the AWM to continuously optimize
task execution and resource utilization in dynamic multi-agent
environments.

This integrated architecture enables DynTaskMAS to ef-
ficiently handle complex, dynamic tasks while adapting to
changing conditions and maintaining context awareness. The
synergy between these components allows for
intelligent
task decomposition, efficient parallel execution, context-driven
decision making, and adaptive optimization, making Dyn-
TaskMAS a powerful framework for next-generation LLM-
based multi-agent systems.

IV. EXPERIMENTAL RESULTS

We conducted comprehensive evaluations of DynTaskMAS
using TensorRT-LLM [16] deployed on NVIDIA RTX 3090
GPUs. All experiments utilized Llama-3.1-8B [17] as the
foundation model for all agents.

A. Experimental Setup

The experiments were conducted on a cluster equipped with
four NVIDIA RTX 3090 GPUs (24GB VRAM each), AMD
EPYC 7763 64-Core Processor, and 512GB DDR4 memory.
The software stack included Ubuntu 22.04 LTS, CUDA 12.1,
and TensorRT-LLM 0.7.1. For all experiments, we employed
INT8 quantization with a batch size of 32 and sequence length
of 2048.

B. Performance Evaluation

Execution Time Analysis: To conduct a more in-depth anal-
ysis, we evaluated the system’s performance across three task
complexity levels. Table I presents the comparative analysis
between traditional processing and DynTaskMAS.

Table I demonstrates the performance advantages of Dyn-
TaskMAS across different task complexity levels. For simple
tasks (5-10 subtasks), DynTaskMAS achieves a 21.3% re-
duction in execution time compared to traditional processing,
decreasing from 4.7s to 3.7s. This improvement becomes more
pronounced as task complexity increases, reaching 27.6% for

TABLE I
EXECUTION TIME ANALYSIS ACROSS TASK COMPLEXITIES

Task Complexity

Traditional (s)

DynTaskMAS (s)

Improvement (%)

Simple
Medium
Complex

4.7 ± 0.3
9.8 ± 0.5
18.5 ± 0.8

3.7 ± 0.2
7.1 ± 0.3
12.4 ± 0.5

21.3
27.6
33.0

TABLE II
SYSTEM SCALABILITY WITH INCREASING AGENT COUNT

Number of Agents

Throughput (tasks/s)

Latency (ms)

4
8
16
32

12.3 ± 0.4
23.1 ± 0.6
42.7 ± 0.9
76.4 ± 1.2

81.3 ± 3.2
86.5 ± 3.8
93.8 ± 4.1
104.2 ± 5.3

medium complexity tasks (20-30 subtasks) and 33.0% for
complex tasks (50+ subtasks).

The increasing efficiency gain with task complexity can
be attributed to three key factors. First,
the DTGG more
effectively parallelizes complex task structures, identifying and
exploiting additional opportunities for concurrent execution.
Second,
transfers,
the SACMS reduces redundant context
which become more significant in complex task scenarios.
Third, the APEE maintains higher GPU utilization through
intelligent task scheduling, particularly beneficial when man-
aging numerous interdependent subtasks.

The standard deviations (±0.2-0.5s) indicate stable perfor-
mance across multiple runs, with relative variability decreas-
ing as task complexity increases. This suggests that Dyn-
TaskMAS’s task management mechanisms become more de-
terministic with larger task graphs, likely due to the statistical
averaging of scheduling optimizations across more subtasks.
Scalability Analysis: The scalability of DynTaskMAS was
evaluated by varying the number of concurrent agents. Table II
presents the throughput and latency measurements.

The scalability results presented in Table II reveal several
important characteristics of DynTaskMAS’s performance un-
der varying agent loads. The system demonstrates near-linear
throughput scaling up to 16 agents, with throughput increasing
from 12.3 tasks/s with 4 agents to 42.7 tasks/s with 16 agents

TABLE III
TRAVEL PLANNING SYSTEM PERFORMANCE METRICS

Metric

Traditional

DynTaskMAS

End-to-End Time (s)
Agent Coordination (ms)
Context Switches
Resource Utilization (%)

4.7 ± 0.3
850 ± 45
42 ± 3
65 ± 5

3.7 ± 0.2
320 ± 25
18 ± 2
88 ± 3

(3.47× improvement for a 4× increase in agents). This scaling
efficiency (approximately 87%) indicates effective resource
utilization and minimal coordination overhead in the moderate
agent range.

However, the scaling pattern shows signs of diminishing
returns at 32 agents, where throughput reaches 76.4 tasks/s
(6.21× improvement for an 8× increase in agents). This sub-
linear scaling can be attributed to two primary factors. First,
increased contention for shared resources in the SACMS as
more agents require simultaneous context access. Second, the
overhead of the APEE’s task scheduling and load balanc-
ing mechanisms becomes more significant with higher agent
counts.

C. Case Study

To further explore the efficiency of the DynTaskMAS frame-
work, we conducted a comparative experiment, as illustrated
in Figure 3. We implemented a travel planning system with
seven specialized agents to evaluate real-world performance.
Each agent focused on a distinct task within the travel planning
process, such as analyzing user preferences, recommending
destinations, planning transportation, and coordinating accom-
modations.

Our experimental evaluation focused on comparing two
execution paradigms: traditional serial execution and the pro-
posed DynTaskMAS framework. The implementation lever-
aged INT8 quantization and continuous batching techniques,
to maximize throughput
with parameters empirically set
while maintaining inference quality (batch size=32, sequence
length=2048).

Table III presents the comparative analysis. The results
demonstrate that DynTaskMAS achieved a 21% reduction in
overall execution time compared to serial processing, decreas-
ing from 4.7s to 3.7s. This improvement can be attributed to
three key factors: efficient parallel execution of independent
tasks, optimized memory utilization through dynamic manage-
ment, and streamlined context sharing between agents. GPU
utilization metrics showed a 35% increase under the Dyn-
TaskMAS framework, indicating more effective resource allo-
cation. The experimental results demonstrate DynTaskMAS’s
effectiveness in managing complex, dynamic tasks while sug-
gesting areas for future optimization.

These findings suggest that our proposed framework signif-
icantly enhances the performance of LLM-based multi-agent
systems through intelligent task orchestration and resource
management, while maintaining the quality of agent interac-
tions and outputs.

V. CONCLUSION

This paper presents DynTaskMAS, a dynamic task graph-
driven framework that addresses key architectural challenges
in LLM-based multi-agent systems through intelligent re-
source orchestration and parallel execution. The framework’s
innovative architecture, integrating Dynamic Task Graph Gen-
eration with Asynchronous Parallel Execution, enables effi-
cient distribution of computational resources across multi-
ple agents while maintaining task coherence. Through the
Semantic-Aware Context Management System and Adaptive
Workflow Manager, DynTaskMAS achieves optimal resource
utilization by minimizing computational redundancy and max-
imizing parallel processing opportunities. Our experimen-
tal results demonstrate the framework’s effectiveness across
multiple dimensions: execution time improvements ranging
from 21.3% for simple tasks to 33.0% for complex tasks, a
35.4% increase in resource utilization (from 65% to 88%),
and efficient scaling with throughput improvements of 3.47×
for 16 concurrent agents. The successful implementation of
DynTaskMAS establishes a systematic approach for building
scalable, high-performance LLM-based multi-agent systems
that effectively balance resource optimization with task co-
ordination.

REFERENCES

[1] T. B. Brown, “Language models are few-shot learners,” arXiv preprint

arXiv:2005.14165, 2020.

[2] X. Liu, H. Yu, H. Zhang, Y. Xu, X. Lei, H. Lai, Y. Gu, H. Ding,
K. Men, K. Yang, S. Zhang, X. Deng, A. Zeng, Z. Du, C. Zhang,
S. Shen, T. Zhang, Y. Su, H. Sun, M. Huang, Y. Dong, and J. Tang,
“Agentbench: Evaluating llms as agents,” 2023. [Online]. Available:
https://arxiv.org/abs/2308.03688

[3] O. Khattab, A. Singhvi, P. Maheshwari, Z. Zhang, K. Santhanam,
S. Vardhamanan, S. Haq, A. Sharma, T. T. Joshi, H. Moazam, H. Miller,
M. Zaharia, and C. Potts, “Dspy: Compiling declarative language model
calls into self-improving pipelines,” arXiv preprint arXiv:2310.03714,
2023.

[4] D. Gao, Z. Li, X. Pan, W. Kuang, Z. Ma, B. Qian, F. Wei, W. Zhang,
Y. Xie, D. Chen, L. Yao, H. Peng, Z. Y. Zhang, L. Zhu, C. Cheng,
H. Shi, Y. Li, B. Ding, and J. Zhou, “Agentscope: A flexible yet robust
multi-agent platform,” CoRR, vol. abs/2402.14034, 2024.

[5] J. S. Park, J. O’Brien, C. J. Cai, M. R. Morris, P. Liang, and M. S.
Bernstein, “Generative agents: Interactive simulacra of human behavior,”
in Proceedings of the 36th annual acm symposium on user interface
software and technology, 2023, pp. 1–22.

[6] G. Li, H. Hammoud, H. Itani, D. Khizbullin, and B. Ghanem, “Camel:
Communicative agents for” mind” exploration of large language model
society,” Advances in Neural Information Processing Systems, vol. 36,
pp. 51 991–52 008, 2023.

[7] H. Yang, S. Yue, and Y. He, “Auto-gpt for online decision making:
Benchmarks and additional opinions,” arXiv preprint arXiv:2306.02224,
2023.

[8] W. Huang, P. Abbeel, D. Pathak, and I. Mordatch, “Language models
as zero-shot planners: Extracting actionable knowledge for embodied
agents,” in International conference on machine learning. PMLR, 2022,
pp. 9118–9147.

[9] O. Fagbohun, R. M. Harrison, and A. Dereventsov, “An empirical
categorization of prompting techniques for large language models: A
practitioner’s guide,” arXiv preprint arXiv:2402.14837, 2024.

[10] M. Li, S. Zhao, Q. Wang, K. Wang, Y. Zhou, S. Srivastava, C. Gok-
men, T. Lee, L. E. Li, R. Zhang et al., “Embodied agent interface:
Benchmarking llms for embodied decision making,” arXiv preprint
arXiv:2410.07166, 2024.

[11] S. Rasal and E. Hauer, “Navigating complexity: Orchestrated problem
solving with multi-agent llms,” arXiv preprint arXiv:2402.16713, 2024.

[12] S. Xiong, A. Payani, Y. Yang, and F. Fekri, “Deliberate reasoning for
llms as structure-aware planning with accurate world model,” arXiv
preprint arXiv:2410.03136, 2024.

[13] S. Yao, D. Yu, J. Zhao,

I. Shafran, T. Griffiths, Y. Cao, and
K. Narasimhan, “Tree of thoughts: Deliberate problem solving with large
language models,” Advances in Neural Information Processing Systems,
vol. 36, 2024.

[14] S. Hong, M. Zhuge, J. Chen, X. Zheng, Y. Cheng, C. Zhang,
J. Wang, Z. Wang, S. K. S. Yau, Z. Lin, L. Zhou, C. Ran,
L. Xiao, C. Wu, and J. Schmidhuber, “Metagpt: Meta programming
for a multi-agent collaborative framework,” 2023. [Online]. Available:
https://arxiv.org/abs/2308.00352

[15] Y.-K. Kwok and I. Ahmad, “Benchmarking and comparison of the
task graph scheduling algorithms,” Journal of Parallel and Distributed
Computing, vol. 59, no. 3, pp. 381–422, 1999.

[16] NVIDIA Corporation, “TensorRT-LLM: NVIDIA TensorRT for Large
Language Models,” https://github.com/NVIDIA/TensorRT-LLM, 2024,
accessed: 2024-11-02.

[17] D. Patterson, J. Gonzalez, U. H¨olzle, Q. Le, C. Liang, L.-M. Munguia,
D. Rothchild, D. R. So, M. Texier, and J. Dean, “The carbon footprint of
machine learning training will plateau, then shrink,” Computer, vol. 55,
no. 7, pp. 18–28, 2022.

<!-- 出典: https://arxiv.org/pdf/2503.07675 | 取得日: 2026-07-15 | 取得方法: MarkItDown（PDF、bytes確認） | 確度: 中（2025年preprint。著者benchmarkの速度・利用率値は独立再現未確認） -->

