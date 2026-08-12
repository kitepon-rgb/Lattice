# ADR 0061: Phase統制計画の敵対的検証を受け入れる

## 状態

採用

## 文脈

Phase統制、live Gantt、bounded seam一般化の実装前に、独立refuterが計画をLatticeの現行store、schema、revision、status、Gantt契約へ照合した。

検証では、ordinary gate ToDoをPhaseと誤認している、静的Ganttとinteractive UIを混同している、bounded seamを任意repo一般化している、旧schemaをin-place変更する、という反対仮説は棄却された。

一方、次の3件は実在する破損経路として確認された。

1. cross-plan参照先をsuccessorへ進めると、参照元と参照先を一件ずつ切り替えるどちらの順序でも一時的にtopology bindingがstaleとなる。
2. mutation整合の修正対象がstart/doneだけでは、cross-plan predecessorのreopenが開始済み後続を破壊できる。
3. planごとに独立したjournal間では、Phase Decisionとcross-plan後続startの因果をdigest chainだけで証明できない。

## 決定

3件をすべて採用し、実装前計画へ次を追加する。

- successor集合はmulti-plan activation transactionで一括公開し、全predecessor manifest digestと新artifact集合を一つのCASへ束縛する。
- cross-plan start、done、reopenをmerged graphで検査し、開始済み後続があるreopenは明示override/cascadeなしに受理しない。
- cross-plan後続startへ、原因となるaccepted Decision digestと検証済みpredecessor head集合を束縛する。timestampは因果証拠に使わない。

Phase本体、live viewer、bounded seamの目標は縮小しない。AIShellの49 ToDo mappingはLattice側refuterのread scope外だったため、この検証だけでは受入済みにせず、AIShell migration Phaseで実体照合する。

## 帰結

- Phase schemaの前にcross-plan characterizationとmulti-plan cutover安全網を置く。
- Phase reopenはToDo reopenと同じく、同一planだけでなくcross-planの開始済み後続を保護する。
- cross-plan因果は各journalの自己整合だけでなく、明示的なDecision/head bindingで監査できる。
