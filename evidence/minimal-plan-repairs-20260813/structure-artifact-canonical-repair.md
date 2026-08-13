# structure-artifact-canonical-repair

## 実施内容

- 既存の `structure input` writerで復旧できるplanned sourceの破損だけを、plan key・対象path・reason・実行可能な次のcommandへ束縛した。writerで直せないbinding／compile／finalizationを修理可能とは案内しない。
- top-level `lattice status --json` と `lattice todo verify --json` は、破損を成功結果の条件付きfieldへ混ぜず、`STRUCTURE_ARTIFACT_INVALID` のtyped errorとexit 1で返す。正常系の既存schemaは変更していない。
- 復旧処理・入力推測・repair専用writerは追加せず、既存の `structure input` writerを再利用する。
- valid binding発行後は、そのbindingと同じ `structure_set_digest` のplanned sourceだけcanonical bytesへ復旧できる。異なるlogical inputは従来どおり拒否する。

## 最終試験

- `node --test test/todo-structure-cli.test.mjs` — 11/11成功。pretty JSON、trailing bytes、truncated JSON、schema invalidの4種をtop-level statusとtodo verifyでexit 1診断し、明示inputからcanonical復旧した。valid binding後の同一digest復旧と異なるdigest拒否も実測した。
- bundled sensorだけcanonical checkoutのbuild済み `sensor/dist` を一時symlink参照し、worktreeへinstallしていない。

## 変更ファイル

- `src/todo-cli.mjs`
- `src/todo-structure-store.mjs`
- `src/todo-store.mjs`
- `test/todo-structure-cli.test.mjs`
- 本証跡ファイル
