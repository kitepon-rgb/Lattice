## 実装結果

別canonical rootからの同一`project_id`登録は`PROJECT_ROOT_CONFLICT`で拒否し、registry bytesを不変にした。配信元rootの変更はactor必須の`lattice todo dashboard adopt --json`だけに限定し、結果とerrorから絶対pathを除外した。
