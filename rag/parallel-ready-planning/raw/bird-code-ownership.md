<!-- 出典: https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/bird2011dtm.pdf | 取得日: 2026-07-15 | 取得方法: MarkItDown（著者所属元PDF、bytes確認） | 確度: 高（ESEC/FSE 2011査読論文） -->

Don’t Touch My Code!
Examining the Effects of Ownership on Software Quality
Christian Bird Nachiappan Nagappan Brendan Murphy
MicrosoftResearch MicrosoftResearch MicrosoftResearch
cbird@microsoft.com nachin@microsoft.com bmurphy@microsoft.com
Harald Gall Premkumar Devanbu
UniversityofZurich UniversityofCalifornia,Davis
gall@ifi.uzh.ch ptdevanbu@ucdavis.edu
ABSTRACT our knowledge, the effect of ownership has not been stud-
iedindepthincommercialcontexts. Basedonourobserva-
Ownership is a key aspect of large-scale software develop-
tionsanddiscussionswithprojectmanagers,wesuspectthat
ment. We examine the relationship between different own-
whenthereisnoclearpointofcontactandthecontributions
ership measures and software failures in two large software
toasoftwarecomponentarespreadacrossmanydevelopers,
projects: Windows Vista and Windows 7. We find that
thereisanincreasedchanceofcommunicationbreakdowns,
in all cases, measures of ownership such as the number of
misaligned goals, inconsistent interfaces and semantics, all
low-expertise developers, and the proportion of ownership
leading to lower quality.
for the top owner have a relationship with both pre-release
Interestingly, unlike some aspects of software which are
faults and post-release failures. We also empirically iden-
known to be related to defects such as dependency com-
tify reasons that low-expertise developers make changes to
plexity, or size, ownership is something that can be delib-
componentsandshowthattheremovaloflow-expertisecon-
erately changed by modifying processes and policies. Thus,
tributionsdramaticallydecreasestheperformanceofcontri-
the answer to the question: “How much does ownership af-
bution based defect prediction. Finally we provide recom-
fectquality?”isimportantasitisactionable. Managersand
mendations for source code change policies and utilization
team leads can make better decisions about how to govern
of resources such as code inspections based on our results.
a project by knowing the answer. If ownership has a big
effect,thenpoliciestoenforcestrongcodeownershipcanbe
CategoriesandSubjectDescriptors
put into place; managers can also watch out for code which
D.2.8 [Software Engineering]: Metrics—Process metrics is contributed by developers who have inadequate relevant
priorexperience. Ifownershiphaslittleeffect,thenthenor-
malbottlenecksassociatedwithhavingonepersonincharge
GeneralTerms
of eachcomponent canbe removed, andavailable talent re-
Measurement, Management, Human Factors assigned at will.
We have observed that many industrial projects encour-
Keywords agehighlevelsofcodeownership. Inthispaper,weexamine
ownershipandsoftwarequality. Wemakethefollowingcon-
EmpiricalSoftwareEngineering,Ownership,Expertise,Qual- tributions in this paper:
ity
1. Wedefineandvalidatemeasuresofownershipthatare
1. INTRODUCTION related to software quality.
Many recent studies [6,9,26,29] have shown that hu- 2. Wepresentanindepthquantitativestudyoftheeffect
manfactorsplayasignificantroleinthequalityofsoftware ofthesemeasuresofownershiponpre-releaseandpost-
components. Ownership is a general term used to describe release defects for multiple large software projects.
whether one person has responsibility for a software com-
3. We identify reasons that components have many low-
ponent, or if there is no one clearly responsible developer.
expertise developers contributing to them.
Within Microsoft, we have found that when more people
work on a binary, it has more failures [5,26]. However, to 4. We propose recommendations for dealing with the ef-
fects of low ownership.
2. THEORY&RELATEDWORK
Permissiontomakedigitalorhardcopiesofallorpartofthisworkfor
personalorclassroomuseisgrantedwithoutfeeprovidedthatcopiesare A number of prior studies have examined the effect of
notmadeordistributedforprofitorcommercialadvantageandthatcopies developer contribution behavior on software quality.
bearthisnoticeandthefullcitationonthefirstpage.Tocopyotherwise,to Rahman & Devanbu [30] examined the effects of owner-
republish,topostonserversortoredistributetolists,requirespriorspecific ship&experienceonqualityinseveralopen-sourceprojects,
permissionand/orafee.
using a fine-grained approach based on fix-inducing frag-
ESEC/FSE’11,September5–9,2011,Szeged,Hungary.
ments of code, and report findings similar to those of our
Copyright2011ACM978-1-4503-0443-6/11/09...$10.00.

paper. However, they operationalize ownership differently, experienceofadeveloperhistory(bycountingpriorchanges)
andownershippoliciesandpracticesinOSSandcommercial and they were significant in prediction.
software are quite different. Thus the similarity of effect is In a study of offshoring and succession in software devel-
striking. Furthermore,Rahman&Devanbudonotstudythe opment[21],Mockusevaluatedanumberofsuccessionmea-
relationshipofminorcontributiononsoftwaredependencies; sures with the goal of being able to automatically identify
nor do they consider social network measures. mentors for developers working on a per-component basis.
Weyukeret al.[35],examinedtheeffectofincludingteam Asuccessionmeasurebasedonownershipwasabletoaccu-
size in prediction models. They use a count of the develop- rately pinpoint the most likely method and was used in a
ersthatworkedoneachcomponent,butdonotexaminethe large scale study evaluating the factors affecting productiv-
proportionofwork,whichweaccountfor. Theyfoundaneg- ity in project succession and offshoring.
ligible increase in failure prediction accuracy when adding Research in other domains, such as manufacturing, has
team size to their models. We differ in that we examine found that when a worker performs a task repeatedly, the
the proportion of contributions made by each developer to laborrequirementstocompletesubsequentworkinthesame
a component. Further, we are not interested in prediction, task decreases and the quality increases [11]. Software de-
but rather determining if there is a statistically significant velopmentdiffersfromthesedomainsinthatworkersdonot
relationship between ownership and failures. perform the exact same task repeatedly. Rather, software
Similarly, Meneely and Williams examined the relation- development represents a form of constant problem solving
ship of the number of developers working on parts of the inwhichtasksarerarelyexactlythesame,butmaybesim-
Linux kernel with security vulnerabilities [19]. They found ilar. Nonetheless, developers gain project and component
thatwhenmorethanninedeveloperscontributetoasource specific knowledge as they repeatedly perform tasks on the
file, it is sixteen times more likely to include a security vul- same systems [32]. Banker et al. found that increased ex-
nerability. perience increases a developer’s knowledge of the architec-
NewmethodssuchasExtremeProgramming(XP)[4]pro- turaldomainofthesystem[1]. Repeatedlyusingaparticu-
fess collective code ownership but there has been little em- lar API, or working on a particular system creates episodic
pirical evidence or backing of this data on reasonably ma- knowledge. Robillard indicates that the lack of such knowl-
ture/complexorlargesystems. Ourstudyisthefirsttoem- edge negatively affects the quality of software [31]. Indeed,
pirically quantify the effect code owners (and low-expertise BasiliandCaldierapresentanapproachforimprovingqual-
contributors) have on the overall code quality. ityinsoftwaredevelopmentthroughlearningandexperience
Domain,application,andevencomponent-specificknowl- by establishing“experience factories”[2]. They claim that
edge are important aids for helping developers to maintin by reusing knowledge, products, and experience, companies
highqualitysoftware. Bohet al.foundthatprojectspecific can maintain high quality levels because developers do not
expertise has a much larger impact on the time required to need to constantly acquire new knowledge and expertise as
performdevelopmenttasksthanhighlevelsofdiverseexpe- they work on different projects. Drawing on these ideas,
rience inunrelatedprojects[7]. Inaqualitativestudy of 17 we develop ownership measures which consider the number
commercial software projects, Curtis et al. [10] found that of times that a developer works on a particular component,
“the thin spread of application domain knowledge”was one with the idea that each exposure is a learning experience
ofthetopthreesalientproblems. Theyalsofoundthatone and increases the developer’s knowledge and abilities.
common trait among engineers categorized as“exceptional” there is a knowledge-sharing factor at play as well. The
wasthattheyhaddeepdomainknowledge,andunderstood set of developers that contribute to a component implicitly
how the system design would generate the system behavior formateamthathassharedknowledgeregardingtheseman-
customers expected, even under exceptional circumstances. tics and design of the component. Coordination is a known
Such knowledge is not easily obtained. One systems engi- problem in software development [16]. In fact, another of
neerexplained,“Someonehadtospendahundredmillionto the top three problems identified in Curtis’ study [10] was
put that knowledge in my head. It didn’t come free.” “communication and coordination breakdowns.” Working
Thequestionnaturallyarises,howcanwedeterminewho in such a group always creates a need for sharing and in-
has such domain knowledge? Fortunately, there is a wealth tegrating knowledge across all members [8]. Cataldo et al.
of literature that uses the prior development activity on a showed that communication breakdowns delay tasks [9]. If
component as a proxy for expertise and knowledge with re- a member of this team devotes little attention to the team
spect to the component. As examples Expertise Browser and/orthecomponent,theymaynotacquiretheknowledge
from Mockus et al. [22] and Expertise Recommender from required to make changes to the component without error.
McDonald and Ackerman [18] both use measures of the We attempt to operationalize these team members in this
amount of work that a developer has performed on a soft- paper and examine their effect on quality.
ware component to recommend component experts. Fritz Ifownershipofaparticularcomponentinasystem(whether
et al. found that the ability of a developer to answer ques- it be a file, class, module, plugin, or subsystem) is a valid
tions about a piece of code in a system was strongly deter- proxy for expertise, then what is the effect of having most
mined by whether the developer had authored some of the changes made by those with little expertise? Is it better
code, and how much time was spent authoring it [15]. to have one clear owner of a software component? We op-
MockusandWeissusedpropertiesofanindividualchange erationalize ownership in two key ways here and formally
to predict the probability of that change causing a fail- defineourmeasuresinsection3. Onemeasureofownership
ure [23]. They found that changes made by developers that is how much of the development activity for a component
weremoreexperiencedwithapieceofcodewerelesslikelyto comes from one developer. If one developer makes 80% of
inducefailure. Threeoftheirfourteenmeasurescapturethe the changes to a component, then we say that the compo-
nent has high ownership. The other way that we measure

