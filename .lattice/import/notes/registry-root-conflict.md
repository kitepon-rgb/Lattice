## 実被弾

`.lattice`をscratchへコピーして`lattice status`しただけで、同一`project_id`のregistry `repo_root`が置換され、公開dashboardが15分間scratchを配信した。

## 実装方針

- 登録済みproject IDのcanonical rootと要求rootが違えば`PROJECT_ROOT_CONFLICT`でfail-closedにする。
- 衝突時はregistry bytesと既存公開配信元を不変にする。
- root変更は専用の明示adopt操作だけに限定し、目的・旧root・新rootを結果へ返す。
- read-only discoveryはregistry更新を伴わない`session-context`へ案内する。
- public error/detailへローカル絶対pathを露出しない。

## 受入

scratch copyからstatusを実行しても正規rootと公開内容が変わらない回帰testを置く。
