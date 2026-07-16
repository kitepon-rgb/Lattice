# RC2 raw evidence chunk verification

- 記録日: 2026-07-16
- scope: Lattice RC2-G artifact storage／disk-only verifier
- campaign source SHA-256: `3c1c528b5f49f9c165f61d56dc7d1f54a0d6b4b96fbce56113275a51e5d09197`
- artifact verifier source SHA-256: `e44f6ca605d9f368a3ed73cf6b534df75a7ac5493ca4c9a6155e0934e89d844b`
- characterization source SHA-256: `da1072c6bd8dec4983919318b4a4ee7399a2f3d12c16b32fa45ab869e1545502`

## Observed defect

RC2のfresh Codegraph receiptをそのままrun JSONへ保存すると、opaque raw evidenceのcanonical base64が16KiBを超える。
artifact writerのbounded storage contractに単一の大きな文字列を残さず、同じbytesをdisk-only verifierが再構成できる保存形式が必要だった。

## Storage and verification contract

writerは各runのraw receiptを`lattice.rc2.chunked_codegraph_raw_receipt.v1`へ投影する。payloadは12,000 ASCII bytes固定の
ordered base64 chunksに分け、最終chunk以外はexact 12,000 bytes、全chunkは上限以下とする。descriptorは元schema、media type、
source／storage encoding、canonical byte length、SHA-256、ordered chunksだけを持ち、単一`payload_base64`は保存しない。

pure verifierはchunkのexact shape、上限、非終端長、base64 canonicalityを検査し、結合payloadをdecodeする。復元bytesのlengthと
SHA-256をdescriptorへ照合して元のRC1 raw receiptを再構成した後、既存の`validateRc1EvidenceBundle`へ渡す。したがってchunk化は
証拠内容を要約・切捨てせず、保存表現だけをboundedにする。

## Gates

- characterizationは6 evidence payload全てに対して、保存chunk数が`ceil(base64 bytes / 12000)`と一致すること、全chunk上限、
  非終端exact長、結合後canonical base64、decoded byte length、SHA-256を確認する。
- fixture内に16KiB超のraw base64が少なくとも1件あることを確認し、そのpayloadが複数chunkになることを要求する。
- chunkを変更しRC2 manifestのlength／SHA-256も再封印したcorruptionは、`fresh_run_binding`でfail-closedになる。
- focused: `node --test test/rc2-campaign.test.mjs` — 5 pass / 0 fail / 0 skip、47.365秒。
- post-sync Codegraph: 77 files、1,978 nodes、7,593 edges、pending changes 0、state complete。
  `storedEvidence`は`src/rc2-campaign.mjs`、`rehydrateStoredEvidence`は`src/rc2-artifact-set.mjs`のexact symbolとして収載され、
  affected testは`test/rc2-campaign.test.mjs`だった。

full CIはRC2 Phase gateへ集約し、このTODOでは再実行していない。

## Boundary

Lattice以外のrepoは変更していない。dotagents／Observer関連repoはread-only境界を維持し、remote作成、push、publishは行っていない。
