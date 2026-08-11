# bpr8-caveat 受入証跡

## 記録した罠（2件）

### 1. `ssh-windows-process-ssh-session-session-netstat`（public・reproduced）

SSH越しに起動したWindowsのprocessは、そのSSH sessionが閉じた瞬間に落ちる。`wscript`で
Startup folderのVBS launcher経由（hidden・fire-and-forget）で起こしても同じ。

**価値があるのは観測の非対称である。** 起動した同じsession内では`netstat`にLISTENINGが出て
`Test-NetConnection`もTrueを返すが、次に接続した別sessionからは消えている。別sessionから
到達性を測ると「listenerが在るのに繋がらない」形になり、inbound firewallが閉じていると
読み違える。

対処として記録したのは「繋がらないを観測したら、対象processが今この瞬間生きているかを
**同じ窓の中で**確認する」こと。到達性テストと生存確認を別sessionに分けない。

### 2. `codex-peertable-codex-sidecar-auth-lease-busy-auth-lease-1`（private・confirmed）

peertableのCodex席が稼働中は、codex-sidecarが`AUTH_LEASE_BUSY`で使えない。auth leaseは
アカウント単位で1本で、生きた席が保持している（stale leaseの既存entryとは別の状況）。

「円卓のCodex席を立てたまま、卓の外からCodexへ反証を投げる」構成は組めない。反証・監査は
卓の中の席へ回す——これはpeertableの決定60と元々一致するので実害は無い。

## 重複確認

`caveat_search`で事前確認済み。1件目は該当0件。2件目は既存の
`codex-sidecar-stale-auth-lease-work-queue-mcp-hang`（stale leaseによる恒久ブロック）が
出たが、本件は「生きた占有」で状況が異なるため別entryとした。

## 実被弾

どちらも2026-08-11の作業中に実際に踏んだもの。1件目は誤診（firewall ruleの追加を提案し撤回）まで
発生しており、その撤回の経緯も配備記録へ残してある。