•  !"#$%&'$#(%")*($%)0)1)2"+%$)#%+($"34(%$)(%).)#%25%+-+()"&).)#%+($"34(%$)67%&-)%6+-$&7"5)"&).()
%$)3-/%6)89:));7"&)(7$-&7%/,)6.&)#7%&-+)3.&-,)%+)-<.2"+.("%+)%'),"&($"34("%+&)%')%6+-$&7"5=)
34().)+423-$)%')(7$-&7%/,)>./4-&)$.+?"+?)'$%2)@9)(%)AB9).//)C"-/,"+?)&"2"/.$)$-&4/(&:)
•  !+,$%&'$#(%")*($%)0)1)2.D%$)#%+($"34(%$)(%).)#%25%+-+()"&).)#%+($"34(%$)67%&-)%6+-$&7"5)"&)
.3%>-)89:)
E"(7)(7-&-)(-$2&),-'"+-,)6-)+%6)"+($%,4#-)%4$)2-($"#&).+,),"&#4&&)(7-)"+(4"("%+)3-7"+,)(7-2:)))
|     |     | •   | F423-$)%')!"+%$)*%+($"34(%$&)G!-./0H)                                                |     |     |     |     |     |     |     |     |     |     |
| --- | --- | --- | ------------------------------------------------------------------------------------ | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|     |     | •   | F423-$)%')!.D%$)*%+($"34(%$&)G!12/0H)                                                |     |     |     |     |     |     |     |     |     |     |
|     |     | •   | ;%(./)F423-$)%')*%+($"34(%$&)G3/314H)                                                |     |     |     |     |     |     |     |     |     |     |
|     |     | •   | I$%5%$("%+)%')J6+-$&7"5)'%$)(7-)#%+($"34(%$)(7.()2.K-&)(7-)2%&()#%22"(&)G/5.6078-9H) |     |     |     |     |     |     |     |     |     |     |
)
Figure1: Graphofthepr!o"#p$o%&r'(t')i'o*n%+,o-f'.c/'o,%m.,m.%i0"t.s1't.o/'2.a3b3oc"04a'0m.p'+.5.d2l.l3,b67y88'd59e'7v&e:l&o8.p,e&r%4s'7d$%u"1r#i'n;"g40+t'7h&e:&V8.i,s3t&a10d'2e9v28&e6l'opmentcycle,showingthe
| four measures |     | of ownership | used | in this | paper. |     |     |     |     |     |     |     |     |
| ------------- | --- | ------------ | ---- | ------- | ------ | --- | --- | --- | --- | --- | --- | --- | --- |
L"?4$-) A) &7%6&) (7-) 5$%5%$("%+) %') #%22"(&) '%$) -.#7) %') (7-) ,->-/%5-$&) (7.() #%+($"34(-,) (%)
daebtoecrmominpi.ndgllh o"w+)Em"+a,n%y6&l)oMw"&-(e.x=)p"+e),rt-i#s$e-.d&"e+-?)%$,-$:));7"&)/b"3e$.t$rCa)7c.e,d).b)(a%c(k./)t%o')NaAOs)p#%e2ci2fic"(&c)2om.,p-o)nent
| ownership | is by |     |     |     |     |     |     |     |     |     |     |     | and software |
| --------- | ----- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ------------ |
work,in4g$"+o?n)(7a-)c,o-m>-p/%o5n2e-n+t(.)#CIf#/-m:)a);n7y-)d(%e5v)e#l%o+p($e"r3s4("+?)-+?"+--$c)h2a.n,g-)ePsQfNr)o#m%2d2e"v(&e=l)o$%p4e?r7s/Cc)aRnA9a:l)s)oL"b>-e)tracedtoacompo-
velopers are
-+?"+--$&)2.,-).()/-.&()89)%')(7-)#%22"(&)G.()/-.&()RS)#%22"(&H:));6-/>-)-+?"+--$&)2.,-)/-&&)(7.+)89)
are all making few changes to a component, then there are nent. In Windows, a component is a compiled binary.
%')(7-)#%22"(&)G/-&&)(7.+)RS)#%22"(&H:))L"+.//C=)(7-$-)6-$-).)(%(./)%')&->-+(--+)-+?"+--$&)(7.()2.,-)
| many non-experts |     | working | on             | the component     |                                                     | and we label |     |     |     |     |     |     |     |
| ---------------- | --- | ------- | -------------- | ----------------- | --------------------------------------------------- | ------------ | --- | --- | --- | --- | --- | --- | --- |
|                  |     | # % 2 2 | "( &)( % ) (7- | )3 "+ . $ C : )); | 74 &=)%4$)2-($"#&)'%$).3%#%25:,//).$-•T)Contributor |              |     |     |     |     |     |     |     |
the component as h a v in g l o w o w n e r s h ip . – A contributor to a software com-
|           |      |        |     |               |     |                     | ponent        | is someone |     | who | has made | commits/software |     |
| --------- | ---- | ------ | --- | ------------- | --- | ------------------- | ------------- | ---------- | --- | --- | -------- | ---------------- | --- |
| We expect | that | having | one | clear “owner” |     | for a co<m&p0o%-"2' | ;+8$&'changes |            |     |     |          |                  |     |
to the component.
| nent will | lead | to fewer | failures | and that | when | man!yUFnJoVn)- |     |     |     |     |     |     |     |
| --------- | ---- | -------- | -------- | -------- | ---- | -------------- | --- | --- | --- | --- | --- | --- | --- |
8)
experts are making changes, indicating that owner!sh1iWpJVi)s A@•) ProportionofOwnership– Theproportionofown-
spread across many contributors, the component will have ership (or simply ownership) of a contributor for a
more failures. particular component is the ratio of number of com-
!"#$%&%'()*%+'",-+("./) mits that the contributor has made relative to the to-
|     |     |     |     |     |     |     | tal number |     | of commits | for | that | component. | Thus, if |
| --- | --- | --- | --- | --- | --- | --- | ---------- | --- | ---------- | --- | ---- | ---------- | -------- |
3. TERMINOLOGYANDMETRICS
Cindyhasmade20commitstoie9.dllandthereare
We adopt Basili’s goal question metric approach [3] to a total of 100 commits to ie9.dll then Cindy has an
frame our study of ownership. Our goal is to understand ownership of 20%.
| therelationshipbetweenownershipandsoftwarequality. |     |     |     |     |     | We  |     |     |     |     |     |     |     |
| -------------------------------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
alsohopetogainanunderstandingofhowthisrelationship • Minor Contributor – A developer who has made
changestoacomponent,butwhoseownershipisbelow
| varieswiththedevelopmentprocessinuse. |          |         |          |             | Achievementof |           |       |            |     |       |             |     |             |
| ------------------------------------- | -------- | ------- | -------- | ----------- | ------------- | --------- | ----- | ---------- | --- | ----- | ----------- | --- | ----------- |
|                                       |          |         |          |             |               |           | 5% is | considered | a   | minor | contributor | to  | that compo- |
| this goal                             | can lead | to more | informed | development |               | decisions |       |            |     |       |             |     |             |
orpossiblyprocesspolicychangesresultinginsoftwarewith nent. Thisthresholdwaschosenbasedonexamination
ownership1.
| fewer defects. |     |     |     |     |     |     | of distributions |     | of  |     |     | We refer | to a commit |
| -------------- | --- | --- | --- | --- | --- | --- | ---------------- | --- | --- | --- | --- | -------- | ----------- |
In order to reach this goal, we ask a number of specific from a minor contributor as a minor contribution.
questions:
|     |     |     |     |     |     |     | • Major | Contributor |     | –   | A developer | who | has made |
| --- | --- | --- | --- | --- | --- | --- | ------- | ----------- | --- | --- | ----------- | --- | -------- |
1. Arehigherlevelsofownershipassociatedwithlessde-
|     |     |     |     |     |     |     | changes | to  | a component |     | and whose | ownership | is at or |
| --- | --- | --- | --- | --- | --- | --- | ------- | --- | ----------- | --- | --------- | --------- | -------- |
fects?
above5%isamajorcontributortothecomponentand
|     |     |     |     |     |     |     | a commit | from | such | a developer |     | is a major | contribu- |
| --- | --- | --- | --- | --- | --- | --- | -------- | ---- | ---- | ----------- | --- | ---------- | --------- |
2. Isthereanegativeeffectwhenasoftwareentityisde-
tion.
| veloped | by  | many | people | with low | ownership? |     |     |     |     |     |     |     |     |
| ------- | --- | ---- | ------ | -------- | ---------- | --- | --- | --- | --- | --- | --- | --- | --- |
3. Are these effects related to the development process Notethatweexaminethenumberofchanges toacompo-
nentmadebyadeveloperratherthantheactualnumberof
used?
|     |     |     |     |     |     |     | lines modified. | Within |     | Windows, | each | change | corresponds |
| --- | --- | --- | --- | --- | --- | --- | --------------- | ------ | --- | -------- | ---- | ------ | ----------- |
Inordertoanswerthesequestions,weproposeanumberof to one fix or enhancement and individual changes are quite
ownershipmetricsandusethemtoevaluateourhypotheses
|               |      |            |             |      |           |        | small, usually | on      | the order | of     | tens of    | lines. We      | use number |
| ------------- | ---- | ---------- | ----------- | ---- | --------- | ------ | -------------- | ------- | --------- | ------ | ---------- | -------------- | ---------- |
| of ownership. |      | We begin   | by defining | some | important | terms  |                |         |           |        |            |                |            |
|               |      |            |             |      |           |        | of changes     | because | each      | change | represents | an“exposure”of |            |
| and metrics   | used | throughout | the         | rest | of this   | paper: |                |         |           |        |            |                |            |
thedevelopertothecodeandbecausethepreviousmeasure
• Software Component – This is a unit of develop- 1 A sensitivity analysis with threshold values ranging from
ment that has some core functionality. Defects can 2% to 10% yielded similar results.

Ownership of A.dll by Developers
Ownership of B.dll by Developers
|     | (a) | A.dll     |           |        |                  |     |         | (b) B.dll |     |     |     |
| --- | --- | --------- | --------- | ------ | ---------------- | --- | ------- | --------- | --- | --- | --- |
|     |     | Figure 2: | Ownership | graphs | for two binaries | in  | Windows |           |     |     |     |
ofexperienceusedbyMockusandWeissalsousedthenum- Hypothesis1-Softwarecomponentswithmanyminorcon-
3
berofchanges. However,priorliterature[14]hasshownhigh tributors will have more failures than software components
| correlation(above0.9)betweennumberofchangesandnum- |     |     |     |     | that have | fewer. |     |     |     |     |     |
| -------------------------------------------------- | --- | --- | --- | --- | --------- | ------ | --- | --- | --- | --- | --- |
beroflinescontributedandwehavefoundsimilarresultsin
Wealsolookattheproportionofownershipforthehighest
| Windows, | indicating that our | results would | not change | sig- |     |     |     |     |     |     |     |
| -------- | ------------------- | ------------- | ---------- | ---- | --- | --- | --- | --- | --- | --- | --- |
contributingdeveloperforeachcomponent(Ownership).
nificantly. With these terms defined, we now introduce our If
Ownership
| metrics. |     |     |     |     |                   | is high, | that      | indicates | that | there      | is one devel- |
| -------- | --- | --- | --- | --- | ----------------- | -------- | --------- | --------- | ---- | ---------- | ------------- |
|          |     |     |     |     | oper who“owns”the |          | component |           | and  | has a high | level of ex-  |
• Minor – number of minor contributors pertise. Thispersoncanalsoactasasinglepointofcontact
|     |     |     |     |     | for others | who need | to  | use the | component, | need | changes to |
| --- | --- | --- | --- | --- | ---------- | -------- | --- | ------- | ---------- | ---- | ---------- |
• Major – number of major contributors it, or just have questions about it. We theorize that when
suchapersonexists,thesoftwarequalityishigherresulting
| • Total | – total number of | contributors |     |     | in fewer | failures. |     |     |     |     |     |
| ------- | ----------------- | ------------ | --- | --- | -------- | --------- | --- | --- | --- | --- | --- |
• Ownership–proportionofownershipforthecontrib-
|      |                             |              |     |     | Hypothesis | 2    | - Software | components |     | with            | a high level of |
| ---- | --------------------------- | ------------ | --- | --- | ---------- | ---- | ---------- | ---------- | --- | --------------- | --------------- |
| utor | with the highest proportion | of ownership |     |     |            |      |            |            |     |                 |                 |
|      |                             |              |     |     | ownership  | will | have fewer | failures   |     | than components | with            |
Figure 1 shows the proportion of commits for each of the lower top ownership levels.
3
developersthatcontributedtoabocomp.dllinWindows,in Ifthenumberofminorcontributorsnegativelyaffectssoft-
decreasing order. This library had a total of 918 commits ware quality, the next question to ask is, “Why do some
made during the development cycle. The top contributing binaries have so many minor contributors?” We have ob-
engineer made 379 commits, roughly 41%. Five engineers servedbothatMicrosoftandalsowithinOSSprojectssuch
| made at least    | 5% of the commits | (at least      | 46 commits). |       |           |               |     |      |        |             |            |
| ---------------- | ----------------- | -------------- | ------------ | ----- | --------- | ------------- | --- | ---- | ------ | ----------- | ---------- |
|                  |                   |                |              |       | as Python | and Postgres, |     | that | during | the process | of mainte- |
| Twelve engineers | made less         | than 5% of the | commits      | (less |           |               |     |      |        |             |            |
nance,featureaddition,orbugfixing,ownersofonecompo-
| than 46 commits).                    | Finally, there | were a total | of seventeen |     |                           |      |           |       |                          |     |                |
| ------------------------------------ | -------------- | ------------ | ------------ | --- | ------------------------- | ---- | --------- | ----- | ------------------------ | --- | -------------- |
|                                      |                |              |              |     | nent often                | need | to modify | other | components               |     | that the first |
| engineersthatmadecommitstothebinary. |                |              | Thus,ourmet- |     |                           |      |           |       |                          |     |                |
|                                      |                |              |              |     | reliesonorisrelieduponby. |      |           |       | Asasimpleexample,adevel- |     |                |
| rics for abocomp.dll                 | are:           |              |              |     |                           |      |           |       |                          |     |                |
opertaskedwithfixingmediaplaybackinInternetExplorer
mayneedtomakechangestothemediaplaybackinterfaceli-
Metric Value braryeventhoughthedeveloperisnotthedesignatedowner
|     |       |     |     |     | andhaslimitedexperiencewiththiscomponent. |     |     |     |     |     | Thisleads |
| --- | ----- | --- | --- | --- | ----------------------------------------- | --- | --- | --- | --- | --- | --------- |
|     | Minor | 12  |     |     |                                           |     |     |     |     |     |           |
to our hypothesis.
|     | Major | 5   |     |     |     |     |     |     |     |     |     |
| --- | ----- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|     | Total | 17  |     |     |     |     |     |     |     |     |     |
Ownership 0.41 Hypothesis 3 - Minor contributors to components will be
|               |     |     |     |     | Major contributors |            | to            | other | components | that | are related |
| ------------- | --- | --- | --- | --- | ------------------ | ---------- | ------------- | ----- | ---------- | ---- | ----------- |
| 4. HYPOTHESES |     |     |     |     | through            | dependency | relationships |       |            |      |             |
Webeginwiththeobservationthatadeveloperwithlower Finally, if low-expertise contributions dohavealargeim-
expertise is more likely to introduce bugs into the code. A pactonsoftwarequality,thenweexpectthatdefectpredic-
developer who has made a small proportion of the commits tiontechniqueswillbeaffectedbytheirinclusionorremoval.
to a binary likely has less expertise and is more likely to Wethereforereplicatepriordefectpredictiontechniquesand
make an error. We expect that as the number of develop- compareresultswhenusingalldata,dataderivedonlyfrom
ers working on a component increases, the component may changes by minor contributors and, and data derived only
become“fragmented”andthedifficultyofvettingandcoor- from changes to major contributors. We expect that when
dinating all these minor contributions becomes an obstacle datafromminorcontributorsisremoved,thequalityofthe
to good quality. Thus if Minor is high, quality suffers. defect prediction will suffer.

Windows Vista Windows 7
Pre-release Post-release Pre-release Post-release
Category Metric
Failures Failures Failures Failures
Total 0.84 0.70 0.92 0.24
Ownership Minor 0.86 0.70 0.93 0.25
Metrics Major 0.26 0.29 -0.40 -0.14
Ownership -0.49 -0.49 -0.29 -0.02
Size 0.75 0.69 0.70 0.26
“Classic”
Churn 0.72 0.69 0.71 0.26
Metrics
Complexity 0.70 0.53 0.56 0.37
Table 1: Bivariate Spearman correlation of ownership and code metrics with pre- and post-release failures in Windows Vista
andWindows7. AllcorrelationsarestatisticallysignificantexceptforthatofOwnershipandpost-releasefailuresinWindows
7.
Hypothesis4-Removalofminorcontributioninformation 5.1 AnalysisTechniques
fromdefectpredictiontechniqueswilldecreaseperformance Weuseanumberofmethodstoexaminetherelationship
dramatically. between ownership and software quality.
We began with a correlation analysis of both pre- and
post-release failures with each of the ownership metrics as
5. DATACOLLECTIONANDANALYSIS wellasanumberofothermetricssuchastestcoverage,com-
plexity, size, dependencies, and churn (shown in Table 1).
Thisdatapresentsanopportunitytoinvestigatehypothe-
The results indicated that pre- and post-release defects in
ses regarding code ownership. In this study, we examine
hadstrongrelationshipswithMinor,Total,andOwner-
Windows Vista and Windows 7.
ship. Infact,Minorhadahighercorrelationwithbothpre-
Windows Vista and Windows 7 is developed entirely by
and post-release defects in Vista and pre-release defects in
Microsoft,whohaveprocessesandpoliciesthatfavorstrong
Windows 7 than any other metric that Microsoft collects!.
code ownership. Windows Vista and 7 were developed by
Post-release failures for Windows 7 present a difficulty for
2,000+ software developers and is composed of thousands
analysisasatthetimeofthisanalysismanybinarieshadno
ofindividualexecutablefiles(.exe),sharedlibraries(.dll),
post-release failures reported. Thus the correlation values
anddrivers(.sys),whichwecollectivelyrefertoasbinaries.
betweenmetricsandandpost-releasefailuresarenoticeably
We track the development history from the release of Win-
lower than the other failure categories (although all except
dows Server 2003 to the release of Windows 7 and include
thecorrelationwithOwnershiparestillstatisticallysignif-
pre-release defects as well as post-release failures in Vista
icant).
and 7 as software quality indicators.
However,wealsoobservedsomerelationshipbetweencode
We require several types of data. The most important
attributes and ownership metrics. For example, Figure 2
data are the commit histories and software failures. Soft-
shows data for two anonymized binaries in Windows with
ware repositories record the contents of every change made
vastly different ownership profiles. Unsurprisingly, the bi-
to a piece of software, along with the change author, the
time of change, and an associated log message that may be
nary depicted in Figure 2-b (B.dll) has more failures than
indicative of the type of change (e.g. introducing a feature,
the binary in Figure 2-a (A.dll), eight times as many pre-
releasefailuresandtwiceasmanypost-releasefailures. How-
or fixing a bug). We collected the number of changes made
byeachdevelopertoeachsourcefileandusedamappingof
ever,B.dllisalsoalargerbinaryandexperiencedfarmore
churn during the development cycle. Thus it is not clear
source files to binaries in order to determine the number of
whether the increase in failures is attributable to more mi-
changes made by each developer to each binary. Although
norcontributorsorothermeasuressuchassize,complexity,
the source code management system uses branches heavily,
andchurn,whichareknowntoberelatedtodefects[25,28]
weonlyrecordedchangesfromdevelopersthatwereeditsto
and are likely related to the number of minor contributors.
the source code. Branching operations (e.g. branching and
Prior research has shown that when characteristics such as
merging) were not counted as changes.
sizearenotconsidered,theymayaffectthevalidityofother
We also gathered both pre-release and post-release soft-
software metrics [13].
warefailuresforallthreeprojects. Wegatheredthefailures
Toovercomethisproblem,weusedmultiple linear regres-
recordedpriortoreleaseandinthefirstsixmonthsafterre-
sion. Linear regression, is primarily used in two different
lease. Because of the information contained in the failures,
ways. First, it can be used to make predictions about an
we can automatically trace them back to the binaries that
outcome based on prior data (for instance predicting how
caused them, but cannot reliably trace them to the source
manyfailuresasoftwarecomponentmayhavebasedonchar-
files that caused the failures. We only count failures that
acteristics of the components). We stress that while our re-
the development team deemed important enough to fix.
gressionanalysisdoesusefailuresasthedependentvariable
Finally, we gathered source code metrics including vari-
in our models, the purpose of this paper is not to predict
ous size, complexity, and churn metrics. This information
failures.
is gathered from both the source code repositories and the
Second, linear regression enables us to examine the effect
build process.

|     |      |                |       |     | Windows     |     | Vista        |     | Windows     | 7            |       |     |
| --- | ---- | -------------- | ----- | --- | ----------- | --- | ------------ | --- | ----------- | ------------ | ----- | --- |
|     |      |                | Model |     | Pre-release |     | Post-release |     | Pre-release | Post-release |       |     |
|     |      |                |       |     | Failures    |     | Failures     |     | Failures    | Failures     |       |     |
|     | Base | (code metrics) |       |     | 26%         |     | 29%          |     | 24%         | 18%          |       |     |
|     |      | Total          |       |     | 40%∗(+14%)  |     | 35%∗(+6%)    |     | 68%∗        | 21%∗         |       |     |
|     | Base | +              |       |     |             |     |              |     | (+35%)      |              | (+3%) |     |
Minor
|     | Base | +   |     |     | 46%∗(+20%) |     | 41%∗(+12%) |     | 70%∗ (+46%) | 21%∗ | (+3%) |     |
| --- | ---- | --- | --- | --- | ---------- | --- | ---------- | --- | ----------- | ---- | ----- | --- |
Base + Minor + Major 48%∗(+2%) 43%∗(+2%) 71%∗ (+1%) 22% (+1%)
Base + Minor + Major + Ownership 50%∗(+2%) 44%∗(+1%) 72%∗ (+1%) 22% (+0%)
Table2: Varianceinfailuresforthebasemodelwhichincludesstandardmetricsofcomplexity,size,andchurn,aswellasthe
models with Minor and Ownership added. An asterisk∗ denotes that a model showed statistically significant improvement
| when | the additional | variable | was added. |     |     |     |     |     |     |     |     |     |
| ---- | -------------- | -------- | ---------- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
Base+Minor
ofoneormorevariablesonanoutcomewhencontrollingfor which explains 46%. the model explains 20%
other variables. We use it for this purpose in an effort to more of the variance in pre-release failures than the Base
examine the relationship of our ownership measures when model. Addinganindependentvariabletoamodelcannever
controllingforsourcecodecharacteristicssuchassize, com- decrease the variance explained, so we use the adjusted R2
plexity, and churn. measure which penalizes models that have additional vari-
| Alinearregressionmodelforfailuresindicateswhichvari- |     |     |     |     |     | ables. |     |     |     |     |     |     |
| ---------------------------------------------------- | --- | --- | --- | --- | --- | ------ | --- | --- | --- | --- | --- | --- |
ables have an effect on failures, how large the effect is, in We built five statistical models of failures for pre- and
what direction (i.e. if failures go up when a metric goes post-releasedefectsinWindowsVistaandWindows7(sum-
up or when it goes down), and how much of the variance marizedinTable2). Thefirstmodelcontainsonlytheclas-
in the number of failures is explained by the metrics. We sical source code metrics: size, complexity, and churn. We
compare the amount of variance in failures explained by a refer to this as the base model. This model showed that
model that includes the ownership metrics to a model that churn, size, and complexity all have a statistically signifi-
does not include them. There are many measures of churn, cant effect on both pre and post-release failures. In addi-
complexity, and size. However, to avoid multi-collinearity tion, these metrics are able to explain 26% of the variance
andover-fitting,weincludeonlyoneofeachmeasureinthe inpre-releasefailuresand29%ofthevarianceinpost-release
model; We choose the measure which results in the best failures in Vista and 24% and 28% in Windows 7.
base model. This gives an indication of how much own- Inthesecondmodel,weaddedTotaltotheclassicvari-
ership actually affects software failures. We examined the ables. This examines the effect of team size on defects and
improvementinamountofvarianceinfailuresexplainedby doesnotincludeanymeasuresoftheproportionofcontribu-
the metrics (commonly referred to as the adjusted R2) and tionsmadebyindividualmembers. Allmodelsexhibitteda
examineimprovedgoodnessoffitusingF-teststodetermine statistically significant improvement in variance explained.
Minor
if the addition of an ownership metric improves the model Next, we added to the set of predictor variables
by a statistically significant degree [12]. in the base model. This was done to determine if the total
Linearregressionmodelscanbereliablyinterpretedifcer- number of developers has a different effect on quality than
tain assumptions hold. Two key assumptions are that the the number of minor contributors. The statistics showed
residuals are normally distributed, and not correlated with thatMinorispositivelyrelatedtobothpreandpost-release
any of the independent variables. In our analysis, we found failures to a statistically significant degree. The addition of
that the distribution of failures was almost always heavily Minor increased the proportion of variance in pre-release
right skewed, which led to a similar skew in the residuals. failures to 46% and post-release failures to 41%. The gains
Whenwetransformedthedependentvariabletobethelog shownbyMinorwerestrongerthanthoseshownbyTotal
ofthenumberoffailures,theskewdiminished,andtheresid- forbothtypesoffailurestoastatisticallysignificantdegree,
ualsfitthenormalityassumption. Thisdatatransformation in all cases except for post-release failures in Windows 7,
Minor
wasappliedtoalldependentvariablesexceptforpost-release indicating that has a larger effect on failures.
|     |     |     |     |     |     |     |     |     | Major | Ownership |     |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | ----- | --------- | --- | --- |
failures in Vista, where linear regression assumptions were The addition of and showed smaller
met by the raw data. gains,butwereoftenstillstatisticallysignificant. Wefound
|     |     |     |     |     |     | similar | results | regardless | of the            | order that | these     | variables |
| --- | --- | --- | --- | --- | --- | ------- | ------- | ---------- | ----------------- | ---------- | --------- | --------- |
|     |     |     |     |     |     | were    | added   | to the     | models. Ownership |            | was found | to have   |
6. RESULTS
anegativerelationshipwithfailurestoastatisticallysignifi-
We now present the results of our analysis of Windows cantdegreeandMajorhadapositiverelationship,butwas
Vista and Windows 7. Table 2 illustrates the results of much smaller than Minor. Minor still showed more of an
our analysis. We denote with an asterisk∗, cases where a effectthanOwnershipandMajorevenwhenitwasadded
| goodness-of-fit |     | F-test indicated | that the addition | of  | a vari- |                 |     |                                   |     |     |     |     |
| --------------- | --- | ---------------- | ----------------- | --- | ------- | --------------- | --- | --------------------------------- | --- | --- | --- | --- |
|                 |     |                  |                   |     |         | last(notshown). |     | Thefinalmodelsaccountforupto72%of |     |     |     |     |
ableimprovedthemodelbyastatisticallysignificantdegree. variance in failures. In all cases, ownership had a stronger
The value in parentheses indicates the percent increase in relationship with pre-release failures than post-release fail-
variance explained over the model without the added vari- ures and the models in general were less explanatory. This
|     |     |     | Base+Minor | +Major |     |     |     |     |     |     |     |     |
| --- | --- | --- | ---------- | ------ | --- | --- | --- | --- | --- | --- | --- | --- |
able. For example, in Table 2 the may indicate that there are already measures being taken
model in Vista explains 48% of the variance in pre-release (e.g. increasedtesting,morestringentqualitycontrols,etc.)
| failures | which | is 2% more | than the Base+Minor |     | model |     |     |     |     |     |     |     |
| -------- | ----- | ---------- | ------------------- | --- | ----- | --- | --- | --- | --- | --- | --- | --- |

betweenimplementationcompletionandreleasetocounter-
Major-Minor-Dependency Relationship
| act the              | effects of poor | ownership.                   |             |        |              |     |     |     |         |     |
| -------------------- | --------------- | ---------------------------- | ----------- | ------ | ------------ | --- | --- | --- | ------- | --- |
| For all              | metrics that    | measure                      | ownership   | levels | there is a   |     |     |     |         |     |
| clear trend          | of having       | a statistically              | significant |        | relationship |     |     |     |         |     |
|                      |                 | Inallcases,MajorandOwnership |             |        |              |     |     |     | Foo.exe |     |
| tofailuresinWindows. |                 |                              |             |        |              |     |     |     | r       |     |
|                      |                 | M i n o                      | r T o       | t a l  |              |     |     | j o |         |     |
s h o w le s s o f a n e ff e c t t h a n o r , i n d i c a t i n g t h a t M a utor
t h e n u m b e r o f h i g h e r -e x p er t i s e c o n t r i b u t o r s h a s m a r g i n a l r ib
on t
e ff e c t o n q u a l i t y , a l t h o u g h t h e r e s u l t s a r e s t i l l s t a t i s t i c a l l y C
Dependency
significant.
| The results | of our | analysis of | ownership | in  | both releases |     |     |     |     |     |
| ----------- | ------ | ----------- | --------- | --- | ------------- | --- | --- | --- | --- | --- |
Minor
| of Windows | can be interpreted | as  | follows: |     |     |     |     |     |     |     |
| ---------- | ------------------ | --- | -------- | --- | --- | --- | --- | --- | --- | --- |
Contributor
| 1. The | number of | minor contributors |     | has a | strong posi- |     |     |     |     |     |
| ------ | --------- | ------------------ | --- | ----- | ------------ | --- | --- | --- | --- | --- |
Bar.dll
tiverelationshipwithbothpre-andpost-releasefailures
| even | when controlling | for metrics |     | such as | size, churn, |     |     |     |     |     |
| ---- | ---------------- | ----------- | --- | ------- | ------------ | --- | --- | --- | --- | --- |
| and  | complexity.      |             |     |         |              |     |     |     |     |     |
2
2. Higher levels of ownership for the top contributor to Figure 3: Illustration of the major-minor-dependency rela-
a component results in fewer failures when controlling tionship commonly observed in Vista
Add graph rewiring slide around. ont op..
| for                                                                                | the same metrics, | but the       | effect | is smaller | than the |          |     |     |     |     |
| ---------------------------------------------------------------------------------- | ----------------- | ------------- | ------ | ---------- | -------- | -------- | --- | --- | --- | --- |
| number                                                                             | of minor          | contributors. |        |            |          |          |     |     |     |     |
| Ownershipahadsda sstroomngeer rtehlaotiuongshhitp bwuithbbprlee-rsel etaos ethe de |                   |               |        |            |          | v e lo p | e r |     |     |     |
3. C a ta ld o et al.found that making changes to a depending
failures than“I pnoset-eredle atsoe fuaisluere st.his...” component without coordinating with the other stakehold-
|     |     |     |     |     |     | ers (in our | case, the | owner) | of the component | increases the |
| --- | --- | --- | --- | --- | --- | ----------- | --------- | ------ | ---------------- | ------------- |
4. Measuresof“oI wnneereshdip taon dmstaankdear dac ocdheamneagsuer etsosh tohwat... which is used by this...”
a much smaller relationship to post-release failures in likelihood of faults [9]. We have no record of the communi-
|         |     |     |     |     |     | cation between | developers |     | of Windows. However, | the fact |
| ------- | --- | --- | --- | --- | --- | -------------- | ---------- | --- | -------------------- | -------- |
| Windows | 7.  |     |     |     |     |                |            |     |                      |          |
thataminorcontributorhas,bydefinition,madefewifany
|     |     |     |     |     |     | prior contributions |     | to a component | suggests | that their par- |
| --- | --- | --- | --- | --- | --- | ------------------- | --- | -------------- | -------- | --------------- |
7. EFFECTSOFMINORCONTRIBUTORS
ticipationinthecomponent’simplicitteamislikelyminimal,
Oneofthekeyfindingsinouranalysiswasthatthenum- increasing the risk of a introducing a bug.
berofminorcontributorshasastrongrelationshipwithfail- But does this actually happen? Is a developer D, work-
ures in both releases of Windows. Since Microsoft has the ing on binary Foo.exe, statistically more likely to be a mi-
capabilitytomakechangestopracticesbasedonthesefind- nor contributor to a binary Bar.dll, just because Foo.exe
ings, we were eager to gain a deeper understanding of this depends on Bar.dll? If so, how many of the minor con-
phenomenon. To this end, we performed two more detailed tributors to components can this phenomenon account for?
analysesinordertoexaminetheminorcontributorsfurther. If the majority of minor contributors are a result of com-
First, we observed that almost all developers were ma- ponent owners making changes do depending or dependent
jor contributors to some binaries and minor contributors to componentstoaccomplishtheirowntaskssuchasresolving
others; very few developers never played a major contrib- failures, then deliberate steps could be taken to avoid this
utor role. This led us to investigate the obvious question: type of risky behavior.
Given a particular developer, is there a relationship between To investigate this further, we employed a static analy-
a component to which she is a major contributor, and one sis tool, MaX [33], to detect dependency relationships be-
to which she is a minor contributor? tween binaries. MaX uses debugging information files that
Second, we adapted a fault prediction study carried out are generated during compilation to identify these relation-
by Pinzger et al. [29] and examined the effect of modifying ships, which include method calls, read and writes to the
the study in ways related to ownership. registry,IPC,COMcalls,anduseoftypes. Wewereunable
|     |     |     |     |     |     | to obtain | the required | debugging | information | files for Win- |
| --- | --- | --- | --- | --- | --- | --------- | ------------ | --------- | ----------- | -------------- |
7.1 DependencyAnalysis
|     |     |     |     |     |     | dows7andthuslimitouranalysisheretoVista. |     |     |     | Usingthis |
| --- | --- | --- | --- | --- | --- | ---------------------------------------- | --- | --- | --- | --------- |
The majority of developers that contributed to Windows tool, we constructed a dependency graph that includes all
actedasmajorcontributorstosomebinariesandminorcon- of the binaries in Windows Vista.
tributorstoothers. Therewereveryfewdeveloperswhoare The next step is to determine whether the major-minor-
onlyminorcontributors. Thisfactisanindicationofstrong dependencyphenomenonoccursstatisticallymoreoftenthan
codeownership,asitshowsthatnearlyeveryonehasamain would be expected by chance. But what exactly does“by
responsibility for at least one binary. chance”mean? We model“chance”by generating a large,
DiscussionswithengineersatMicrosoftindicatedthatof- plausible,randomsampleofcontributions;wecanthencom-
ten an engineer who was the owner of one binary would paretheobservedfrequencyofmajor-minor-dependencywith
make changes to another binary whose services he or she the frequency in the generated sample. Our plausible ran-
used, often in the process of addressing reported bugs. In dom model is that each developer chooses their contribu-
our context this would show up as one engineer who was tions at random, while preserving their rate of minor and
a major contributor to some binary, A, and a minor con- major contributions. In other words, a developer is just as
tributor to some binary, B, with a dependency relationship hardworking, but her choice of where to contribute is not
between A and B. We call this a Major-Minor-Dependency influenced by dependencies in the code. Using this model,
relationship, which is illustrated in Figure 3. wegeneratealargesampleofsimulatedcontributiongraphs.

|     |     |     |     |     |     |     | the normally  | distributed |     | frequency | of this      | phenomenon | out  |
| --- | --- | --- | --- | --- | --- | --- | ------------- | ----------- | --- | --------- | ------------ | ---------- | ---- |
|     |     |     |     |     |     |     | of all 10,000 | graphs      | was | 32%       | of the time, | indicating | that |
minor 52% is definitely a statistically significant difference, and
| Amy |     | C   |     | Amy |     | C   |                |     |         |               |     |          |          |
| --- | --- | --- | --- | --- | --- | --- | -------------- | --- | ------- | ------------- | --- | -------- | -------- |
|     |     |     |     |     | or  |     | the phenomenon |     | that we | are observing |     | does not | occur by |
n
|     |     |     |     |     | mi  |     | chance.   |     |        |        |                  |     |         |
| --- | --- | --- | --- | --- | --- | --- | --------- | --- | ------ | ------ | ---------------- | --- | ------- |
|     |     |     |     |     |     |     | In Vista, | one | common | reason | that a developer | is  | a minor |
m
|     |     |     |     |     | in  |     | contributortoabinaryisthathe/sheisamajorcontributor |     |              |        |     |           |           |
| --- | --- | --- | --- | --- | --- | --- | --------------------------------------------------- | --- | ------------ | ------ | --- | --------- | --------- |
|     |     |     |     |     | o   | r   | to a depending                                      |     | binary. This | allows | for | processes | to be put |
minor
Bob D Bob D into place to recognize and either minimize or aid minor
contributions.
|        | (a)   | before       |          |           | (b) after |      | 7.2 EffectsonNetworkMetrics |         |        |          |          |     |            |
| ------ | ----- | ------------ | -------- | --------- | --------- | ---- | --------------------------- | ------- | ------ | -------- | -------- | --- | ---------- |
|        |       |              |          |           |           |      | In 2007,                    | Pinzger | et al. | reported | a method | to  | find fault |
| Figure | 4: An | illustration | of graph | rewiring. | Rewiring  | pre- |                             |         |        |          |          |     |            |
serves the number of minor and major edges per developer pronebinariesinWindowsVistabasedoncontributionnet-
andperbinary,butrandomizestheorganizationofthecon- works [29]. A contribution network is composed of binaries
tribution network. andthedevelopersthatcontributedtothosebinaries. Thus,
|     |     |     |     |     |     |     | a node representing |           | a developer |            | is connected | to all            | binaries |
| --- | --- | --- | --- | --- | --- | --- | ------------------- | --------- | ----------- | ---------- | ------------ | ----------------- | -------- |
|     |     |     |     |     |     |     | the developer       | has       | contributed | to         | and a        | node representing | a        |
|     |     |     |     |     |     |     | binary is           | connected | to all      | developers | that         | contributed       | to it.   |
This gives us a basis for comparison to evaluate observed, Figure 5 shows an example of a contribution network with
real-worldcontributionbehaviorisinfluencedbydependen- boxesrepresentingbinariesandcirclesrepresentingdevelop-
cies between modules. ers. Majorcontributionedgesaresolidandminorcontribu-
This “bootstrapping” approach comes from the statisti- tion edges are dashed.
cal theory of random graphs [20,24,27]. A phenomenon is Thefieldofsocialnetworkanalysishasdevelopedanum-
judged statistically significant if the actual, observed phe- berofmetricsthatmeasurevariousattributesofnodesina
nomenonoccursrarelyinthegeneratedsamplegraphs. Fol- network. For instance, the degree of a node is the number
lowing previous techniques [24,27], we use a graph-rewiring of direct connections that it has and can be indicative of
methodtobootstrapourrandomensemble,basedontheob- how important the node is within the local network. Other
served frequency of commits from individuals. In each gen- metrics measure how much information can flow through a
eratedrandomsample,eachdevelopermakesthesamenum- node, the average distance from a node to all other nodes,
berofmajorandminorcontributionsasintheobservedreal howmuch“power”anodeexertsoveritsneighbors,etc. An
sample,butthecontributionsarechosenatrandomfromthe in-depthdiscussionofthesemetricscanbefoundinWasser-
given set of components. We check to see how often a“ma- man and Faust [34]. Pinzger et al. found that these mea-
jorly contributed component”for a developer has an actual sures had a strong relationship with post-release failures in
dependency on a“minorly contributed component”for the WindowsVistaandinapriorstudy[6]wefoundthatthese
measureswereabletopredictfailuresinEclipseaccurately
| same                                                  | developer | in these | generated | random | samples. | If the |          |     |     |     |     |     |     |
| ----------------------------------------------------- | --------- | -------- | --------- | ------ | -------- | ------ | -------- | --- | --- | --- | --- | --- | --- |
| frequencyofmajor-minor-dependencyrelationshipsthatoc- |           |          |           |        |          |        | as well. |     |     |     |     |     |     |
curintheensembleofsimulatedsamplesdifferssignificantly Specifically,Pinzgeret al.builtapredictorforfaultprone
fromthatoftheobservedrealsample,thenwecanconclude binaries using this method, it identified 90% of the fault
that the phenomenon most likely represents some real, in- pronebinariesinVista(recall)and85%ofthebinariesthat
tended behavior, and not simply a chance occurrence. it classified as fault prone actually were (precision). This
Graph rewiring is performed as follows in our context. was a dramatic increase over the predictive power of prior
Forthesakeofconveniencewerefertoanedgeconnectinga methods that used source code metrics.
binarytooneofitsmajorcontributorsasamajor edge and Weadaptedthatstudy,andexaminedtheeffectofremov-
anedgeconnectingabinarytooneifitsminorcontributors ing minor and major contributor edges. In Figure 5, such
asaminoredge. Twoedgesthatareeitherbothmajoredges minoredgesareindicatedbythedashedlines. Thetopolog-
or both minor edges are selected at random and endpoints icaleffectofremovingminoredges,asshowninFigure5,is
of both are switched as shown in Figure 4. Thus, after the thatmanypairsofbinariesthathadshortconnectingpaths
switch, the number of major and major contributions for through minor contributors are disconnected. Our findings
each developer node and each component node remains the focused on two key aspects of the results. First, we exam-
same. ined the correlation between social network measures and
After performing E2 rewirings where E is the number post-release failures in the complete network and the net-
of contribution edges in the graph, a sufficiently random work with minor edges removed. Second, we measured the
graph is obtained. We created 10,000 such random contri- change in the ability of a predictor to identify fault prone
butiongraphsandcomparedthefrequencyofmajor-minor- binarieswhenremovingmajor or minorcontributionedges.
dependency relationships to the frequency in the observed, Table 3 shows the strength of relationship of six network
actual contribution graph. We found that in the observed measureswithpre-andpost-releasefailures. Theseparticu-
Vista contribution graph, 52% of the binaries had minor larmetricsarechosenbecausetheyhadthehighestcorrela-
contributors who were major contributors to other binaries tion with failures among those collected. Columns labelled
that the original had a dependency with. In contrast, this withMinorshowsthecorrelationsofSNAmetricscalculated
relationship only existed for an average of 24% of the bina- onnetworksthatcontainonlyminorcontributionedgesand
riesintherandomnetworkswiththesameminorandmajor thoselabelledwithMajorshowscorrelationsfromnetworks
contribution degree distributions. The maximum value for ofmajorcontributionedges. Forallmetricsexceptfornode

|     |     |        |     |     |             | Windows | Vista        |       |       |             | Windows | 7            |       |     |     |
| --- | --- | ------ | --- | --- | ----------- | ------- | ------------ | ----- | ----- | ----------- | ------- | ------------ | ----- | --- | --- |
|     |     |        |     |     | Pre-release |         | Post-release |       |       | Pre-release |         | Post-release |       |     |     |
|     | SNA | Metric |     |     | Minor       | Major   | Minor        | Major | Minor |             | Major   | Minor        | Major |     |     |
Degree Centrality 0.861 0.909 0.668 0.599 0.931 0.797 0.269 0.319
Closeness Centrality 0.624 -0.098 0.602 0.107 0.737 0.167 0.130 0.013
Reachability 0.647 -0.091 0.618 0.119 0.747 0.176 0.135 0.018
Betweenness Centrality 0.703 0.146 0.601 0.132 0.748 0.285 0.289 0.154
Hierarchy 0.420 -0.273 0.176 -0.244 0.298 -0.302 0.136 -0.055
Effective Size 0.775 0.311 0.649 0.286 0.884 0.391 0.223 0.196
Table 3: Correlation of Social Network Analysis metrics on the contribution network with pre- and post-release failures.
Columnslabeled“Minor”arecorrelationsoffailureswithmetricscomputedonnetworkscomposedonlyofminorcontribution
edges. Columns labeled ”Major”are from networks made up of major contribution edges. For the majaority of metrics,
removingtheminoredgesdropsthecorrelationsconsiderably. Forsomemetrics,thedirectionofcorrelationactuallychanges
for“Major”.
|     |     |     |     |     |     |     |     | using the | same | methods |     | on the network | with | minor | con- |
| --- | --- | --- | --- | --- | --- | --- | --- | --------- | ---- | ------- | --- | -------------- | ---- | ----- | ---- |
Ram A tributors removed, it identified only 58% of the fault prone
|     |     |     |     |     |     |     |      | binaries   | and                                            | around       | 44%       | of its fault    | prone predictions |                | were      |
| --- | --- | --- | --- | --- | --- | --- | ---- | ---------- | ---------------------------------------------- | ------------ | --------- | --------------- | ----------------- | -------------- | --------- |
|     |     |     |     |     |     |     |      | correct.   | InPinzger’sformulationofthepredictionapproach, |              |           |                 |                   |                |           |
|     |     |     |     |     |     |     |      | random     | guessing                                       | would        | result    | in              | 50% for           | both measures. |           |
|     |     |     |     |     |     |     |      | Thus a     | predictor                                      | based        | on        | network         | measures          | for a          | network   |
| Bob | B   |     | Fu  |     | C   |     | Sara |            |                                                |              |           |                 |                   |                |           |
|     |     |     |     |     |     |     |      | containing | major                                          | contributor  |           | only            | does marginally   |                | better    |
|     |     |     |     |     |     |     |      | than one   | that                                           | chose        | binaries  | purely          | at random.        |                | Table 4   |
|     |     |     |     |     |     |     |      | shows      | the performance                                |              | when      | a predictor     | is                | trained        | on the    |
|     |     |     |     |     |     |     |      | complete   | network                                        | as           | well      | as the networks | with              | minor          | con-      |
|     |     |     |     |     |     |     |      | tributions | removed                                        |              | and major | contributions   |                   | removed.       |           |
|     |     |     | D   |     | Amy |     |      |            |                                                |              |           |                 |                   |                |           |
|     |     |     |     |     |     |     |      | We         | also show                                      | results      | for       | pre-release     | failures          | in             | Vista as  |
|     |     |     |     |     |     |     |      | well as    | pre- and                                       | post-release |           | failures        | for Windows       |                | 7. In all |
cases,modelsbuiltonminorcontributionsperformedbetter
|                 |            |              |           |            |          |       |      | than those  | based        | on  | major      | contributions | to           | a statistically |           |
| --------------- | ---------- | ------------ | --------- | ---------- | -------- | ----- | ---- | ----------- | ------------ | --- | ---------- | ------------- | ------------ | --------------- | --------- |
| Figure 5:       | An example | contribution |           | network.   |          | Boxes | rep- |             |              |     |            |               |              |                 |           |
|                 |            |              |           |            |          |       |      | significant | degree.      | In  | the        | case of Vista | post-release |                 | failures, |
| resent binaries | and        | circles      | represent | developers |          | who   | con- |             |              |     |            |               |              |                 |           |
|                 |            |              |           |            |          |       |      | minor       | contribution |     | prediciton | models        | perform      | better          | than      |
| tributed to     | them.      | A dashed     | line      | between    | a binary | and   | de-  |             |              |     |            |               |              |                 |           |
veloper indicates a minor contributor relationship. models based on the entire network, and models based on
theentirenetworkwereneverstatisticallybetterthanthose
|     |     |     |     |     |     |     |     | based on     | minor | contributions |     |       |              |       |      |
| --- | --- | --- | --- | --- | --- | --- | --- | ------------ | ----- | ------------- | --- | ----- | ------------ | ----- | ---- |
|     |     |     |     |     |     |     |     | We therefore |       | conclude      | the | minor | contribution | edges | pro- |
degree,thenetworksthatconsidermajorcontributionshave videthe“signal”usedbydefectpredictorsthatarebasedon
dramatically lower correlations. In fact, for the case of Hi- thecontributionnetwork. Withoutthem,theabilitytopre-
erarchy, the sign of the correlation is negative, indicating dictfailurepronecomponentsisgreatlydiminished,further
thathighervalueofhierarchyinthemajorcontributionnet- supporting our hypothesis that they are strongly related to
| works were | associated | with | fewer | failures. | These | findings |     | software | quality. |     |     |     |     |     |     |
| ---------- | ---------- | ---- | ----- | --------- | ----- | -------- | --- | -------- | -------- | --- | --- | --- | --- | --- | --- |
clearlyindicatethattheedgesfromminorcontributorsem-
| body much | of the  | important  | structure | of      | the contributions |            |     |               |     |     |     |     |     |     |     |
| --------- | ------- | ---------- | --------- | ------- | ----------------- | ---------- | --- | ------------- | --- | --- | --- | --- | --- | --- | --- |
|           |         |            |           |         |                   |            |     | 8. DISCUSSION |     |     |     |     |     |     |     |
| graph. So | much so | that their | removal   | results | in                | a decrease |     |               |     |     |     |     |     |     |     |
in the discriminatory power of these metrics. Our findings are valuable in a number of ways. We have
We also built a predictor from these measures for identi- shownthatforbothversionsofWindows,ownershipdoesin-
fyingfaultpronebinariesinWindowsVistaandWindows7 deedhavearelationshipwithcodequality. Thisobservation
usingthesameapproachasPinzgeret al.[29]. Theytrained isanactionableresult,asthisisanaspectofsoftwaredevel-
alogisticregressionmodelonarandomlychosentwothirds opmentthatcanbecontrolledandmonitoredtosomedegree
of the binaries in the contribution network and then eval- by managementdecisionson developmentprocessandpoli-
uated the model based on its results when classifying the cies. In all projects, the addition of Minor improved the
remaining third. regression models for both pre- and post-release failures to
Thisprocesswasrepeatedfiftytimes,eachwithadifferent astatisticallysignificantdegree. Aftercontrollingforknown
random split of the data and the measures of performance, softwarequalityfactors,binarieswithmoreminorcontribu-
precision,recall,andF-score—standardmeasuresofinfor- torshadmorepre-andpost-releasefailuresinbothversions
mation retrieval [17] — were averaged across all runs. of Windows. Thus hypothesis 1 is empirically supported in
| Theiroriginalmodelbasedonthecompletenetworkiden- |     |     |     |     |     |     |     | both projects. |     |     |     |     |     |     |     |
| ------------------------------------------------ | --- | --- | --- | --- | --- | --- | --- | -------------- | --- | --- | --- | --- | --- | --- | --- |
Ownershipisalittlebitdifferent.
tified 90% of the fault prone binaries and 85% of its fault Theanalysisof Inthis
prone predictions were correct (their evaluation was based case, we saw a small, but still statistically significant effect
onapriorWindowsrelease). Whenthepredictorwastrained in pre- and post-release failures for Vista and pre-release

Windows Vista Windows 7
Pre-release Post-release Pre-release Post-release
SNA Metric All Minor Major All Minor Major All Minor Major All Minor Major
Precision 90% 87% 83% 75% 84% 44% 89% 88% 80% 12% 11% 8%
Recall 91% 93% 91% 82% 88% 58% 92% 93% 87% 66% 75% 61%
F-Score 91% 89% 87% 78% 86% 50% 90% 90% 84% 21% 20% 14%
Table 4: Performance of network based failure predictors for pre- and post-release failures for Vista and Windows 7
failures for Windows 7. Part of this may be attributable to It may not always be possible to follow these recommen-
a moderate relationship between the Minor and Owner- dations(forinstance,incaseswheretoomanypotentialcon-
ship,butalthoughOwnershipwassignificantinallmodels tributorsneedchangestoacomponentforonedeveloperto
whenremovingMinor,theeffectwassmaller. Nonetheless, handle), however they should be followed as much as pos-
in all cases, higher values for Ownership was associated sible within reason. These recommendations are currently
with lower numbers of failures. We therefore conclude that beingevaluatedatMicrosoft. Weplantoinvestigatethere-
hypothesis 2 is supported in the case of Windows Vista and lationshipoftheownershipmeasuresusedinthispaperwith
in pre-release data for Windows 7. softwarequalityinotherprojectsatMicrosoftthatdifferin
The results of empirical software engineering studies do size and process domain (e.g. projects utilizing agile). Fur-
not always generalize to settings where a different process ther, we plan to observe the results of projects that follow
is used. The process that is used may dictate the effect of these recommendations.
other factors on software quality as well. Therefore, when
determining the applicability of a research result to a soft- 9. CONCLUSION
ware project, the context of the study must be taken in
account. Microsoft employs strong ownership practices and We have examined the relationship between ownership
our results are much more likely to hold in other indus- andsoftwarequalityintwolargesoftwaredevelopmentprojects.
trialsettingswheresimilarpoliciesareinplace. Examining We found that high levels of ownership, specifically opera-
the effect of ownership in contexts where ownership is not tionalized as high values of Ownership and Major, and
stressed as highly, such as in many open source software low values of Minor, are associated with less defects.
(OSS)projects,isanareaofcontinuedstudyasweattempt An investigation into the effects of minor and major con-
to understand the interaction between ownership, quality, tributions on network based defect prediction found that
and varying software processes. removing minor contribution edges severely impaired pre-
For contexts in which strong ownership is practiced or dictive power. We also found that when a component has
where empirical studies are consistent with our own find- aminorcontributor,thesamedeveloperisamajorcontrib-
ings,wemakethefollowingrecommendationsregardingthe utor to a dependent component approximately half of the
development process based on our findings: time,uncoveringatleastonesignificantreasonforhighlev-
els of minor contributions. Changes to policies regarding
1. Changesmadebyminorcontributorsshouldbereviewed tasks that would lead to this behavior, such as defect reso-
with more scrutiny. Changes made by minor con- lution and feature implementation, should be implemented
tributors should be exposed to greater scrutiny than and evaluated.
changesmadebydeveloperswhoareexperiencedwith For organizations where ownership has a strong relation-
thesourceforaparticularbinary. Whenpossible,ma- shipwithdefects,wehavepresentedrecommendationswhich
jorcontributorsshouldperformthesecodeinspections. arecurrentlybeingevaluatedatMicrosoft. Asourmeasures
If a major contributor cannot perform all inspections, ofownershiparecheapandlightweight,weencourageother
heorsheshouldfocusoninspectingchangesbyminor researchers and practitioners to perform and report their
contributors. findings of similar analyses so that we can build a body of
knowledge regarding ownership and quality in various do-
2. Potential minor contributors should communicate de-
mains and contexts.
siredchangestodevelopersexperiencedwiththerespec-
tive binary. Often minor contributors to one binary
10. REFERENCES
are major contributors to a depending binary. Rather
than making a desired change directly, these develop-
[1] R. Banker, G. Davis, and S. Slaughter. Software
ers should contact a major contributor and commu-
development practices, software complexity, and
nicate the desired change so that it can be made by
software maintenance performance: A field study.
someone who has higher levels of expertise.
Management Science, 44(4):433–450, 1998.
3. Components with low ownership should be given pri- [2] V. Basili and G. Caldiera. Improve Soft-ware Quality
ority by QA resources. Metrics such as Minor and by Reusing Knowledge and Experience. Sloan
Ownershipshouldbeusedinconjunctionwithsource Management Review, 37:55–55, 1995.
code based metrics to identify those binaries with a [3] V. Basili, G. Caldiera, and H. Rombach. The Goal
high potential for having many post-release failures. Question Metric Approach. Encyclopedia of Software
When faced with limited resources for quality-control Engineering, 1:528–532, 1994.
efforts, these binaries should have priority. [4] K. Beck and C. Andres. Extreme Programming

Explained: Embrace Change.Addison-WesleyReading, [20] R. Milo, N. Kashtan, S. Itzkovitz, M. E. J. Newman,
| MA,          | 2005.    |           |              |             |       |            |     | and U.          | Alon.             | On the     | uniform   | generation | of       | random  |
| ------------ | -------- | --------- | ------------ | ----------- | ----- | ---------- | --- | --------------- | ----------------- | ---------- | --------- | ---------- | -------- | ------- |
|              |          |           |              |             |       |            |     | graphs          | with              | prescribed | degree    | sequences. | Arxiv    |         |
| [5] C. Bird, | N.       | Nagappan, | P.           | Devanbu,    | H.    | Gall, and  |     |                 |                   |            |           |            |          |         |
|              |          |           |              |             |       |            |     | preprint        | cond-mat/0312028, |            |           | 2003.      |          |         |
| B. Murphy.   |          | Does      | distributed  | development |       | affect     |     |                 |                   |            |           |            |          |         |
|              |          |           |              |             |       |            |     | [21] A. Mockus. | Succession:       |            | Measuring |            | transfer | of code |
| software     | quality? |           | an empirical | case        | study | of windows |     |                 |                   |            |           |            |          |         |
vista. In Proc. of the International Conference on and developer productivity. In Proceedings of the 31st
Software Engineering, 2009. International Conference on Software Engineering,
| [6] C. Bird, | N.  | Nagappan, | P.  | Devanbu, | H.  | Gall, and |     | 2009. |     |     |     |     |     |     |
| ------------ | --- | --------- | --- | -------- | --- | --------- | --- | ----- | --- | --- | --- | --- | --- | --- |
B. Murphy. Putting it All Together: Using [22] A. Mockus and J. D. Herbsleb. Expertise browser: a
|                 |             |          |                    |            |           |          |     | quantitative |              | approach           | to identifying |            | expertise. | In  |
| --------------- | ----------- | -------- | ------------------ | ---------- | --------- | -------- | --- | ------------ | ------------ | ------------------ | -------------- | ---------- | ---------- | --- |
| Socio-Technical |             | Networks |                    | to Predict | Failures. |          | In  |              |              |                    |                |            |            |     |
|                 |             |          |                    |            |           |          |     | Proc.        | of the       | 24th International |                | Conference |            | on  |
| Proceedings     |             | of the   | 17th International |            | Symposium |          | on  |              |              |                    |                |            |            |     |
|                 |             |          |                    |            |           |          |     | Software     | Engineering, |                    | 2002.          |            |            |     |
| Software        | Reliability |          | Engineering.       |            | IEEE      | Computer |     |              |              |                    |                |            |            |     |
Society, 2009. [23] A. Mockus and D. Weiss. Predicting risk of software
[7] W. Boh, S. Slaughter, and J. Espinosa. Learning from changes. Bell Labs Technical Journal, 5(2):169–180,
| experience | in  | software | development: |     | A   | multilevel |     | 2000. |     |     |     |     |     |     |
| ---------- | --- | -------- | ------------ | --- | --- | ---------- | --- | ----- | --- | --- | --- | --- | --- | --- |
analysis. Management Science, 53(8):1315–1331, 2007. [24] M. Molloy and B. Reed. A critical point for random
|                |              |              |      |             |        |          |     | graphs      | with            | a given degree |     | sequence. | Random | Struct. |
| -------------- | ------------ | ------------ | ---- | ----------- | ------ | -------- | --- | ----------- | --------------- | -------------- | --- | --------- | ------ | ------- |
| [8] F. Brooks. |              | The Mythical |      | Man-Month:  | Essays |          | on  |             |                 |                |     |           |        |         |
|                |              |              |      |             |        |          |     | Algorithms, | 6(2-3):161–179, |                |     | 1995.     |        |         |
| Software       | Engineering, |              | 20th | Anniversary |        | Edition. |     |             |                 |                |     |           |        |         |
Addison-Wesley, 1995. [25] N. Nagappan and T. Ball. Use of relative code churn
[9] M. Cataldo, P. Wagstrom, J. Herbsleb, and K. Carley. measures to predict system defect density. Proceedings
Identification of coordination requirements: of the 27th International Conference on Software
implications for the Design of collaboration and Engineering, pages 284–292, May 2005.
awareness tools. Proceedings of the 2006 20th [26] N. Nagappan, B. Murphy, and V. Basili. The influence
anniversary conference on Computer supported of organizational structure on software quality: an
|                 |     |          |                |           |       |             |     | empirical  | case | study.   | In Proc.     | of the | 30th  | international |
| --------------- | --- | -------- | -------------- | --------- | ----- | ----------- | --- | ---------- | ---- | -------- | ------------ | ------ | ----- | ------------- |
| cooperative     |     | work,    | pages 353–362, |           | 2006. |             |     |            |      |          |              |        |       |               |
|                 |     |          |                |           |       |             |     | conference | on   | Software | engineering, |        | 2008. |               |
| [10] B. Curtis, | H.  | Krasner, | and            | N. Iscoe. | A     | field study | of  |            |      |          |              |        |       |               |
the software design process for large systems. [27] M. E. J. Newman, S. H. Strogatz, and D. J. Watts.
Communication of the ACM, 31(11):1268–1287, 1988. Random graphs with arbitrary degree distributions
[11] E. Darr, L. Argote, and D. Epple. The acquisition, and their applications. Phys. Rev. E, 64(2):026118, Jul
| transfer, | and | depreciation |     | of knowledge |     | in service |     | 2001. |     |     |     |     |     |     |
| --------- | --- | ------------ | --- | ------------ | --- | ---------- | --- | ----- | --- | --- | --- | --- | --- | --- |
organizations: Productivity in franchises. Management [28] T. Ostrand, E. Weyuker, and R. Bell. Where the bugs
|                |                   |          |     |             |            |       |     | are. In       | Proceedings | of        | the ACM | SIGSOFT  |         |     |
| -------------- | ----------------- | -------- | --- | ----------- | ---------- | ----- | --- | ------------- | ----------- | --------- | ------- | -------- | ------- | --- |
| Science,       | 41(11):1750–1762, |          |     | 1995.       |            |       |     |               |             |           |         |          |         |     |
|                |                   |          |     |             |            |       |     | international |             | symposium | on      | Software | testing | and |
| [12] S. Dowdy, | S.                | Wearden, | and | D. Chilko.  | Statistics |       | for |               |             |           |         |          |         |     |
|                |                   |          |     |             |            |       |     | analysis,     | 2004.       |           |         |          |         |     |
| research.      | John              | Wiley    | &   | Sons, third | edition,   | 2004. |     |               |             |           |         |          |         |     |
[13] K. El Emam, S. Benlarbi, N. Goel, and S. N. Rai. The [29] M. Pinzger, N. Nagappan, and B. Murphy. Can
confounding effect of class size on the validity of developer-module networks predict failures? In
object-oriented metrics. IEEE Transactions of Proceedings of the 16th ACM SIGSOFT International
|          |              |     |                |     |       |     |     | Symposium | on  | Foundations |     | of software | engineering, |     |
| -------- | ------------ | --- | -------------- | --- | ----- | --- | --- | --------- | --- | ----------- | --- | ----------- | ------------ | --- |
| Software | Engineering, |     | 27(7):630–650, |     | 2001. |     |     |           |     |             |     |             |              |     |
2008.
| [14] S. Elbaum | and | J.     | Munson. | Code         | churn: | A measure   | for |                |     |             |     |            |            |     |
| -------------- | --- | ------ | ------- | ------------ | ------ | ----------- | --- | -------------- | --- | ----------- | --- | ---------- | ---------- | --- |
|                |     |        |         |              |        |             |     | [30] F. Rahman | and | P. Devanbu. |     | Ownership, | Experience |     |
| estimating     | the | impact | of      | code change. | In     | Proceedings |     |                |     |             |     |            |            |     |
of the International Conference on Software and Defects: a fine-grained study of Authorship. In
| Maintenance, |     | 1998. |     |     |     |     |     | Proceedings | ICSE | 2011, | To  | appear, | 2011. |     |
| ------------ | --- | ----- | --- | --- | --- | --- | --- | ----------- | ---- | ----- | --- | ------- | ----- | --- |
[15] T.Fritz,G.Murphy,andE.Hill.Doesaprogrammer’s [31] P. Robillard. The role of knowledge in software
activity indicate knowledge of code? In Proc. of the development. Communications of the ACM, 42(1):92,
1999.
| ACM           | SIGSOFT      | symposium    |      | on           | The foundations |             | of  |                |            |         |          |         |             |     |
| ------------- | ------------ | ------------ | ---- | ------------ | --------------- | ----------- | --- | -------------- | ---------- | ------- | -------- | ------- | ----------- | --- |
|               |              |              |      |              |                 |             |     | [32] M. Sacks. | On-the-Job |         | Learning | in the  | Software    |     |
| software      | engineering, |              | page | 350.         | ACM, 2007.      |             |     |                |            |         |          |         |             |     |
|               |              |              |      |              |                 |             |     | Industry.      | Corporate  | Culture |          | and the | Acquisition | of  |
| [16] R. Kraut | and          | L. Streeter. |      | Coordination |                 | in software |     |                |            |         |          |         |             |     |
development. Communications of the ACM, Knowledge. Quorum Books, 88 Post Road West,
| 38(3):69–81, |     | 1995. |     |     |     |     |     | Westport, | CT  | 06881., | 1994. |     |     |     |
| ------------ | --- | ----- | --- | --- | --- | --- | --- | --------- | --- | ------- | ----- | --- | --- | --- |
[17] F. W. Lancaster. Information Retrieval Systems: [33] A. Srivastava, J. Thiagarajan, and C. Schertz.
|                  |          |          |        |                 |     |           |     | Efficient | Integration |        | Testing | using           | Dependency |     |
| ---------------- | -------- | -------- | ------ | --------------- | --- | --------- | --- | --------- | ----------- | ------ | ------- | --------------- | ---------- | --- |
| Characteristics, |          | Testing, |        | and Evaluation. |     | Wiley,    | 2nd |           |             |        |         |                 |            |     |
|                  |          |          |        |                 |     |           |     | Analysis. | Technical   | Report |         | MSR-TR-2005-94, |            |     |
| edition,         | 1979.    |          |        |                 |     |           |     |           |             |        |         |                 |            |     |
|                  |          |          |        |                 |     |           |     | Microsoft | Research,   | 2005.  |         |                 |            |     |
| [18] D. W.       | McDonald |          | and M. | S. Ackerman.    |     | Expertise |     |           |             |        |         |                 |            |     |
recommender: a flexible recommendation system and [34] S. Wasserman and K. Faust. Social network analysis:
architecture. In Proc. of the ACM conference on Methods and applications. Cambridge University
| Computer | supported |     | cooperative |     | work, 2000. |     |     | Press, | 1994. |     |     |     |     |     |
| -------- | --------- | --- | ----------- | --- | ----------- | --- | --- | ------ | ----- | --- | --- | --- | --- | --- |
[19] A. Meneely and L. A. Williams. Secure open source [35] E. J. Weyuker, T. J. Ostrand, and R. M. Bell. Do too
|                |     |           |           |            |           |          |     | many       | cooks  | spoil the | broth?         | using      | the number | of  |
| -------------- | --- | --------- | --------- | ---------- | --------- | -------- | --- | ---------- | ------ | --------- | -------------- | ---------- | ---------- | --- |
| collaboration: |     | an        | empirical | study      | of linus’ | law.     | In  |            |        |           |                |            |            |     |
|                |     |           |           |            |           |          |     | developers | to     | enhance   | defect         | prediction | models.    |     |
| Proceedings    |     | of the    | ACM       | Conference | on        | Computer | and |            |        |           |                |            |            |     |
|                |     |           |           |            |           |          |     | Empirical  | Softw. | Engg.,    | 13(5):539–559, |            | 2008.      |     |
| Communications |     | Security, |           | 2009.      |           |          |     |            |        |           |                |            |            |     |
