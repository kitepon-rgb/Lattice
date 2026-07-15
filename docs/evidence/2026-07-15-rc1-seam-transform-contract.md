# RC1-E seam transform implementation contract

- 日付: 2026-07-15
- plan: `lattice-research-campaign-1-v2`の既存RC1-E node
- Decision: [ADR 0010](../adr/0010-rc1-transform-artifact-and-verifier-receipts.md)
- classification: F
- placement: 親直轄。介入acceptance、公開artifact、canonical source不変は契約クリティカルである。

## Accepted input

- `research/campaigns/rc1/artifacts/control/boundary-manifest.json`
- `research/campaigns/rc1/artifacts/control/boundary-verdict.json`
- `research/campaigns/rc1/artifacts/control/plan-v1.json`
- `research/campaigns/rc1/inputs/query-set.json`
- accepted fixture commitを指すclean `baseRef`

transformerは各artifactをpublic validatorへ通し、manifest digest、verdict digest、plan source digest、query-set digest、
pre-transform code snapshot digest、candidate ID／proposed ownershipを相互照合する。drift、state／effect conflict、候補欠落は
worktreeを作る前にfail closedとする。

## Fixed intervention

allowed pathは次のexact 3件とする。

1. `research/fixtures/dispatch-record/src/dispatch-channel.mjs`
2. `research/fixtures/dispatch-record/src/dispatch-label.mjs`
3. `research/fixtures/dispatch-record/src/dispatch-record.mjs`

`selectDispatchChannel`はpriority validationとchannel選択、`formatDispatchLabel`はrecipient／title validationとlabel整形を所有する。
`buildDispatchRecord`はexact input shape validation、2 seamのcomposition、frozen resultだけを所有する。error type／message／precedence、
trim、returned value、freezeを変更しない。

verifierは`node --test test/research-dispatch-record.test.mjs`を固定し、transform callbackがtestを変更することを許さない。
accepted changed pathはallowed path 3件とexact一致しなければならない。

## Result contract

`runRc1SeamTreatment`は次を返す。

- `artifact`: strict `lattice.transform_artifact.v1`。
- `artifact_digest`: artifact canonical SHA-256。
- `patch`: accepted時だけraw patch `Buffer`、rejected時は`null`。

accepted artifactはraw patch digest／bytes、verifier receipt digest、changed file content digest、post snapshot digest、cleanup passed、
source unchangedを持つ。rejected artifactはtyped rejectionとevidence digestを持ち、patchを後段へ返さない。

## Verification

- artifact validatorをaccepted／rejected／invalid caseでfocused testする。
- isolation runnerのsuccess／verifier failure receiptを既存temp repo testへ追加する。
- seam transformerのcandidate drift、deterministic artifact、scope rejectをfocused testする。
- related integrationはtemp clone内で次を一回のscriptとして実行する。
  - fixed transformがcharacterization greenでacceptedになる。
  - allowed path外writeがscope rejectになる。
  - allowed path内behavior divergenceがverifier rejectになる。
  - 各run後にclone HEAD／statusが不変で、一時worktreeが残らない。
- full `npm run ci`はRC1-Gへ集約する。

## Non-goals／writer boundary

- RC1-FのCodegraph reindex、post manifest、plan v2、plan diffを実装しない。
- canonical fixture sourceへaccepted patchを適用しない。branch／commit／stash／resetを作らない。
- arbitrary AST rewrite、formatter、dependency追加、test rewriteを行わない。
- Codegraph、dotagents、Observer関連repoを編集しない。
