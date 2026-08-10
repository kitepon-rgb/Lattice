# bhl5-visibility — 公開面可視性ファイル

- `readBridgeHubPublicVisibility`+hubRuntimePaths.visibility（commit 592dd06）。リクエスト毎hot-read。
- 隠しIDはHTML/JSON両方から除外・proxy生存・display_names適用・壊れたファイルはtyped 500、を
  serverテスト2件で固定。レジストリプロトコルは無改変。
- 検証: focused 29件 fail 0。
