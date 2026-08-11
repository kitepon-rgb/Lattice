# co1 配備記録追記

`docs/operations/lattice-kitepon-deployment.md`へ、2026-08-11の0.57.3配備記録を追記した。

- npm `@quolu/lattice@0.57.3`、dist shasum `510e7ab8e75d501c8227063eff3085d555041430`
- Mac runtime `0.57.3`、`runtime_drift=[]`、heartbeat accepted
- FOX/WSL2 CLI `0.57.3`（`ssh fox-wsl`経由、global bin絶対パスで確認）
- 公開 `/projects/lattice/` HTTP 200
- FOX/WSL2 bridge未設定による常駐・公開面未測定と、対話logon carry overを明記
