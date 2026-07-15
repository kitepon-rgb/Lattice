<!-- 出典: https://patents.google.com/patent/US9009652B2/en | 取得日: 2026-07-15 | 取得方法: MarkItDown（公開特許HTML、bytes確認） | 確度: 中〜高（登録特許本文。status表示は法的結論ではない） -->

# US9009652B2 - Method and system for handling software design conflicts - Google Patents

Method and system for handling software design conflicts

[Download PDF](https://patentimages.storage.googleapis.com/c8/11/ed/12b6573155a89d/US9009652.pdf)

## Info

Publication number
:   US9009652B2

US9009652B2
US12/913,913
US91391310A
US9009652B2
US 9009652 B2
US9009652 B2
US 9009652B2

US 91391310 A
US91391310 A
US 91391310A
US 9009652 B2
US9009652 B2
US 9009652B2

Authority
:   US
:   United States

Prior art keywords
:   design
:   artifacts
:   isomorphic
:   artifact
:   node

Prior art date
:   2009-10-30

Legal status (The legal status is an assumption and is not a legal conclusion. Google has not performed a legal analysis and makes no representation as to the accuracy of the status listed.)
:   Expired - Fee Related, expires 2032-06-22

Application number
:   US12/913,913

Other versions
:   [US20110107303A1
    (en](/patent/US20110107303A1/en)

Inventor
:   Ying Huang
:   Ying Liu
:   Wei Zhao
:   Xin Zhou
:   Jun Zhu

Current Assignee (The listed assignees may be inaccurate. Google has not performed a legal analysis and makes no representation or warranty as to the accuracy of the list.)
:   International Business Machines Corp

Original Assignee
:   International Business Machines Corp

Priority date (The priority date is an assumption and is not a legal conclusion. Google has not performed a legal analysis and makes no representation as to the accuracy of the date listed.)
:   2009-10-30

Filing date
:   2010-10-28

Publication date
:   2015-04-14
:   2010-10-28
    Application filed by International Business Machines Corp
    filed
    Critical
    International Business Machines Corp
:   2010-11-16
    Assigned to INTERNATIONAL BUSINESS MACHINES CORPORATION
    reassignment
    INTERNATIONAL BUSINESS MACHINES CORPORATION
    ASSIGNMENT OF ASSIGNORS INTEREST (SEE DOCUMENT FOR DETAILS).
    Assignors: HUANG, YING, LIU, YING, ZHAO, WEI, ZHOU, XIN, ZHU, JUN
:   2011-05-05
    Publication of US20110107303A1
    publication
    Critical
    patent/US20110107303A1/en
:   2015-04-14
    Application granted
    granted
    Critical
:   2015-04-14
    Publication of US9009652B2
    publication
    Critical
    patent/US9009652B2/en
:   Status
    Expired - Fee Related
    legal-status
    Critical
    Current
:   2032-06-22
    Adjusted expiration
    legal-status
    Critical

## Links

* [USPTO](https://patft.uspto.gov/netacgi/nph-Parser?Sect1=PTO1&Sect2=HITOFF&p=1&u=/netahtml/PTO/srchnum.html&r=1&f=G&l=50&d=PALL&s1=9009652.PN.)
* [USPTO PatentCenter](https://patentcenter.uspto.gov/applications/12913913)
* [USPTO Assignment](https://assignment.uspto.gov/patent/index.html#/patent/search/resultFilter?searchInput=9009652)
* [Espacenet](https://worldwide.espacenet.com/publicationDetails/biblio?CC=US&NR=9009652B2&KC=B2&FT=D)
* [Global Dossier](https://globaldossier.uspto.gov/result/application/US/12913913/1)
* [Discuss](https://patents.stackexchange.com/questions/tagged/US9009652)

## Images

* ![](https://patentimages.storage.googleapis.com/89/d5/d2/da5bab22374163/US09009652-20150414-D00000.png)
* ![](https://patentimages.storage.googleapis.com/e8/7b/00/206a5f9d830ffe/US09009652-20150414-D00001.png)
* ![](https://patentimages.storage.googleapis.com/65/d3/d3/4e70767c105b22/US09009652-20150414-D00002.png)
* ![](https://patentimages.storage.googleapis.com/c9/df/2c/2b7c3d00981662/US09009652-20150414-D00003.png)
* ![](https://patentimages.storage.googleapis.com/bc/0a/58/1da54345917d2c/US09009652-20150414-D00004.png)
* ![](https://patentimages.storage.googleapis.com/a6/81/91/54699bab6e7497/US09009652-20150414-D00005.png)
* ![](https://patentimages.storage.googleapis.com/1f/76/78/28cf8db95c6fa9/US09009652-20150414-D00006.png)
* ![](https://patentimages.storage.googleapis.com/ce/14/21/3c5661d5a1a9bc/US09009652-20150414-D00007.png)
* ![](https://patentimages.storage.googleapis.com/e7/3f/46/96621cf8a60e90/US09009652-20150414-D00008.png)
* ![](https://patentimages.storage.googleapis.com/22/0f/97/539039dc1d94dd/US09009652-20150414-D00009.png)
* ![](https://patentimages.storage.googleapis.com/ae/5b/a6/0097da59139161/US09009652-20150414-D00010.png)
* ![](https://patentimages.storage.googleapis.com/12/89/1a/1e00a9c879a770/US09009652-20150414-D00011.png)

## Classifications

* + G—PHYSICS
  + G06—COMPUTING OR CALCULATING; COUNTING
  + G06F—ELECTRIC DIGITAL DATA PROCESSING
  + G06F8/00—Arrangements for software engineering
  + G06F8/70—Software maintenance or management
  + G06F8/71—Version control; Configuration management

## Definitions

* the present invention
  relates to software design, and in particular, to identification and resolution of conflicts between design results in a parallel software design.
* a software development process
  may be typically divided into three major stages: requirement analysis, software design, and software implementation.
* software design stage
  software design is carried out in accordance with certain standards based on a requirement specification provided by the requirement analysis stage, and the design result is the blueprint for a programming engineer in the software implementation stage.
* parallel design
  also called distributed design or collaborative design
* different design tasks
  are first formed according to different function decomposition or other aspects (architecture layer, use case, etc) of the software in design. Then different design tasks may be allocated to different designers. Finally, a complete software design is generated by composing design results provided by different designers.
* a common computing resource
  may be used by design artifacts of two different designers' designs (for example, a common database or data table is accessed, or a common function is called), but the design to the common resources are inconsistent or conflict.
* conflicts
  should be eliminated or mitigated in order to facilitate improving programming efficiency during the programming stage, reducing potential errors occurring in software execution, and maintaining the software.
* it
  is first necessary to identify conflicts between design results by different designers.
* the complexity of design results
  makes it very difficult to manually identify a conflict between different design results, especially in a large software design project involving thousands of design artifacts.
* the present invention
  provides a method for handling software design conflicts, including: a receiving step of receiving a design diagram of a software design, wherein the design diagram includes a plurality of nodes and arrows connecting the nodes, wherein each node indicates a design artifact, and each arrow pointing from one node to another node indicates that the design artifact corresponding to the one node depends on the design artifact corresponding to the other node; an identifying step of determining a level of the design artifact in the design diagram, identifying different design artifacts at a given level of the design diagram that depend on a common design artifact, and marking them as isomorphic design artifacts; and an outputting step of outputting a new design diagram with the isomorphic design artifacts marked.
* the present invention
  provides a system for handling software design conflicts, including: a receiving unit, for receiving a design diagram of a software design, wherein the design diagram includes a plurality of nodes and arrows connecting the nodes, with each node indicating a design artifact, and an arrow pointing from one node to another node indicating that the design artifact corresponding to the one node depends on the design artifact corresponding to the other node; an identifying unit, for determining a level of a design artifact in the design diagram, identifying different design artifacts at a given level of the design diagram that depend on a common design artifact, and marking them as isomorphic design artifacts; and an outputting unit, for outputting a new design diagram with the isomorphic design artifacts marked.
* the present invention
  provides a method for handling software design conflicts, including: a receiving step of receiving at least two sub-design diagrams of a software design, wherein the sub-design diagrams are merged to form a composed design diagram, wherein the composed design diagram includes a plurality of nodes and arrows connecting the nodes, wherein each node indicates a design artifact, and the arrow pointing from one node to another node indicates that the design artifact corresponding to the one node depends on the design artifact corresponding to the other node, an identifying step of determining a level of the design artifact in the composed design diagram, identifying different design artifacts at a given level of the composed design diagram that depend on a common design artifact according to a software architectural hierarchy, and marking them as isomorphic design artifacts, an outputting step of outputting a new design diagram with the isomorphic design artifacts marked, a determining step of determining whether the marked isomorphic design artifacts
* FIG. 1
  shows the architecture of a software design system according to an embodiment of the present invention
* FIGS. 2A-2C
  schematically show sub-design diagrams of an example software design
* FIG. 3A
  schematically shows a composed design diagram including the sub-design diagrams as shown in FIGS. 2A-2C ;
* FIGS. 3B-3F
  schematically show a process of identifying and resolving a conflict between software designs
* FIG. 4
  schematically shows a flow chart of a method according to an embodiment of the present invention.
* a basic idea for identifying a conflict between parallel designs
  is as follows: For a given level in a hierarchical structure, analysis is performed to check whether different design artifacts depend on a common lower-level design artifact; if so, there may be a conflict; otherwise, there would be no conflict. According to the present invention, a conflict between parallel designs may be identified and resolved in a bottom-up approach.
* FIG. 1
  shows architecture of a software design system 10 according to an embodiment of the present invention.
* the software design system 10 as shown in FIG. 1
  includes a design task allocating unit 1010 , a design collecting and analyzing unit 1020 , and a design conflict resolving unit 1030 .
* the design task allocating unit 1010
  may allocate design tasks to different designers. When the system is executed, the design task allocating unit 1010 allocates tasks to designers based on a requirement specification obtained from the requirement analysis stage of software development, and stores the design tasks and corresponding designers in a database. As shown in FIG. 1 , the requirement specification used as input to the design task allocating unit 1010 can, for example, include use cases (or functions), a data table (database), some user interface design mockup, a naming rule (not shown), etc. A Use case is taken as the decomposition criteria for the software design units in this sample; in other words, each design unit is required to implement one use case. Typically, in a parallel software design, design tasks are firstly allocated to designers based on use cases. Design results by the designers will be collected and composed into a complete design.
* the design task allocating unit 1010
  decomposes design tasks based on use cases, and allocates the decomposed tasks to individual designers. Note that the allocation of design tasks may be carried out manually.
* Design standards
  include, but are not limited to, hierarchical structure specification, naming specification, and design depth, and shall comply with certain rules—design artifacts at a data access level shall be connected to a relevant database or data table and descriptions of design artifacts of use cases and their internal relationship, etc.
* the design collecting and analyzing unit 1020
  may collect design results and perform conflict analysis on these design results.
* conflict
  is used to indicate a kind of relationship between design artifacts.
* a conflict between two design artifacts
  means that both of the two design artifacts depend on another common design artifact, for example, both calling another common design artifact, or both accessing another common data source, such as a database. Details of conflict analysis will be further explained with reference to the examples below.
* the design conflict resolving unit 1030
  may resolve conflicts between designs according to the analysis results of the design collecting and analyzing unit, and obtain a new design result based on the conflict resolution.
* the new design result
  may be outputted to the design collecting and analyzing unit 1020 for further analyzing, or may be provided to the software programming stage as a basis for programming.
* Use case 1
  has the following functions:
* the design task allocating unit 1010
  allocates the design task of use case 1 to a designer 1 as task 1 , the design task of use cases 3 and 4 to a designer 2 as task 2 , and the design task of use case 2 to a designer 3 as task 3 .
* FIG. 2A
  The design result as submitted by the designer 1 is shown in FIG. 2A , where a sub-design diagram representing a design result during the design of use case 1 is schematically shown.
* the sub-design diagram as shown in FIG. 2A
  includes nodes, arrows between nodes, and node types.
* a node named “userCreateDAO” as indicated by node 101
  is connected, via a arrow, to a node “user” representing a database (DB), indicating that in the software design represented by the sub-design diagram, a design artifact “userCreateDAO” will access database “user” of another design artifact.
* DB
  database
* a design artifact “userCreateService” 201
  calls the “userCreateDAO” 101
* a design artifact “userAddAction” 301
  calls the “userCreateService” 201
* a design artifact “userRegisterJsp” 401
  calls the “userCreateService” 301 .
* Nodes “user”, “project”, “task”, and “company” at the bottom
  indicate data tables of the database.
* Jsp”, “Action”, “Service” and “DAO” as included in the above design artifact names
  conform to naming specifications which indicate that the types of corresponding design artifacts are “Jsp”, “Action”, “Service” and “DAO”, respectively, and their meanings are as follows:
* Jsp
  Implementation of an active page, where display of an active page is realized by an action of calling a description service logic or action;
* Service
  Major service logic implementation, and packaging to some extent the bottom data level so as to improve the reusability
* DAO
  Data Access Object, an object for accessing data sheets in a database, implementing basic data deletion, addition, and modification; typically a data sheet corresponds to a Data Access Object, and the granularity of each object may also be determined by the designer itself; and DB: A plurality of data tables in the database.
* the up-bottom hierarchical sequence between the types
  is Jsp>Action>Service>DAO>DB, which is determined by the software architectural hierarchy.
* FIG. 2A
  different blocks are used to indicate different types of nodes (i.e., types of design artifacts represented by nodes), and the level of each node is partitioned with a horizontal line from bottom to top.
* nodes
  i.e., types of design artifacts represented by nodes
* the level of each node
  is partitioned with a horizontal line from bottom to top.
* the node 101
  is indicated by a rectangular block, indicating that the design artifact represented thereby belongs to a “DAO” type.
* the node 201
  is indicated by a circular block, indicating that the design artifact represented belongs to a “Service” type.
* FIG. 2B and FIG. 2C
  the sub-design diagrams for the above use case 2 and use case 3 are shown in FIG. 2B and FIG. 2C , respectively, and their contents will not be detailed here.
* FIG. 2A , FIG. 2B and FIG. 2C
  are used to indicate design results
* the present invention
  is not limited thereto.
* other indication forms
  can also be adopted, for example, using a table to indicate design results, which could be easily implemented by a person skilled in the art. Therefore, the present invention is not limited to using a specific form of sub-design diagram to indicate a design result.
* the design collecting and analyzing unit 1020
  collects sub-design diagrams 2 A, 2 B, and 2 C of use case 1 , of use cases 3 and 4 , and of use case 2 from the designer 1 , the designer 2 , and the designer 3 , respectively.
* the design collecting and analyzing unit 1020
  may compose the collected sub-design diagrams into a design diagram, which is called “composed design diagram” herein.
* FIG. 3A
  shows a composed design diagram which composes the contents in sub-design diagrams as shown in FIG. 2A-2C .
* FIG. 3A
  only the nodes indicating databases are merged, and the contents of the composed design diagram are equivalent to the combination of the contents as shown in FIGS. 2A-2C , with the relationships among different sub-design diagrams formed through database being displayed more directly and intuitively.
* FIG. 4
  schematically shows a flow chart of a method for identifying software design conflict during a software design process according to an embodiment of the present invention.
* the flow as shown in FIG. 4
  includes three major steps.
* a software design diagram
  is received.
* three sub-design diagrams as shown in FIGS. 2A-2C
  are received.
* each design diagram
  also called “sub-design diagram” in this example
* each design diagram
  includes a plurality of nodes and arrows connecting different nodes, with each node indicating a design artifact.
* the level of each node
  is determined by a corresponding design artifact, and an arrow pointing from one node to another node indicates that a design artifact corresponding to the one node depends on a design artifact corresponding to the other node.
* sub-design diagram
  and “design diagram” are structurally identical. In this sense, sub-design diagram is a kind of design diagram. Given this context, “design diagram” may refer to a composed design diagram of several “sub-design diagrams”.
* a level of a design artifact in a sub-design diagram
  is determined, and isomorphic design artifacts at a given level in the sub-design diagram are identified and marked. Specifically, different design artifacts in a given level that depend on a common design artifact are marked as isomorphic design artifacts.
* a level of a design artifact in a design diagram
  may be determined in accordance with a software architectural hierarchy, for example in accordance with types of design artifacts.
* step 4010
  if, at step 4010 , at least two sub-design diagrams of a software design are received, then before step 4020 , the received sub-design diagrams are composed into one design diagram, step 4015 .
* step 4020
  a level of a design artifact is determined in the composed design diagram, and isomorphic design artifacts in the composed design diagram are identified and marked.
* the node 104 indicating the design artifact userSearchDAO in the sub-design diagram 2 A
  points to a lower-level data table node “user”
* the node 112 indicating the design artifact userSearchDAO in the sub-design diagram 2 C
  also points to the node “user”.
* the design artifact userSearchDAO of the node 104 and the design artifact userSearchDAO of the node 112
  are marked as isomorphic design artifacts, as shown in FIG. 3B .
* FIG. 3B
  In FIG.
* the node 103 and node 111 in the second level from bottom
  is also marked by the same shading pattern, indicating that the design artifact companySearchDAO of node 103 in sub-design diagram 2 A and the design artifact companySearchDAO of node 111 in the sub-design diagram 2 C are isomorphic design artifacts; similarly, at this level, since the design artifact taskSearchDAO of the node 108 in the sub-design diagram 2 B and the design artifact taskSearchDAO of the node 110 in the sub-design diagram 2 C both access to the data table node “task” at the lowest level, they are also marked as isomorphic design artifacts.
* the design diagram with the isomorphic design artifacts marked
  is outputted. If the received sub-design diagrams are merged into a composed design diagram in step 4015 , then at step 4030 , the composed design diagram with the isomorphic design artifacts marked (e.g., as shown in FIG. 3B ) is outputted.
* the above step
  may be carried out by the design collecting and analyzing unit 1020 as shown in FIG. 1 .
* the design collecting and analyzing unit 1020
  outputs the design diagram, with the isomorphic design artifacts marked, to the design conflict resolving unit 1030 to resolve conflicts between different designs.
* two isomorphic design artifacts
  are of a “mergeable” relationship, it means that the two isomorphic design artifacts may be merged into a new design artifact to replace these two isomorphic design artifacts.
* the design conflict resolving unit 1030
  may retain one of the plurality of isomorphic design artifacts while deleting the remaining ones, and then changing an arrow pointing to the nodes of the deleted isomorphic design artifacts to point to the node of the retained isomorphic design artifact, as shown in FIG. 3C .
* node 104 and of node 112
  are determined to be of a “duplicate” relationship
* design artifacts of node 103 and of node 111
  are determined to be of “duplicate” relationship
* a random one of node 104 and node 112
  e.g., node 104
* the remaining (node 112 )
  is deleted.
* the arrow originally pointing to node 112
  is changed to point to the retained node 104 \_ 112 .
* a random node
  for example node 111
* node 111
  from node 103 and node 111 is retained (as indicated by reference sign 103 \_ 111 ), while the remaining node 103 is deleted.
* the contents of the design artifact represented by the new node 103 \_ 111
  are the same as the contents of either node 103 or node 111 , and the same is true regarding nodes 104 and 112 .
* the design conflict resolving unit 1030
  may merge the plurality of isomorphic design artifacts into a new design artifact, dispose the new design artifact in a sub-design diagram, delete the plurality of isomorphic design artifacts, and change an arrow connected to the isomorphic design artifacts to be connected to the new design artifact. For example, given that the design artifacts of node 108 and of node 110 are “mergeable”, in FIG. 3C , the node 108 and node 110 are both deleted and replaced by a new node 108 \_ 110 . It should be noted that the contents of the design artifact represented by the new node 108 \_ 110 are different from those of the design artifact represented by the node 108 and node 110 in FIG. 3A .
* the design conflict resolving unit 1030
  may be operated manually to resolve conflicts.
* the designers
  may negotiate to determine which design artifacts are to be deleted and how to provide an interface for calling the retained isomorphic design artifact.
* the designers
  may negotiate to determine how to merge the design artifacts into a new design artifact and how to provide an interface for calling the merged design artifact.
* the new sub-design diagram
  may be further analyzed by the design collecting and analyzing unit 1020 .
* the sub-design diagram corresponding to FIG. 3C as generated by the design conflict resolving unit 1030
  may be inputted to the design collecting and analyzing unit 1020 , such that steps 4010 - 4030 are repetitively performed for a higher level corresponding to the “Service” type from bottom to top.
* step 4020
  it is identified that node 207 and node 208 are both connected to a common low-level node 108 \_ 110 , indicating that the design artifact taskViewService corresponding to node 207 and the design artifact taskViewService corresponding to node 208 depend on the design artifact taskCreateDAO corresponding to node 108 \_ 110 . Then the design artifact taskViewService corresponding to node 207 and the design artifact taskViewService corresponding to node 208 are marked as isomorphic design artifacts.
* the design collecting and analyzing unit 1020
  provides the composed diagram as shown in FIG. 3D to the design conflict resolving unit 1030 , the latter, in view of the determined relationship between the design artifact 207 and the design artifact 208 , performs deletion or merge processing to the design artifact 207 and design artifact 208 , the result of which is shown in FIG. 3E , where the nodes 207 and 208 as shown in FIG. 3D are replaced by a node 207 \_ 208 , and the connection line pointing to node 207 from node 303 and the connection line pointing to node 207 from node 306 are now changed as pointing to node 207 \_ 208 .
* FIG. 3F
  has a greatly reduced number of nodes as well as a simplified relationship between them.
* a conflict
  is resolved in the design conflict resolving unit 1030 .
* the design conflict resolving unit
  may be partially implemented in the design collecting and analyzing unit 1020 .
* the design collecting and analyzing unit 1020
  may further determine whether the isomorphic design artifacts are of “duplicate” or “mergeable” relationship based on other information of the design result.
* a design result submitted by a designer
  may include a description on design artifacts, and the degree of detail of such a description may be sufficient to automatically determine whether isomorphic design artifacts are of a “duplicate” or “mergeable” relationship.
* one of the plurality of isomorphic design artifacts
  may be retained while the remaining ones are deleted. Also, an arrow pointing to the nodes of the deleted isomorphic design artifacts is changed to point to the node of the retained isomorphic design artifact.
* the processing
  is similar to that on the design artifact of node 104 and the design artifact of node 112 as above described with reference to FIG. 3B and FIG. 3C .
* the design collecting and analyzing unit 1020
  includes a receiving unit 2010 , an identifying unit 2020 , and an outputting unit 2030 .
* the receiving unit 2010
  may receive a sub-design diagram of a software design, wherein the sub-design diagram includes a plurality of nodes and arrows connecting different nodes, with each node indicating a design artifact, and an arrow pointing from one node to another node indicating that the design artifact corresponding to the one node depends on the design artifact corresponding to the other node.
* the identifying unit 2020
  may determine a level of a design artifact in a sub-design diagram, identify different design artifacts at a given level of the sub-design diagram that depend on a common design artifact, and mark them as isomorphic design artifacts.
* the identifying unit 2020
  may determine a level of a design artifact in a design diagram based on the software architectural hierarchy.
* the type of a design artifact
  is obtained according to a design artifact name in conformity to a naming specification, thereby deriving the level of corresponding node.
* there are also other approaches to determine a level of a design artifact
  For example, direct assignment in a sub-design diagram performed in a certain way, or detailed description provided in a form of spreadsheet on a design artifact in a sub-design diagram.
* the outputting unit 2030
  may output a sub-design diagram with the isomorphic design artifacts marked.
* FIGS. 3A-3F indicating an identifying process
  are all composed design diagrams
* a composed design diagram
  may also be partitioned into sub-design diagrams. Thus even if a composed design diagram is outputted, it may be understood as outputting sub-design diagrams contained in the composed design diagram.
* the design collecting and analyzing unit 1020
  may include a merging unit 2015 . If the receiving unit receives at least two sub-design diagrams of software design, then the merging unit 2015 will merge the at least two sub-design diagrams as received by the receiving unit into a composed design diagram to provide to the identifying unit 2020 .
* a simple merging approach
  is to merge different nodes corresponding to a common data table and located at the utmost bottom level of a sub-design diagram into one node, as shown in FIG. 3A .
* the identifying unit 2020
  determines a level of a design artifact in a sub design diagram, and identifies and marks the isomorphic design artifacts at a given level of a sub-design diagram. Specifically, at a given level, different design artifacts depending on a common design artifact are marked as isomorphic design artifacts.
* the outputting unit 2030
  outputs a composed design diagram with the isomorphic design artifacts marked.
* the design conflict resolving unit 1030
  may coordinate to resolve conflicts between software designs, thereby generating a new software design.
* the generated new software design
  may be provided, via the receiving unit 2010 , to the design collecting and analyzing unit 1020 in a form of sub-design diagram, so as to continue identifying conflicts between designs from bottom to top.
* the design conflict resolving unit 1030
  when resolving a conflict between software designs through the design conflict resolving unit 1030 , if it is determined that isomorphic design artifacts are of a duplicate relationship, then one of the plurality of isomorphic design artifacts is retained while the remaining isomorphic design artifacts are deleted, and arrows pointing to nodes of the deleted isomorphic design artifacts are changed to point to the node of the retained isomorphic design artifact.
* isomorphic design artifacts
  are determined to be mergeable, then these isomorphic design artifacts are merged into a new design artifact and then deleted, and a arrow originally connected to the deleted isomorphic design artifacts is changed to be connected to the new design artifact.
* the design collecting and analyzing unit 1020
  may further include a deleting unit 2025 , for deleting duplicated isomorphic design artifacts.
* the deleting unit 2025
  may determine whether a plurality of isomorphic design artifacts marked by the identifying unit 1020 are of a duplicate relationship; if so, then one of the plurality of isomorphic design artifacts is retained while the remaining ones are deleted, and a arrow pointing to the nodes of deleted isomorphic design artifacts is changed to point to the node of the retained isomorphic design artifact.
* the present invention
  may be embodied as an apparatus, a method, or a computer program product.
* the present invention
  may be specifically implemented in the following manners, namely, complete hardware, complete software (including firmware, resident software, microcode, etc), or a combination of part software and part hardware as generally called a “circuit,” “module,” or “system” in this text.
* the present invention
  may adopt a form of computer program product as embodied in any tangible medium of expression, the medium including computer-available program code.
* the computer-available or computer-readable medium
  may be for example, but not limited to, electrical, magnetic, optical, electromagnetic, infrared, or semiconductor systems, means, device, or propagation medium. More specific examples (non-exhaustive list) of the computer-readable medium include the following: an electric connection having one or more leads, a portable computer magnetic disk, hard disk, random access memory (RAM), read-only memory (ROM), erasable programmable read-only memory (EPROM or flash disk), optical fiber, portable compact disk read-only memory (CD-ROM), optical storage device, a transmission medium for example supporting internet or intranet, or a magnetic storage device.
* RAM
  random access memory
* ROM
  read-only memory
* EPROM or flash disk
  erasable programmable read-only memory
* CD-ROM
  compact disk read-only memory
* CD-ROM
  compact disk read-only memory
* optical storage device
  a transmission medium for example supporting internet or intranet, or a magnetic storage device.
* the computer-available or computer readable medium
  may even be a paper or other suitable medium printed with a program thereon, because the program may be obtained electronically by electrically scanning such paper or other medium, and then compiled, interpreted or processed in a suitable manner, and if necessary, stored in a computer memory.
* a computer-available or computer-readable medium
  may be any medium containing, storing, communicating, propagating, or transmitting a program available for an instruction execution system, apparatus or device, or associated with the instruction execution system, apparatus, or device.
* a computer-available medium
  may include a data signal contained in a base band or propagated as a part of carrier and embodying a computer-available program code.
* a computer-available program code
  may be transmitted by any suitable medium, including, but not limited to, radio, wire, cable, or RF, etc.
* a computer program code for executing operation of the present invention
  may be compiled by any combination of one or more program design languages, the program design languages including object-oriented program design languages, such as Java, Smalltalk, C++, etc, as well as conventional procedural program design languages, such as “C” program design language or similar program design language.
* a program code
  may be completely or partly executed on a user computer, or executed as an independent software package, partly executed on the user computer and partly executed on a remote computer, or completely executed on a remote computer or server.
* the remote computer
  may be connected to the user computer through any kind of network, including local area network (LAN) or wide area network (WAN), or connected to an external computer (for example using an internet service provider via Internet).
* LAN
  local area network
* WAN
  wide area network
* Internet
  for example using an internet service provider via Internet
* each block in the flow charts and/or block diagrams and combination of each block in the flow charts and/or block diagrams of the present invention
  may be implemented by computer program instructions.
* These computer program instructions
  may be provided to a processor of a utility computer, a dedicated computer or other programmable data processing apparatus, to thereby generating a machine such that these instructions executed through the computer or other programmable data processing apparatus generate means for implementing functions/operations prescribed in the blocks of the flow charts and/or block diagrams.
* These computer program instructions
  may also be stored in a computer-readable medium capable of instructing a computer or other programmable data processing means to work in a particular way, such that an instruction stored in the computer readable medium generates a manufacture including an instruction means for implementing the functions/operations as prescribed in blocks in the flow charts and/or block diagrams; or the computer program instruction may also be loaded on the computer or other programmable data processing means, such that a series of operation steps are carried out on the computer or other programmable data processing means to produce a process implemented by the computer, such that an instruction executed on the computer or other programmable means can implement the process of functions/operations as prescribed in the blocks in the flow charts and/or block diagrams.
* each block in the flow charts or block diagrams
  may represent a module, a program segment, or a part of code, the module, the program segment, or the part of code including one or more executable instructions for implementing a prescribed logical function.
* the functions noted in the blocks
  may also occur in a sequence different from what is noted in the diagrams. For example, two successively expressed blocks may essentially be executed in parallel, and sometimes they may be executed in a reverse sequence, depending on the involved function.
* each block in the block diagrams and/or flow charts and a combination of blocks in block diagrams and/or flow charts
  may be implemented by a dedicated hardware-based system for executing a prescribed function or operation or may be implemented by a combination of dedicated hardware and computer instructions.

## Landscapes

* Engineering & Computer Science
  (AREA)
* Software Systems
  (AREA)
* General Engineering & Computer Science
  (AREA)
* Theoretical Computer Science
  (AREA)
* Computer Security & Cryptography
  (AREA)
* Physics & Mathematics
  (AREA)
* General Physics & Mathematics
  (AREA)
* Stored Programmes
  (AREA)

## Abstract

A method and a system for identifying and resolving conflicts between design results from a parallel software design. The method includes: receiving a design diagram, wherein the design diagram includes a plurality of nodes and arrows connecting different nodes, with each node indicating a design artifact, and an arrow directed from one node to another node indicating that a design artifact corresponds to the one node depends on a design artifact corresponding to the other node; determining a level of a design artifact in the design diagram, identifying different design artifacts at a given level of the design diagram that depend on a common design artifact, and marking them as isomorphic design artifacts; and outputting a design diagram with the isomorphic design artifacts marked. A conflict between relevant designs are automatically identified in a bottom-up approach according to a software design hierarchy to facilitate conflict resolution.

## Description

CROSS REFERENCE TO RELATED APPLICATION

This applications claims priority under 35 U.S.C. 119 from Chinese Application 200910211378.5, filed Oct. 30, 2009, the entire contents of which are hereby incorporated by reference.

BACKGROUND OF THE INVENTION

1. Field of the Invention

The present invention relates to software design, and in particular, to identification and resolution of conflicts between design results in a parallel software design.

2. Description of Related Art

A software development process may be typically divided into three major stages: requirement analysis, software design, and software implementation. In the software design stage, software design is carried out in accordance with certain standards based on a requirement specification provided by the requirement analysis stage, and the design result is the blueprint for a programming engineer in the software implementation stage. In a large software development project, parallel design (also called distributed design or collaborative design) is always employed. In such an approach, different design tasks are first formed according to different function decomposition or other aspects (architecture layer, use case, etc) of the software in design. Then different design tasks may be allocated to different designers. Finally, a complete software design is generated by composing design results provided by different designers.

However, there are potential conflicts or inconsistencies among design results from different designers. For example, a common computing resource may be used by design artifacts of two different designers' designs (for example, a common database or data table is accessed, or a common function is called), but the design to the common resources are inconsistent or conflict. During software design, conflicts should be eliminated or mitigated in order to facilitate improving programming efficiency during the programming stage, reducing potential errors occurring in software execution, and maintaining the software. To resolve a conflict, it is first necessary to identify conflicts between design results by different designers. However, the complexity of design results makes it very difficult to manually identify a conflict between different design results, especially in a large software design project involving thousands of design artifacts.

BRIEF SUMMARY OF THE INVENTION

To overcome these deficiencies, the present invention provides a method for handling software design conflicts, including: a receiving step of receiving a design diagram of a software design, wherein the design diagram includes a plurality of nodes and arrows connecting the nodes, wherein each node indicates a design artifact, and each arrow pointing from one node to another node indicates that the design artifact corresponding to the one node depends on the design artifact corresponding to the other node; an identifying step of determining a level of the design artifact in the design diagram, identifying different design artifacts at a given level of the design diagram that depend on a common design artifact, and marking them as isomorphic design artifacts; and an outputting step of outputting a new design diagram with the isomorphic design artifacts marked.

In another aspect, the present invention provides a system for handling software design conflicts, including: a receiving unit, for receiving a design diagram of a software design, wherein the design diagram includes a plurality of nodes and arrows connecting the nodes, with each node indicating a design artifact, and an arrow pointing from one node to another node indicating that the design artifact corresponding to the one node depends on the design artifact corresponding to the other node; an identifying unit, for determining a level of a design artifact in the design diagram, identifying different design artifacts at a given level of the design diagram that depend on a common design artifact, and marking them as isomorphic design artifacts; and an outputting unit, for outputting a new design diagram with the isomorphic design artifacts marked.

In yet another aspect, the present invention provides a method for handling software design conflicts, including: a receiving step of receiving at least two sub-design diagrams of a software design, wherein the sub-design diagrams are merged to form a composed design diagram, wherein the composed design diagram includes a plurality of nodes and arrows connecting the nodes, wherein each node indicates a design artifact, and the arrow pointing from one node to another node indicates that the design artifact corresponding to the one node depends on the design artifact corresponding to the other node, an identifying step of determining a level of the design artifact in the composed design diagram, identifying different design artifacts at a given level of the composed design diagram that depend on a common design artifact according to a software architectural hierarchy, and marking them as isomorphic design artifacts, an outputting step of outputting a new design diagram with the isomorphic design artifacts marked, a determining step of determining whether the marked isomorphic design artifacts are of a duplicate relationship, whereby retaining one of the isomorphic design artifacts while deleting the remaining isomorphic design artifacts, wherein the arrow pointing to the nodes of the deleted isomorphic design artifacts are changed to point to the node of the retained isomorphic design artifact, and a determining step of determining whether the marked isomorphic design artifacts are of a mergeable relationship, whereby merging the isomorphic design artifacts into a new design artifact, deleting the isomorphic design artifacts, and changing the arrow originally connected to the deleted isomorphic artifacts so that it connects the new design artifacts.

BRIEF DESCRIPTION OF THE SEVERAL VIEWS OF THE DRAWINGS

The above and other objectives, features and advantages of the present invention will become more apparent through a more detailed description on the preferred embodiments of the present invention as illustrated in the diagrams; in the diagrams, like or similar reference signs typically indicate like or similar components or parts in the preferred embodiments of the present invention.

FIG. 1 shows the architecture of a software design system according to an embodiment of the present invention;

FIGS. 2A-2C schematically show sub-design diagrams of an example software design;

FIG. 3A schematically shows a composed design diagram including the sub-design diagrams as shown in FIGS. 2A-2C;

FIGS. 3B-3F schematically show a process of identifying and resolving a conflict between software designs; and

FIG. 4 schematically shows a flow chart of a method according to an embodiment of the present invention.

DETAILED DESCRIPTION OF THE PREFERRED EMBODIMENTS

Hereinafter, the embodiments of the present invention will be described in more detail with reference to the accompanying diagrams where the embodiments of the present invention are illustrated. However, the present invention may be implemented in various manners and should not be understood to be limited by the embodiments disclosed herein. On the premise of not affecting those skilled in the art in understanding and implementing the present invention, components or details having no direct relationship with the content of the present invention are omitted in the embodiments and the accompanying diagrams, which is intended for making the content of the present invention more prominent, allowing those skilled in the art to understand the essence of the present invention more clearly.

According to the present invention, a basic idea for identifying a conflict between parallel designs is as follows: For a given level in a hierarchical structure, analysis is performed to check whether different design artifacts depend on a common lower-level design artifact; if so, there may be a conflict; otherwise, there would be no conflict. According to the present invention, a conflict between parallel designs may be identified and resolved in a bottom-up approach.

FIG. 1 shows architecture of a software design system **10** according to an embodiment of the present invention. The software design system **10** as shown in FIG. 1 includes a design task allocating unit **1010**, a design collecting and analyzing unit **1020**, and a design conflict resolving unit **1030**.

The design task allocating unit **1010** may allocate design tasks to different designers. When the system is executed, the design task allocating unit **1010** allocates tasks to designers based on a requirement specification obtained from the requirement analysis stage of software development, and stores the design tasks and corresponding designers in a database. As shown in FIG. 1, the requirement specification used as input to the design task allocating unit **1010** can, for example, include use cases (or functions), a data table (database), some user interface design mockup, a naming rule (not shown), etc. A Use case is taken as the decomposition criteria for the software design units in this sample; in other words, each design unit is required to implement one use case. Typically, in a parallel software design, design tasks are firstly allocated to designers based on use cases. Design results by the designers will be collected and composed into a complete design.

According to an embodiment of the present invention, the design task allocating unit **1010** decomposes design tasks based on use cases, and allocates the decomposed tasks to individual designers. Note that the allocation of design tasks may be carried out manually.

Designers accomplish the design of the allocated use cases according to design standards, and submit design results. The design standards include, but are not limited to, hierarchical structure specification, naming specification, and design depth, and shall comply with certain rules—design artifacts at a data access level shall be connected to a relevant database or data table and descriptions of design artifacts of use cases and their internal relationship, etc.

The design collecting and analyzing unit **1020** may collect design results and perform conflict analysis on these design results. In the context of the present invention, the term “conflict” is used to indicate a kind of relationship between design artifacts. A conflict between two design artifacts means that both of the two design artifacts depend on another common design artifact, for example, both calling another common design artifact, or both accessing another common data source, such as a database. Details of conflict analysis will be further explained with reference to the examples below.

The design conflict resolving unit **1030** may resolve conflicts between designs according to the analysis results of the design collecting and analyzing unit, and obtain a new design result based on the conflict resolution.

The new design result may be outputted to the design collecting and analyzing unit **1020** for further analyzing, or may be provided to the software programming stage as a basis for programming.

Before explaining in more detail an embodiment of identifying and resolving a conflict between parallel designs according to the present invention, several use cases involved in an example software design will be introduced first, so that the description of the embodiment of identifying and resolving a conflict between parallel designs may be better understood.

Use Case **1**: User Registration

Use case **1** has the following functions:

Clicking, by a user, on a “registration” button in a logon window on a platform's homepage;

Entering in a role selection page of the registration page to select a role to be registered;

a) If the selected role is the company's project manager and quality administrator:

Clicking on “agreeing with the contract”, then clicking on “Yes”, and then entering into the page for entering a company account;

Entering a correct username and password of a company administrator, clicking on “Yes,” and then entering into a user information fill-in page;

After entering correct information and clicking on “Yes,” the information is successfully saved, and a prompt page pops out;

b) If the selected role is company administrator, then entering into the administrator information page;

c) If the selected role is company developer, then entering into the company developer information page;

d) If the selected role is personal developer, then entering into the personal developer information page;

e) If the selected role is personal project administrator, then entering into the personal project administrator information page; and

f) If the selected role is personal quality administrator, then entering into the personal quality administrator information page.

For simplicity, the parts identical to circumstance a) are omitted in the above descriptions of various circumstances from b)-f), for example, “after entering the correct information . . . a prompt page pops out”.

Use Case **2**: Logon

Entering, by the user, a username and password in the logon window on the platform's front page, and clicking on the button “logon”;

If the username or password is wrong, then entering into a logon fail page; otherwise, based on the role of the username as recorded in the database:

a) If the role is a project manager, then finding all projects managed by the user and displaying the projects in a project list page;

b) If the role is a company administrator, then finding all projects under the company, and entering into a project list page;

c) If the role is a developer, then finding all tasks under the user, and entering into the developer's task list page; and

d) If the role is a quality administrator, then finding all projects under the management of the user, and entering into the quality administrator's project list page.

Use Case **3**: Viewing Projects

Assuming, for example, the role of a logon user is a project manager, then clicking on the project name in the project manager's project list page, then entering into the projects basic information page.

Use Case **4**: Browsing a Current Task List

Clicking, by the project manager, on the “Current Task List” in the left navigation bar on the project basic information page, and querying all tasks under the current project in background, and displaying the current task list page.

It should be noted that the above descriptions on use cases are merely examples. In the following description, it is assumed that the design task allocating unit **1010** allocates the design task of use case **1** to a designer **1** as task **1**, the design task of use cases **3** and **4** to a designer **2** as task **2**, and the design task of use case **2** to a designer **3** as task **3**.

The design results of the software design will be illustrated with reference to task **1**. The design result as submitted by the designer **1** is shown in FIG. 2A, where a sub-design diagram representing a design result during the design of use case **1** is schematically shown.

The sub-design diagram as shown in FIG. 2A includes nodes, arrows between nodes, and node types. For example, a node named “userCreateDAO” as indicated by node **101** is connected, via a arrow, to a node “user” representing a database (DB), indicating that in the software design represented by the sub-design diagram, a design artifact “userCreateDAO” will access database “user” of another design artifact. Similarly, it is also shown in the diagram that a design artifact “userCreateService” **201** calls the “userCreateDAO” **101**, a design artifact “userAddAction” **301** calls the “userCreateService” **201**, and a design artifact “userRegisterJsp” **401** calls the “userCreateService” **301**. Nodes “user”, “project”, “task”, and “company” at the bottom indicate data tables of the database.

“Jsp”, “Action”, “Service” and “DAO” as included in the above design artifact names conform to naming specifications which indicate that the types of corresponding design artifacts are “Jsp”, “Action”, “Service” and “DAO”, respectively, and their meanings are as follows:

Jsp: Implementation of an active page, where display of an active page is realized by an action of calling a description service logic or action;

Action: Packaging some higher-level service logics or packaging some checking actions;

Service: Major service logic implementation, and packaging to some extent the bottom data level so as to improve the reusability;

DAO: Data Access Object, an object for accessing data sheets in a database, implementing basic data deletion, addition, and modification; typically a data sheet corresponds to a Data Access Object, and the granularity of each object may also be determined by the designer itself; and

DB: A plurality of data tables in the database.

The up-bottom hierarchical sequence between the types is Jsp>Action>Service>DAO>DB, which is determined by the software architectural hierarchy.

In FIG. 2A, different blocks are used to indicate different types of nodes (i.e., types of design artifacts represented by nodes), and the level of each node is partitioned with a horizontal line from bottom to top. For example, the node **101** is indicated by a rectangular block, indicating that the design artifact represented thereby belongs to a “DAO” type. The node **201** is indicated by a circular block, indicating that the design artifact represented belongs to a “Service” type.

It should be pointed out that the above types “Jsp”, “Action”, “Service”, “DAO”, and “DB” are only examples used for indicating a hierarchy of design artifacts. As is known in the art, in practice, different software architectural hierarchy may be selected based on specific requirements of software.

Similarly, the sub-design diagrams for the above use case **2** and use case **3** are shown in FIG. 2B and FIG. 2C, respectively, and their contents will not be detailed here.

It should be noted that while in the description the forms of FIG. 2A, FIG. 2B and FIG. 2C are used to indicate design results, the present invention is not limited thereto. In an implementation, other indication forms can also be adopted, for example, using a table to indicate design results, which could be easily implemented by a person skilled in the art. Therefore, the present invention is not limited to using a specific form of sub-design diagram to indicate a design result.

According to an embodiment of the present invention, during the process of software design, the design collecting and analyzing unit **1020** collects sub-design diagrams **2**A, **2**B, and **2**C of use case **1**, of use cases **3** and **4**, and of use case **2** from the designer **1**, the designer **2**, and the designer **3**, respectively.

According to an embodiment of the present invention, the design collecting and analyzing unit **1020** may compose the collected sub-design diagrams into a design diagram, which is called “composed design diagram” herein. For example, FIG. 3A shows a composed design diagram which composes the contents in sub-design diagrams as shown in FIG. 2A-2C. Compared with FIGS. 2A-2C, in FIG. 3A, only the nodes indicating databases are merged, and the contents of the composed design diagram are equivalent to the combination of the contents as shown in FIGS. 2A-2C, with the relationships among different sub-design diagrams formed through database being displayed more directly and intuitively.

Concepts in software design, such as use cases, sub-design diagrams of use cases, and composed design diagrams, have been illustrated above. On this basis, a method for handling a software design conflict according to the present invention will be described with reference to the flow chart of FIG. 4 as well as to the examples in FIGS. 3A-3F.

FIG. 4 schematically shows a flow chart of a method for identifying software design conflict during a software design process according to an embodiment of the present invention. The flow as shown in FIG. 4 includes three major steps.

At step **4010**, a software design diagram is received. According to an embodiment of the present invention, three sub-design diagrams as shown in FIGS. 2A-2C are received. As described above with reference to FIG. 2A, each design diagram (also called “sub-design diagram” in this example) includes a plurality of nodes and arrows connecting different nodes, with each node indicating a design artifact. The level of each node is determined by a corresponding design artifact, and an arrow pointing from one node to another node indicates that a design artifact corresponding to the one node depends on a design artifact corresponding to the other node.

It should be understood that despite the different names, “sub-design diagram” and “design diagram” are structurally identical. In this sense, sub-design diagram is a kind of design diagram. Given this context, “design diagram” may refer to a composed design diagram of several “sub-design diagrams”.

At step **4020**, a level of a design artifact in a sub-design diagram is determined, and isomorphic design artifacts at a given level in the sub-design diagram are identified and marked. Specifically, different design artifacts in a given level that depend on a common design artifact are marked as isomorphic design artifacts.

A level of a design artifact in a design diagram may be determined in accordance with a software architectural hierarchy, for example in accordance with types of design artifacts.

According to an embodiment, if, at step **4010**, at least two sub-design diagrams of a software design are received, then before step **4020**, the received sub-design diagrams are composed into one design diagram, step **4015**. In this case, at step **4020**, a level of a design artifact is determined in the composed design diagram, and isomorphic design artifacts in the composed design diagram are identified and marked.

For example, by analyzing the second level from bottom in the composed design diagram as shown in FIG. 3A, it is found that the node **104** indicating the design artifact userSearchDAO in the sub-design diagram **2**A points to a lower-level data table node “user”, and the node **112** indicating the design artifact userSearchDAO in the sub-design diagram **2**C also points to the node “user”. Then, the design artifact userSearchDAO of the node **104** and the design artifact userSearchDAO of the node **112** are marked as isomorphic design artifacts, as shown in FIG. 3B. In FIG. 3B, the same shading is used to mark node **104** and node **112** to indicate that the design artifact userSearchDAO of the node **104** and the design artifact userSearchDAO of node **112** are isomorphic design artifacts.

In FIG. 3B, the node **103** and node **111** in the second level from bottom is also marked by the same shading pattern, indicating that the design artifact companySearchDAO of node **103** in sub-design diagram **2**A and the design artifact companySearchDAO of node **111** in the sub-design diagram **2**C are isomorphic design artifacts; similarly, at this level, since the design artifact taskSearchDAO of the node **108** in the sub-design diagram **2**B and the design artifact taskSearchDAO of the node **110** in the sub-design diagram **2**C both access to the data table node “task” at the lowest level, they are also marked as isomorphic design artifacts.

It should be noted that although in FIG. 3B the same shading pattern is used to mark isomorphic design artifacts, the present invention is not limited thereto. For example, a color or a shadow may be used instead. Also, there may be various kinds of different marking manners, for example, directly storing in a table which design artifacts are isomorphic design artifacts.

At step **4030**, the design diagram with the isomorphic design artifacts marked is outputted. If the received sub-design diagrams are merged into a composed design diagram in step **4015**, then at step **4030**, the composed design diagram with the isomorphic design artifacts marked (e.g., as shown in FIG. 3B) is outputted.

According to an embodiment of the present invention, the above step may be carried out by the design collecting and analyzing unit **1020** as shown in FIG. 1. The design collecting and analyzing unit **1020** outputs the design diagram, with the isomorphic design artifacts marked, to the design conflict resolving unit **1030** to resolve conflicts between different designs.

Hereinafter, the approach of resolving a conflict between designs by the design conflict resolving unit **1030** will be described.

Firstly, the kind of conflict between isomorphic design artifacts between sub-design diagrams is identified. In software design practice, conflicts between isomorphic design artifacts may be classified as “duplicate” and “mergeable”.

If two isomorphic design artifacts are of a “duplicate” relationship, it means that the two isomorphic design artifacts could be replaced by each other.

If two isomorphic design artifacts are of a “mergeable” relationship, it means that the two isomorphic design artifacts may be merged into a new design artifact to replace these two isomorphic design artifacts.

According to an embodiment of the present invention, if a plurality of isomorphic design artifacts are determined to be of duplicate relationship, the design conflict resolving unit **1030** may retain one of the plurality of isomorphic design artifacts while deleting the remaining ones, and then changing an arrow pointing to the nodes of the deleted isomorphic design artifacts to point to the node of the retained isomorphic design artifact, as shown in FIG. 3C. Here, if the design artifacts of node **104** and of node **112** are determined to be of a “duplicate” relationship, and if the design artifacts of node **103** and of node **111** are determined to be of “duplicate” relationship, then a random one of node **104** and node **112** (e.g., node **104**) is retained, while the remaining (node **112**) is deleted. Then the arrow originally pointing to node **112** is changed to point to the retained node **104**\_**112**. Similarly, a random node, for example node **111**, from node **103** and node **111** is retained (as indicated by reference sign **103**\_**111**), while the remaining node **103** is deleted. It should be noted that the contents of the design artifact represented by the new node **103**\_**111** are the same as the contents of either node **103** or node **111**, and the same is true regarding  nodes  **104** and **112**.

If a plurality of isomorphic design artifacts are of mergeable relationship, the design conflict resolving unit **1030** may merge the plurality of isomorphic design artifacts into a new design artifact, dispose the new design artifact in a sub-design diagram, delete the plurality of isomorphic design artifacts, and change an arrow connected to the isomorphic design artifacts to be connected to the new design artifact. For example, given that the design artifacts of node **108** and of node **110** are “mergeable”, in FIG. 3C, the node **108** and node **110** are both deleted and replaced by a new node **108**\_**110**. It should be noted that the contents of the design artifact represented by the new node **108**\_**110** are different from those of the design artifact represented by the node **108** and node **110** in FIG. 3A.

In software design practice, the design conflict resolving unit **1030** may be operated manually to resolve conflicts. For example, for duplicated isomorphic design artifacts, the designers may negotiate to determine which design artifacts are to be deleted and how to provide an interface for calling the retained isomorphic design artifact. For mergeable isomorphic design artifacts, the designers may negotiate to determine how to merge the design artifacts into a new design artifact and how to provide an interface for calling the merged design artifact.

As a result of resolving conflicts, a new sub-design diagram is obtained. The new sub-design diagram may be further analyzed by the design collecting and analyzing unit **1020**.

The sub-design diagram corresponding to FIG. 3C as generated by the design conflict resolving unit **1030** may be inputted to the design collecting and analyzing unit **1020**, such that steps **4010**-**4030** are repetitively performed for a higher level corresponding to the “Service” type from bottom to top.

As shown in FIG. 3D, at step **4020**, it is identified that node **207** and node **208** are both connected to a common low-level node **108**\_**110**, indicating that the design artifact taskViewService corresponding to node **207** and the design artifact taskViewService corresponding to node **208** depend on the design artifact taskCreateDAO corresponding to node **108**\_**110**. Then the design artifact taskViewService corresponding to node **207** and the design artifact taskViewService corresponding to node **208** are marked as isomorphic design artifacts.

After the design collecting and analyzing unit **1020** provides the composed diagram as shown in FIG. 3D to the design conflict resolving unit **1030**, the latter, in view of the determined relationship between the design artifact **207** and the design artifact **208**, performs deletion or merge processing to the design artifact **207** and design artifact **208**, the result of which is shown in FIG. 3E, where the  nodes  **207** and **208** as shown in FIG. 3D are replaced by a node **207**\_**208**, and the connection line pointing to node **207** from node **303** and the connection line pointing to node **207** from node **306** are now changed as pointing to node **207**\_**208**.

In a similar approach, through interaction between the design collecting and analyzing unit **1020** and the design conflict resolving unit **1030**, conflicts between designs are identified and resolved hierarchically from bottom to top, and the original sub-design diagrams **2**A, **2**B, and **2**C are turned into a composed design diagram similar to the one shown in FIG. 3F; compared with FIG. 3A, FIG. 3F has a greatly reduced number of nodes as well as a simplified relationship between them.

In the above described embodiments, a conflict is resolved in the design conflict resolving unit **1030**. However, according to an embodiment of the present invention, the design conflict resolving unit may be partially implemented in the design collecting and analyzing unit **1020**.

For example, at step **4020** or thereafter, the design collecting and analyzing unit **1020** may further determine whether the isomorphic design artifacts are of “duplicate” or “mergeable” relationship based on other information of the design result.

As mentioned previously, in view of specific design standards, a design result submitted by a designer may include a description on design artifacts, and the degree of detail of such a description may be sufficient to automatically determine whether isomorphic design artifacts are of a “duplicate” or “mergeable” relationship.

As depicted above with reference to FIG. 4, if it is determined that a plurality of isomorphic design artifacts are of a “duplicate” relationship, then one of the plurality of isomorphic design artifacts may be retained while the remaining ones are deleted. Also, an arrow pointing to the nodes of the deleted isomorphic design artifacts is changed to point to the node of the retained isomorphic design artifact. The processing is similar to that on the design artifact of node **104** and the design artifact of node **112** as above described with reference to FIG. 3B and FIG. 3C.

Corresponding to the above processing, information about the above processing approach and the related design artifacts may also be passed on to the design conflict resolving unit **1030**.

Hereinafter, a more detailed implementation approach for a design collecting and analyzing unit **1020** in a system **10** according to an embodiment of the present invention will be described with reference to FIG. 1.

As shown in FIG. 1, the design collecting and analyzing unit **1020** includes a receiving unit **2010**, an identifying unit **2020**, and an outputting unit **2030**.

The receiving unit **2010** may receive a sub-design diagram of a software design, wherein the sub-design diagram includes a plurality of nodes and arrows connecting different nodes, with each node indicating a design artifact, and an arrow pointing from one node to another node indicating that the design artifact corresponding to the one node depends on the design artifact corresponding to the other node.

The identifying unit **2020** may determine a level of a design artifact in a sub-design diagram, identify different design artifacts at a given level of the sub-design diagram that depend on a common design artifact, and mark them as isomorphic design artifacts.

There are a variety of approaches to determine a level of a design artifact. According to an embodiment of the present invention, the identifying unit **2020** may determine a level of a design artifact in a design diagram based on the software architectural hierarchy. In an embodiment of the present invention, the type of a design artifact is obtained according to a design artifact name in conformity to a naming specification, thereby deriving the level of corresponding node. Of course, as known by a person skilled in the art, there are also other approaches to determine a level of a design artifact. For example, direct assignment in a sub-design diagram performed in a certain way, or detailed description provided in a form of spreadsheet on a design artifact in a sub-design diagram.

The outputting unit **2030** may output a sub-design diagram with the isomorphic design artifacts marked.

It should be noted that although FIGS. 3A-3F indicating an identifying process are all composed design diagrams, a composed design diagram may also be partitioned into sub-design diagrams. Thus even if a composed design diagram is outputted, it may be understood as outputting sub-design diagrams contained in the composed design diagram.

Alternatively, the design collecting and analyzing unit **1020** may include a merging unit **2015**. If the receiving unit receives at least two sub-design diagrams of software design, then the merging unit **2015** will merge the at least two sub-design diagrams as received by the receiving unit into a composed design diagram to provide to the identifying unit **2020**. A simple merging approach is to merge different nodes corresponding to a common data table and located at the utmost bottom level of a sub-design diagram into one node, as shown in FIG. 3A.

The identifying unit **2020** determines a level of a design artifact in a sub design diagram, and identifies and marks the isomorphic design artifacts at a given level of a sub-design diagram. Specifically, at a given level, different design artifacts depending on a common design artifact are marked as isomorphic design artifacts. The outputting unit **2030** outputs a composed design diagram with the isomorphic design artifacts marked.

Through the design conflict resolving unit **1030** and based on the design diagram outputted from the outputting unit **2030**, designers may coordinate to resolve conflicts between software designs, thereby generating a new software design. According to an embodiment of the present invention, the generated new software design may be provided, via the receiving unit **2010**, to the design collecting and analyzing unit **1020** in a form of sub-design diagram, so as to continue identifying conflicts between designs from bottom to top.

According to an embodiment of the present invention, when resolving a conflict between software designs through the design conflict resolving unit **1030**, if it is determined that isomorphic design artifacts are of a duplicate relationship, then one of the plurality of isomorphic design artifacts is retained while the remaining isomorphic design artifacts are deleted, and arrows pointing to nodes of the deleted isomorphic design artifacts are changed to point to the node of the retained isomorphic design artifact. If isomorphic design artifacts are determined to be mergeable, then these isomorphic design artifacts are merged into a new design artifact and then deleted, and a arrow originally connected to the deleted isomorphic design artifacts is changed to be connected to the new design artifact.

According to another embodiment of the present invention, conflicts may also be resolved while identifying the conflicts. According to an embodiment of the present invention, the design collecting and analyzing unit **1020** may further include a deleting unit **2025**, for deleting duplicated isomorphic design artifacts. Specifically, the deleting unit **2025** may determine whether a plurality of isomorphic design artifacts marked by the identifying unit **1020** are of a duplicate relationship; if so, then one of the plurality of isomorphic design artifacts is retained while the remaining ones are deleted, and a arrow pointing to the nodes of deleted isomorphic design artifacts is changed to point to the node of the retained isomorphic design artifact.

The method and the system for handling design conflicts in parallel design according to the present invention have been schematically described above. It should be understood that for the sake of conciseness, many details related to software design have been omitted in the above description. However, persons skilled in the art, based on the above description of the principle of the present invention and its various embodiments in the description, can completely implement the above and further embodiments.

Though the present invention and its embodiments have been described above with reference to the diagrams, it should be understood that the present invention is not stringently limited to these embodiments, and in the case of not departing from the scope and principle of the present invention, a person of normal skill in the art can carry out various kinds of variations and modifications to the embodiments. All such variations and modifications are intended to be included in the scope of the present invention as limited in the appended claims.

Moreover, based on the above description, the person skilled in the art would appreciate that the present invention may be embodied as an apparatus, a method, or a computer program product. Thus, the present invention may be specifically implemented in the following manners, namely, complete hardware, complete software (including firmware, resident software, microcode, etc), or a combination of part software and part hardware as generally called a “circuit,” “module,” or “system” in this text. Further, the present invention may adopt a form of computer program product as embodied in any tangible medium of expression, the medium including computer-available program code.

Any combination of one or more computer-available or computer-readable mediums may be used. The computer-available or computer-readable medium may be for example, but not limited to, electrical, magnetic, optical, electromagnetic, infrared, or semiconductor systems, means, device, or propagation medium. More specific examples (non-exhaustive list) of the computer-readable medium include the following: an electric connection having one or more leads, a portable computer magnetic disk, hard disk, random access memory (RAM), read-only memory (ROM), erasable programmable read-only memory (EPROM or flash disk), optical fiber, portable compact disk read-only memory (CD-ROM), optical storage device, a transmission medium for example supporting internet or intranet, or a magnetic storage device. It should be noted that the computer-available or computer readable medium may even be a paper or other suitable medium printed with a program thereon, because the program may be obtained electronically by electrically scanning such paper or other medium, and then compiled, interpreted or processed in a suitable manner, and if necessary, stored in a computer memory. In the context of the present document, a computer-available or computer-readable medium may be any medium containing, storing, communicating, propagating, or transmitting a program available for an instruction execution system, apparatus or device, or associated with the instruction execution system, apparatus, or device. A computer-available medium may include a data signal contained in a base band or propagated as a part of carrier and embodying a computer-available program code. A computer-available program code may be transmitted by any suitable medium, including, but not limited to, radio, wire, cable, or RF, etc.

A computer program code for executing operation of the present invention may be compiled by any combination of one or more program design languages, the program design languages including object-oriented program design languages, such as Java, Smalltalk, C++, etc, as well as conventional procedural program design languages, such as “C” program design language or similar program design language. A program code may be completely or partly executed on a user computer, or executed as an independent software package, partly executed on the user computer and partly executed on a remote computer, or completely executed on a remote computer or server. In the latter circumstance, the remote computer may be connected to the user computer through any kind of network, including local area network (LAN) or wide area network (WAN), or connected to an external computer (for example using an internet service provider via Internet).

Further, each block in the flow charts and/or block diagrams and combination of each block in the flow charts and/or block diagrams of the present invention may be implemented by computer program instructions. These computer program instructions may be provided to a processor of a utility computer, a dedicated computer or other programmable data processing apparatus, to thereby generating a machine such that these instructions executed through the computer or other programmable data processing apparatus generate means for implementing functions/operations prescribed in the blocks of the flow charts and/or block diagrams.

These computer program instructions may also be stored in a computer-readable medium capable of instructing a computer or other programmable data processing means to work in a particular way, such that an instruction stored in the computer readable medium generates a manufacture including an instruction means for implementing the functions/operations as prescribed in blocks in the flow charts and/or block diagrams; or the computer program instruction may also be loaded on the computer or other programmable data processing means, such that a series of operation steps are carried out on the computer or other programmable data processing means to produce a process implemented by the computer, such that an instruction executed on the computer or other programmable means can implement the process of functions/operations as prescribed in the blocks in the flow charts and/or block diagrams.

The flow charts and block diagrams in the diagrams illustrate a hierarchical architecture, function and operation likely implemented by the system, method and computer program product according to various embodiments of the present invention. At this point, each block in the flow charts or block diagrams may represent a module, a program segment, or a part of code, the module, the program segment, or the part of code including one or more executable instructions for implementing a prescribed logical function. It should be noted that, in some alternative implementations, the functions noted in the blocks may also occur in a sequence different from what is noted in the diagrams. For example, two successively expressed blocks may essentially be executed in parallel, and sometimes they may be executed in a reverse sequence, depending on the involved function. It should also be noted that each block in the block diagrams and/or flow charts and a combination of blocks in block diagrams and/or flow charts may be implemented by a dedicated hardware-based system for executing a prescribed function or operation or may be implemented by a combination of dedicated hardware and computer instructions.

## Claims (12)

What is claimed is:

1. A method for handling software design conflicts, comprising:

allocating one or more of a plurality of design tasks for a software design to a plurality of designers, wherein each of the plurality of design tasks correspond to a portion of the software design, wherein the allocation of each of the plurality of design tasks is based on a use case associated with each of the plurality of design tasks;

receiving a plurality of design diagrams, wherein each of the plurality of design diagrams corresponds to one of the plurality of design tasks, wherein each of the plurality of design diagrams comprises a plurality of nodes and arrows connecting said nodes, wherein each said node indicates a design artifact, and wherein said arrow pointing from one node to another node indicates that said design artifact corresponding to the one node depends on said design artifact corresponding to the other node;

merging the plurality of design diagrams into a composed design diagram,

determining a level of the plurality of design artifacts in said composed design diagram;

identifying one or more different design artifacts at a given level of said composed design diagram that depend on a common design artifact, and marking them as isomorphic design artifacts;

determining whether said marked isomorphic design artifacts are of a duplicate relationship, wherein one of said isomorphic design artifacts is retained, while the remaining said isomorphic design artifacts are deleted, and wherein said arrow pointing to said nodes of said deleted isomorphic design artifacts are changed to point to said node of said retained isomorphic design artifact; and

outputting a new composed design diagram with said isomorphic design artifacts marked.

2. The method according to claim 1, wherein determining said level of said design artifact in said composed design diagram comprises determining said level of said design artifact in said composed design diagram according to a software architectural hierarchy.

3. The method according to claim 2, further comprising determining whether said marked isomorphic design artifacts are of a mergeable relationship, wherein said isomorphic design artifacts are merged into a new design artifact, while the original said isomorphic design artifacts are deleted, and wherein said arrow originally connected to said deleted isomorphic artifacts are changed to be connected to said new design artifact.

4. The method according to claim 1, further comprising determining whether said marked isomorphic design artifacts are of a mergeable relationship, wherein said isomorphic design artifacts are merged into a new design artifact, while the original said isomorphic design artifacts are deleted, and wherein said arrow originally connected to said deleted isomorphic artifacts are changed to be connected to said new design artifact.

5. A system for handling software design conflicts, comprising:

an allocating unit for assigning one or more of a plurality of design tasks for a software design to a plurality of designers, wherein each of the plurality of design tasks correspond to a portion of the software design, wherein the allocation of each of the plurality of design tasks is based on a use case associated with each of the plurality of design tasks;

a receiving unit comprising a processor configured for receiving a plurality of design diagrams, wherein each of the plurality of design diagrams corresponds to one of the plurality of design tasks, wherein each of the plurality of design diagrams comprises a plurality of nodes and arrows connecting said nodes, wherein each said node indicates a design artifact, and wherein said arrow pointing from one node to another node indicates that said design artifact corresponding to the one node depends on said design artifact corresponding to the other node;

a merging unit for merging the plurality of design diagrams into a composed design diagram,

an identifying unit, for determining a level of a design artifact in said composed design diagram, identifying different design artifacts at a given level of said composed design diagram that depend on a common design artifact, and marking them as isomorphic design artifacts;

a deleting unit, for retaining one of said plurality of isomorphic design artifacts marked by said identifying unit and being of a duplicate relationship, while deleting the remaining isomorphic design artifacts, wherein said arrow pointing to said nodes of said deleted isomorphic design artifacts are changed to point to said node of said retained isomorphic design artifact; and

an outputting unit, for outputting a new composed design diagram with said isomorphic design artifacts marked.

6. The system according to claim 5, wherein said identifying unit determines a level of said design artifact in said composed design diagram according to a software architectural hierarchy.

7. The system according to claim 5, further comprising: a design conflict resolving unit, for resolving conflicts between software designs based on an output result of said outputting unit, thereby generating a new software design.

8. The system according to claim 7, wherein said design conflict resolving unit further provides said generated new software design to said receiving unit.

9. The system according to claim 7, wherein said isomorphic design artifacts are of a duplicate relationship, wherein said design conflict resolving unit retains one of said plurality of isomorphic design artifacts while deleting the remaining said isomorphic design artifacts, and wherein said arrow pointing to said nodes of said deleted isomorphic design artifacts are changed to point to said node of said retained isomorphic design artifact.

10. The system according to claim 7, wherein said isomorphic design artifacts are of a mergeable relationship, wherein said design conflict resolving unit merges said isomorphic design artifacts into a new design artifact and deletes said isomorphic design artifacts, and wherein said arrow pointing to said nodes of said deleted isomorphic design artifacts are changed to point to said node of said new design artifact.

11. A non-transitory computer readable article of manufacture tangibly embodying computer readable instructions which when executed causes a computer to carry out the steps of a method according to claim 1.

12. A method for handling software design conflicts, comprising:

allocating one or more of a plurality of design tasks for a software design to a plurality of designers, wherein each of the plurality of design tasks correspond to a portion of the software design, wherein the allocation of each of the plurality of design tasks is based on a use case associated with each of the plurality of design tasks;

receiving at least two sub-design diagrams of a software design, wherein each of the least two sub-design diagrams corresponds to one of the plurality of design tasks and wherein said sub-design diagrams are merged to form a composed design diagram, wherein said composed design diagram comprises a plurality of nodes and arrows connecting said nodes, and wherein each said node indicates a design artifact, and said arrow pointing from one node to another node indicates that said design artifact corresponding to said one node depends on said design artifact corresponding to said other node;

determining a level of said design artifact in said composed design diagram, identifying different said design artifacts at a given level of said composed design diagram that depend on a common design artifact according to a software architectural hierarchy, and marking them as isomorphic design artifacts;

outputting a new design diagram with said isomorphic design artifacts marked;

determining whether said marked isomorphic design artifacts are of a duplicate relationship, wherein one of said isomorphic design artifacts is retained while deleting the remaining said isomorphic design artifacts, and said arrow pointing to said nodes of said deleted isomorphic design artifacts are changed to point to said node of said retained isomorphic design artifact; and

determining whether said marked isomorphic design artifacts are of a mergeable relationship, wherein said isomorphic design artifacts are merged into a new design artifact, deleting said isomorphic design artifacts, and changing said arrow originally connected to said deleted isomorphic artifacts to said new design artifact.

US12/913,913
2009-10-30
2010-10-28
Method and system for handling software design conflicts
Expired - Fee Related
[US9009652B2
(en)](/patent/US9009652B2/en)

## Applications Claiming Priority (3)

| Application Number | Priority Date | Filing Date | Title |
| --- | --- | --- | --- |
| CN200910211378.5 |  | 2009-10-30 |  |
| CN2009102113785A [CN102053825A (en)](/patent/CN102053825A/en) | 2009-10-30 | 2009-10-30 | Method and system for processing software design conflicts |
| CN200910211378 |  | 2009-10-30 |  |

## Publications (2)

| Publication Number | Publication Date |
| --- | --- |
| US20110107303A1 [US20110107303A1 (en)](/patent/US20110107303A1/en) | 2011-05-05 |
| US9009652B2 true [US9009652B2 (en)](/patent/US9009652B2/en) | 2015-04-14 |

# Family

## ID=43926761

## Family Applications (1)

| Application Number | Title | Priority Date | Filing Date |
| --- | --- | --- | --- |
| US12/913,913 Expired - Fee Related [US9009652B2 (en)](/patent/US9009652B2/en) | 2009-10-30 | 2010-10-28 | Method and system for handling software design conflicts |

## Country Status (2)

| Country | Link |
| --- | --- |
| US (1) | [US9009652B2 (en)](/patent/US9009652B2/en) |
| CN (1) | [CN102053825A (en)](/patent/CN102053825A/en) |

## Cited By (1)

\* Cited by examiner, † Cited by third party

| Publication number | Priority date | Publication date | Assignee | Title |
| --- | --- | --- | --- | --- |
| [US10860295B1 (en)](/patent/US10860295B1/en) | 2019-01-03 | 2020-12-08 | Amazon Technologies, Inc. | Automated detection of ambiguities in software design diagrams |

## Families Citing this family (8)

\* Cited by examiner, † Cited by third party

| Publication number | Priority date | Publication date | Assignee | Title |
| --- | --- | --- | --- | --- |
| [CN105912338A (en)](/patent/CN105912338A/en) \* | 2016-04-15 | 2016-08-31 | 中国人民解放军海军航空工程学院 | Software design method facing user operation flow |
| [JP6602511B2 (en)](/patent/JP6602511B2/en) \* | 2017-06-02 | 2019-11-06 | 三菱電機株式会社 | Program code generating apparatus and program code generating program |
| [US12019742B1 (en)](/patent/US12019742B1/en) | 2018-06-01 | 2024-06-25 | Amazon Technologies, Inc. | Automated threat modeling using application relationships |
| [US10331426B1 (en)](/patent/US10331426B1/en) \* | 2018-07-19 | 2019-06-25 | Capital One Services, Llc | Systems and methods of diagram transformation |
| [US12174963B1 (en)](/patent/US12174963B1/en) \* | 2018-10-29 | 2024-12-24 | Amazon Technologies, Inc. | Automated selection of secure design patterns |
| [AU2020237195B2 (en)](/patent/AU2020237195B2/en) \* | 2019-03-14 | 2023-06-22 | Yadong Li | Distributed system generating rule compiler engine apparatuses, methods, systems and media |
| [EP3896593A1 (en)](/patent/EP3896593A1/en) \* | 2020-04-14 | 2021-10-20 | ABB Schweiz AG | Method for analyzing effects of operator actions in industrial plants |
| [CN120766306B (en)](/patent/CN120766306B/en) \* | 2025-07-14 | 2025-12-12 | 北京中北信号软件有限公司 | A method, device and storage medium for intelligent management of drawings |

## Citations (5)

\* Cited by examiner, † Cited by third party

| Publication number | Priority date | Publication date | Assignee | Title |
| --- | --- | --- | --- | --- |
| [US20060190105A1 (en)](/patent/US20060190105A1/en) \* | 2005-01-13 | 2006-08-24 | Ray Hsu | Merging graphical programs |
| [CN101126976A (en)](/patent/CN101126976A/en) | 2006-08-15 | 2008-02-20 | 国际商业机器公司 | Method and system for analyzing and rendering conflict and automatically coordinating model change |
| [CN101370009A (en)](/patent/CN101370009A/en) | 2008-03-12 | 2009-02-18 | 武汉理工大学 | Construction Method of Virtual Network Block Framework Based on Linux Kernel Network Subsystem |
| [US20090144704A1 (en)](/patent/US20090144704A1/en) \* | 2005-03-24 | 2009-06-04 | Dspace Digital Processing And Control Engineering | Comparison of Interfaces Between Software Components |
| [US20100313179A1 (en)](/patent/US20100313179A1/en) \* | 2009-06-05 | 2010-12-09 | Microsoft Corporation | Integrated work lists for engineering project change management |

## Family Cites Families (2)

\* Cited by examiner, † Cited by third party

| Publication number | Priority date | Publication date | Assignee | Title |
| --- | --- | --- | --- | --- |
| [CN100367712C (en)](/patent/CN100367712C/en) \* | 2005-06-01 | 2008-02-06 | 合肥工业大学 | A Collaborative Design Method Based on Collaborative Template |
| [CN101329638B (en)](/patent/CN101329638B/en) \* | 2007-06-18 | 2011-11-09 | 国际商业机器公司 | Method and system for analyzing parallelism of program code |

* 2009
  + 2009-10-30
    CN
    CN2009102113785A
    [patent/CN102053825A/en](/patent/CN102053825A/en)
    active
    Pending
* 2010
  + 2010-10-28
    US
    US12/913,913
    [patent/US9009652B2/en](/patent/US9009652B2/en)
    not\_active
    Expired - Fee Related

## Patent Citations (6)

\* Cited by examiner, † Cited by third party

| Publication number | Priority date | Publication date | Assignee | Title |
| --- | --- | --- | --- | --- |
| [US20060190105A1 (en)](/patent/US20060190105A1/en) \* | 2005-01-13 | 2006-08-24 | Ray Hsu | Merging graphical programs |
| [US20090144704A1 (en)](/patent/US20090144704A1/en) \* | 2005-03-24 | 2009-06-04 | Dspace Digital Processing And Control Engineering | Comparison of Interfaces Between Software Components |
| [CN101126976A (en)](/patent/CN101126976A/en) | 2006-08-15 | 2008-02-20 | 国际商业机器公司 | Method and system for analyzing and rendering conflict and automatically coordinating model change |
| [US20080046864A1 (en)](/patent/US20080046864A1/en) \* | 2006-08-15 | 2008-02-21 | Xin Xin Bai | Method and system for analyzing and presenting conflicts in model transformation and automatically reconciling model transformation |
| [CN101370009A (en)](/patent/CN101370009A/en) | 2008-03-12 | 2009-02-18 | 武汉理工大学 | Construction Method of Virtual Network Block Framework Based on Linux Kernel Network Subsystem |
| [US20100313179A1 (en)](/patent/US20100313179A1/en) \* | 2009-06-05 | 2010-12-09 | Microsoft Corporation | Integrated work lists for engineering project change management |

## Non-Patent Citations (7)

\* Cited by examiner, † Cited by third party

| Title |
| --- |
| Abstract-CN101126976A. |
| Abstract—CN101126976A. |
| Abstract-CN101370009A. |
| Abstract—CN101370009A. |
| M. Antkiewicz and K. Czarnicki, Design Space of Heterogeneous Synchronization, Lecture Notes in Computer Science, 2008, 3-46, vol. 5235/2008. |
| M.Z. Ouertani et al., A product data dependencies network to support conflict resolution.., Computational Engineering in Systems Applications, Oct. 2006, 1189-1196, Beijing. |
| P. Sriplakich, Supporting Collaborative Development in an Open MDA Environment, Proceedings of the 22nd IEEE International Conference on Software Maintenance, Sep. 2006, 244-253. |

## Cited By (1)

\* Cited by examiner, † Cited by third party

| Publication number | Priority date | Publication date | Assignee | Title |
| --- | --- | --- | --- | --- |
| [US10860295B1 (en)](/patent/US10860295B1/en) | 2019-01-03 | 2020-12-08 | Amazon Technologies, Inc. | Automated detection of ambiguities in software design diagrams |

## Also Published As

| Publication number | Publication date |
| --- | --- |
| [US20110107303A1 (en)](/patent/US20110107303A1/en) | 2011-05-05 |
| [CN102053825A (en)](/patent/CN102053825A/en) | 2011-05-11 |

## Similar Documents

| Publication | Publication Date | Title |
| --- | --- | --- |
| [US9009652B2 (en)](/patent/US9009652B2/en) | 2015-04-14 | Method and system for handling software design conflicts |
| [CN112966004B (en)](/patent/CN112966004B/en) | 2023-07-28 | Data query method, device, electronic equipment and computer readable medium |
| [US8065315B2 (en)](/patent/US8065315B2/en) | 2011-11-22 | Solution search for software support |
| [US6487469B1 (en)](/patent/US6487469B1/en) | 2002-11-26 | System and method for integrating schedule and design environments |
| [US9305109B2 (en)](/patent/US9305109B2/en) | 2016-04-05 | Method and system of adapting a data model to a user interface component |
| [US9390395B2 (en)](/patent/US9390395B2/en) | 2016-07-12 | Methods and apparatus for defining a collaborative workspace |
| [US7917815B2 (en)](/patent/US7917815B2/en) | 2011-03-29 | Multi-layer context parsing and incident model construction for software support |
| [CN113076104A (en)](/patent/CN113076104A/en) | 2021-07-06 | Page generation method, device, equipment and storage medium |
| [CN112434004B (en)](/patent/CN112434004B/en) | 2024-08-16 | Data migration method, device, computer equipment and storage medium of heterogeneous system |
| [US10782961B2 (en)](/patent/US10782961B2/en) | 2020-09-22 | Analyzing components related to a software application in a software development environment |
| [US10635408B2 (en)](/patent/US10635408B2/en) | 2020-04-28 | Method and apparatus for enabling agile development of services in cloud computing and traditional environments |
| [CN103678446B (en)](/patent/CN103678446B/en) | 2018-06-05 | Improved mode map based on Data View and database table |
| [US9542484B2 (en)](/patent/US9542484B2/en) | 2017-01-10 | Updating ontology while maintaining document annotations |
| [CN111078729A (en)](/patent/CN111078729A/en) | 2020-04-28 | Medical data tracing method, device, system, storage medium and electronic equipment |
| [CN110705237A (en)](/patent/CN110705237A/en) | 2020-01-17 | Automatic document generation method, data processing device, and storage medium |
| [EP3113016A1 (en)](/patent/EP3113016A1/en) | 2017-01-04 | Tracing dependencies between development artifacts in a development project |
| [CN109271313A (en)](/patent/CN109271313A/en) | 2019-01-25 | Code test method, device and computer readable storage medium |
| [CN106446064A (en)](/patent/CN106446064A/en) | 2017-02-22 | Data conversion method and device |
| [CN115794827B (en)](/patent/CN115794827B/en) | 2023-07-21 | Data table structure management system and method |
| [CN116560683A (en)](/patent/CN116560683A/en) | 2023-08-08 | Software updating method, device, equipment and storage medium |
| [US10169725B2 (en)](/patent/US10169725B2/en) | 2019-01-01 | Change-request analysis |
| [CN115146604A (en)](/patent/CN115146604A/en) | 2022-10-04 | Interface technology document generation method, device, equipment and storage medium |
| [CN113138829A (en)](/patent/CN113138829A/en) | 2021-07-20 | Management method, device, equipment and storage medium of cloud application architecture |
| [CN121328744B (en)](/patent/CN121328744B/en) | 2026-04-07 | Dialogue content display method and related device based on multi-agent cooperation |
| [CN111125449B (en)](/patent/CN111125449B/en) | 2020-11-13 | Object information storage method, device and storage medium |

## Legal Events

| Date | Code | Title | Description |
| --- | --- | --- | --- |
| 2010-11-16 | AS | Assignment | **Owner name**: INTERNATIONAL BUSINESS MACHINES CORPORATION, NEW Y  **Free format text**: ASSIGNMENT OF ASSIGNORS INTEREST;ASSIGNORS:HUANG, YING;LIU, YING;ZHAO, WEI;AND OTHERS;REEL/FRAME:025368/0061  **Effective date**: 20101026 |
| 2015-03-25 | STCF | Information on status: patent grant | **Free format text**: PATENTED CASE |
| 2018-12-03 | FEPP | Fee payment procedure | **Free format text**: MAINTENANCE FEE REMINDER MAILED (ORIGINAL EVENT CODE: REM.); ENTITY STATUS OF PATENT OWNER: LARGE ENTITY |
| 2019-05-20 | LAPS | Lapse for failure to pay maintenance fees | **Free format text**: PATENT EXPIRED FOR FAILURE TO PAY MAINTENANCE FEES (ORIGINAL EVENT CODE: EXP.); ENTITY STATUS OF PATENT OWNER: LARGE ENTITY |
| 2019-05-20 | STCH | Information on status: patent discontinuation | **Free format text**: PATENT EXPIRED DUE TO NONPAYMENT OF MAINTENANCE FEES UNDER 37 CFR 1.362 |
| 2019-06-25 | FP | Expired due to failure to pay maintenance fee | **Effective date**: 20190414 |
