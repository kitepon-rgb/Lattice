# ADR 0057: per-ToDo source cutoverをrevision transactionへ統合する

- Status: accepted
- Date: 2026-07-19
- Supersedes: ADR 0055の「source inventoryは既存Markdown checkboxを検証するだけ」という範囲を、
  checkbox台帳を終了するcutoverまで拡張する。plan topologyのsuccessor単位は変更しない。

## Context

`todo revise`はtask topology、state migration、source inventory、reconciliationを一つのsuccessor
revisionへ束縛する。一方、検証後のsource Markdown checkboxをlive文書へ残すと、LatticeとMarkdownが
二重の進捗正本に見える。別AIがMarkdownをLatticeへ再同期すると、完了taskの復活、状態巻戻し、依存の
再解釈が起こり得る。

Markdown file全体をarchiveすると、同じfileに混在する思想、背景、非目標、受入条件、複数taskを巻き込む。
したがって契約上の移転単位はfileではなくToDoでなければならない。ただし1 taskずつCLI transactionを
発行することも、大規模planの処理量とcross-plan activationを不必要に悪化させる。

## Decision

### 1. 二層transaction

- topologyとstate migrationのactivation単位は従来どおり1 planのfull desired-state successorとする。
- source移転の意味単位は1 ToDoとする。
- 1 successor revisionは、複数のper-ToDo操作を1つのbounded batchとして含めてよい。
- batch内の1件でも不正なら、store、archive、live sourceをすべて無変更で拒否する。
- 大規模移転は複数successor revisionへ分割できる。各revisionは直前のplan／journal／reconciliation digestへ
  束縛されるため、順序飛ばし、二重適用、別batchへのすり替えを拒否する。

### 2. `lattice.todo_revision.v2`

v1をread-compatibleとして維持し、source cutoverを行うrevisionはv2を使う。v2はv1の全fieldに
`source_cutover_batch`を追加する。

batchは次を持つ。

- `batch_id`: plan内で意味のあるbounded identifier。
- `archive_ref`: repo相対の新規regular Markdown file。既存fileへのappend／overwriteを禁止する。
- `operations`: source ref昇順のper-ToDo操作。1件以上、上限512。
- `batch_digest`: batch自身のself digest。

各operationは次を持つ。

- `task_id`: active taskはcanonical task ID、excluded tombstoneは`null`。
- `disposition`: `active`または`excluded`。`task_id`のnull性と一致させる。
- `source_ref`: cutover前のlive Markdown checkbox行。
- `source_digest`: その行のexact SHA-256。
- `live_replacement`: 改行を含まない非checkbox行。元checkboxと同じindent・list markerを維持し、
  子listや後続段落のMarkdown構造を変えない。

archive ledgerはLatticeがcanonicalに生成する。先頭にplan key、batch ID、revision bindingを記し、空行後に
operationsの元checkbox行を順番どおりbyte-exactで置く。desired `source_inventory`とtask
`narrative_ref`は、生成後のarchive行を指す。archive行のdigestは元`source_digest`と同一である。

`todoRevisionPlanVersion`、reconciliation digest、revision self digestはbatch全体を含める。batch、desired
inventory、task migration、desired narrative refsの相互対応が完全でなければv2 revisionを拒否する。

### 3. source処理

validationは全operationについて次を確認する。

1. source pathがrepo内のnon-symlink regular UTF-8 Markdownである。
2. `source_ref`が一意で、exact digestが一致し、コードフェンス外のGFM checkboxである。
3. active operationはdesired taskと一対一、excluded operationはdesired tombstoneと一対一である。
4. desired source refとactive taskのnarrative refが生成予定archive行へ一致する。
5. replacementはGFM checkboxではなく、元行と同じ改行数（0）、indent、list markerである。
6. 同一source fileへの複数operationは行番号降順で一つのafter imageへ合成する。

思想、説明、非目標、受入条件などoperationに含まれないbytesはbefore/afterでbyte-exactに維持する。

### 4. durable protocolとrecovery

単一filesystem上でも複数file renameとmanifest renameは一命令ではatomicにできない。ここでいうtransactionは
durable intent、fail-closed barrier、同一revision再実行による収束を意味する。

順序は次で固定する。

1. store lock下でrevision、全source preimage、archive image、全live after imageを検証する。
2. transaction directoryへmarker、before、after、archive、store candidate artifactsをfsyncする。
3. source publish開始前にstore rootへsource-cutover recovery barrierをatomic publishする。
4. archiveを新規publishし、live sourceをafter imageへatomic replaceする。
5. manifest CASを再確認し、successor manifestをatomic activateする。
6. barrierを除去し、transaction directoryをcleanupする。

barrier存在中、通常の`todo status / verify / gantt / mutation`は
`SOURCE_CUTOVER_RECOVERY_REQUIRED`でfail closedする。同じrevisionの`todo revise`だけが回復入口となり、
各対象fileがexact beforeまたはexact afterのどちらかであることを確認してafterへ収束させる。
第三のbytes、別revision、欠落stageは回復せず拒否する。

通常例外がmanifest activation前に起きた場合はexact beforeへrollbackし、今回新設したarchiveだけを除去する。
rollback自体を完遂できない場合はbarrierを残し、成功扱いしない。manifest activation後の同一revision再実行は
idempotent successとしてbarrier／transaction残置をcleanupする。

### 5. CLIと互換性

- argvは`lattice todo revise --plan <key> --input <revision.json>`を維持する。
- v1 revisionは従来挙動を維持し、source cutoverを暗黙実行しない。
- v2 revisionは`source_cutover_batch`必須。別のarchive用CLIやMarkdown同期CLIを作らない。
- archive配下のcheckboxはhistorical sourceであり、migration/extractionの探索対象から除外する。
- result schemaはversionを上げ、cutover batch ID、operation count、archive ref、recovery有無を返す。

## Rejected alternatives

- file単位archive: narrativeと複数taskを巻き込み、部分的なLattice登録を表現できない。
- 1 CLI call＝1 ToDo固定: 厳密だが大規模planの処理量が悪く、plan successor contractとも噛み合わない。
- Markdown更新を別commit／別scriptにする: 二重正本期間と再同期事故を残す。
- Git履歴だけをarchiveにする: source inventoryの安定refと人間可読な凍結台帳を失う。
- error時にbest-effort継続する: sourceとstoreの帰属が追えなくなるため禁止する。

## Acceptance

- v1完全互換、v2 exact schema／digest／相互参照fixture。
- 複数ToDo・複数source file・同一file複数行のbatch success。
- 1件のdigest／anchor／replacement／archive conflictで全bytes不変。
- prepare、barrier、archive、live publish、manifest activation、cleanupの各crash pointから同一revisionで回復。
- barrier中の全reader／別writer fail closed。
- 512 operation上限、path escape、symlink、hardlink、duplicate source/task、archive既存を拒否。
- 実dotagents 8 planの全source inventoryがarchive refへ移り、live plan checkboxが0、思想・説明bytesが保持される。
