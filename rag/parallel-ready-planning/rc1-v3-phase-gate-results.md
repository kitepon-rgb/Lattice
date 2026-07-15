# RC1 v3 Phase gate: green regressionでもschedulability因果結論をrejectした実測

- 出典: Lattice RC1 v3 source、machine artifacts、独立refuter／Critic、親再現
- 取得日: 2026-07-15
- 確度: 実コードとversioned artifactで再現したfindingは高。ignored content事故は経路実在・今回実害なし。
- Decision正本: `docs/adr/0016-rc1-v3-phase-gate-rejection.md`
- Evidence正本: `docs/evidence/2026-07-15-rc1-v3-phase-gate.md`

## 結論

RC1 v3は49 test green、accepted transform、portable digest一致、negative state control、plan version barrierまで通ったが、
「seam transformだけがTODO graphを2 waveから1 waveへ変えた」という因果結論はrejectされた。green regressionとartifact内部整合は、
測定器がconditionごとに違う場合や、TODO patchの一部をboundaryから落とした場合の内的妥当性を保証しない。

## 再利用すべき罠

### 1. pre／postでcompilerが違えば、入力digest固定だけでは不十分

plan input、manual evidence、query set、capacity、base、patchをdigest固定しても、control compilerが期待するconflict／unknownを生成し、
treatment compilerが別の期待値を生成すれば、条件差と測定器差が完全に共変する。必要なのは同じ入力だけでなく、ownership、unknown、
conflict、waveを導出する同じ測定関数である。

### 2. affected testは「走らせるだけ」とは限らない

将来TODOがbehavior expectationを変える場合、そのtestは実行依存であると同時にwrite artifactである。production sourceだけをseam分離しても、
両workerが同じexpected objectを編集すればpatchは衝突する。TODO boundaryはsource、test、generated artifact、schema、configまで含めてcompileする。

test seamを作る場合も、変換対象test自身だけでbehavior preservationを判定するとoracleを同時に書換える。transform scope外の固定black-box
oracle、またはdigest固定された外部matrixを別gateとして残す。

### 3. digestはpreimage保存ではない

aggregate raw digest、portable digest、equality boolean、status summaryだけでは、独立監査者はexact symbol path、impact、affected test、
projection除外fieldを再計算できない。少なくともcanonical portable outcome payloadをrunごとに保存し、診断rawは絶対pathとvolatile telemetryを
明示的にsanitizationして別identityへする。original raw digestはopaque receipt、portable payloadはplan identityと役割を分ける。

### 4. human tableとmachine success predicateを一致させる

文書がwrite conflict、unknown、hard precedence、behavior、negative、predecessor、invalidationを成功条件にしていても、machine predicateが
verdictとwaveしか見なければfalse supportを生成できる。成功条件ごとにexact predicateとsingle-field corruption testを持たせる。

### 5. `source_unchanged`は観測範囲を型にする

HEADとporcelain statusはtracked／untracked変化とignored path集合を検出できるが、開始前からあるignored fileの内容だけの変更は見えない。
全repoを無制限hashする代わりに、protected source／test scope、ignored content fingerprint、git-visible statusを別fieldへ分け、証明した範囲だけをclaimする。

## 生き残った証拠

- behavior-preservingなproduction seam transformは実在する。
- accepted artifact、patch、snapshot、control predecessor、new planのdigest chainは成立する。
- shared-state negativeはpath分離後もserialを保持する。
- old plan／agent context／partial patch／interface assumptionの宣言上のinvalidationは成立する。

このためv3を全廃する必要はない。transform機構をpredecessorにし、同一測定器、test seam、保存preimageへ補正した新plan versionを
発行するのが最小かつ識別可能な修正である。
