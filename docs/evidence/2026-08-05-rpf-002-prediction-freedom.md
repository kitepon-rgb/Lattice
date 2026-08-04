# rpf-002 prediction freedom

- 最新契約:
  - `lattice.run_request.v4`
  - `lattice.todo_witness_set.v4`
- 旧契約: v3/v1 readerと従来の厳密compile意味を維持。
- v4の挙動:
  - `owns`／`reads`／`writes`／`affected_tests`は不完全でよい予測。
  - 新規pathへ`creates: true`を要求しない。
  - 空の予測、複数path、不在path、affected不一致をdispatch拒否にしない。
  - 既知のwrite/read・write/write重複はserial conflictへ使う。
  - 予測外writeは実diff checkpointへ残るが、単独では`conflict_found`／`intake_frozen`にしない。
- 維持した境界:
  - 外部sensorのquery shape／status、明示unknown、runtime actual overlapは従来どおり扱う。
  - 限定seam変換の`allowedPaths`は変更していない。
- 検証:
  - focused 131件成功、0件失敗。
  - 実daemon `prediction-excess-is-not-a-conflict.integration.mjs` 1件成功。
  - syntax check 139 files成功。
