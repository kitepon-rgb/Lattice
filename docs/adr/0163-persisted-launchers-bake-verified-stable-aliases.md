# ADR 0163: 常駐設定へ焼く実行体pathは検証済みの安定aliasにする

- Status: Accepted
- Date: 2026-08-10

## Context

bridgeの常駐設定（macOSのLaunchAgent plist、WindowsのStartup launcher）は、起動する
Node実行体の絶対pathを内部に焼き込む。焼いていたのは`process.execPath`をさらに`realpath`
した値である。

`process.execPath`はlibuvが既にrealpath解決を掛けているため、`/opt/homebrew/bin/node`から
起動しても`/opt/homebrew/Cellar/node/26.7.0/bin/node`になる。この版付きpathを焼くと、
`brew upgrade node`が旧versionのディレクトリごと消した時点で、launchdが起動すべきbinaryが
消滅する。KeepAliveは起動できないprocessを回し続け、**どこにもエラーが出ない**。
運用者から見える症状は「公開viewerから自分の端末が消えた」だけで、原因特定には
`launchctl`と`ps`の手掘りを要する。

2026-08-08（node 26.5.0→26.5.1）と2026-08-10（26.7.0を焼いた状態）に、同じMacで2度被弾した。
Windowsのnvm-windowsは`C:\Program Files\nodejs`のjunctionの先を版ごと差し替えるので、
同じ問題が同じ形で起きる。

この欠陥の本質は版付きpathそのものではなく、**壊れたことを誰も知らせない**点にある。
常駐機構は「起動し続ける」ことを仕事にしているので、起動できないという事実が
supervisorの再試行ループの中へ吸い込まれ、観測面へ出てこない。

## Decision

1. **焼くのは、実体binaryと同一だと検証できた安定aliasとする。** 検証は
   `realpath(candidate) === resolved`の一致だけで行う（`src/bridge-executable.mjs`の
   `stableNodePath`）。候補はinstall時のPATH成分に、platformごとの既知の安定ディレクトリ
   （`/opt/homebrew/bin`・`/usr/local/bin`・`/usr/bin`、Windowsは`C:\Program Files\nodejs`）
   を足したものとする。launchdもStartup folderもPATHを継承しないので、候補は焼く側が
   与えるしかない。
2. **aliasの親ディレクトリ権限は検査しない。** homebrewの既定prefix`/opt/homebrew/bin`は
   `drwxrwxr-x`であり、このcodebaseの標準検査`(mode & 0o022) !== 0`を成分へ適用すると、
   本ADRが対象とする環境そのものが不合格になって規則が一度も発動しない。加えて安全上の
   利得も無い——今焼いているCellar pathも`/opt/homebrew/Cellar`という同じくgroup書込み可の
   親を持つため、binaryを差し替えられる主体の集合はどちらでも同一である。
3. **実体binary自身の検査は従来どおり`realpath`に対して行う。** 所有者（rootまたは自分）、
   group/other書込みの不在、実行bit。焼く対象を変えても、検証する対象は変えない。
4. **検証できない候補は焼かない。** shim方式の版管理（asdf、volta）は自身のlauncherへ
   解決されるので一致せず、その場合は版付きpathのままにする。検証していないpathを
   「たぶん同じだろう」で焼くと、別のnodeでdaemonが起動する事故を作る。
5. **原理的に守れない環境がある以上、静的な焼き込みを唯一の防御にしない。**
   `lattice bridge status`が、常駐設定の実行対象（`persistence.node_path`・`bridge_path`）と
   その実在、走っているprocess自身が名乗るidentity（`runtime`）、両者の乖離（`runtime_drift`）、
   そして自己解消しない状態に対する`remedy`を返す。schemaは`lattice.bridge_cli_result.v4`。
6. **実走identityはdescriptorではなくprocess自身に名乗らせる。** descriptorは「何を設定したか」
   しか記録できず、npm更新後に旧moduleを保持したままのdaemonや、常駐設定が指していないnode実体で
   走っているdaemonを区別できない。attested health応答（instance token必須）へ`version`・
   `node_path`・`node_version`・`bridge_path`を載せる。localのpathなので無認証の可用性probeへは出さない。
7. **`remedy`は自己解消しない状態にだけ出す。** 版差はdaemon自身が版driftを検知して降り、
   supervisorが新codeで起動し直す（ADR外・`bridgeDaemonVersionDrifted`）ので出さない。
   出すのは、消えた実行対象・path乖離・bridge有効なのに常駐設定が無い状態である。
   自己解消する差にコマンドを出すと、本物の障害がその中に埋もれる。

## Consequences

- **既にinstall済みの常駐設定は自動では移行しない。** 焼き直しは`lattice bridge reconfigure`が
  実行された時にだけ起きる。新versionをinstallしただけの端末は、版付きpathを抱えたままである。
  移行はrelease後の1回の`reconfigure`であり、これは運用手順として`docs/bridge-setup.md`が持つ。
- **版付きpathを焼いている既存installを、statusは事前には指摘しない。** 現在の`remedy`条件は
  「実行対象が消えた」であって「消えうる」ではない。`stableNodePath`を持続path側へ再適用して
  差が出れば事前警告できるが、本ADRの範囲には入れていない。
- 新しいplatformの常駐面（Linuxのsystemd unit等）を足す時は、`process.execPath`をそのまま
  焼かず`stableNodePath`を通す。この点は`AGENTS.md`の「実装と検証」が本ADRを指して持つ。
- shim方式環境では起動継続を保証できない。そこでの受入条件は「起動継続」ではなく
  「消滅を`status`が名指しする」であり、testもその形で固定してある。
