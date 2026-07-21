# AIShell runtime conflict dogfood

- Date: 2026-07-22
- Lattice implementation commit: `f50d3fc`
- AIShell request commit: `1c7d7c0`
- Target task: `lpg-030`

## Live AIShell compile

AIShellのChangeSet実装で同時編集対象になったSwift pathを、公開`lattice plan compile`とfresh sensorで解析した。

- `ChangeSetService.swift`のaffected queryから34件のSwift testを再導出した。
- `ChangeSetSafetyNetTests.swift`を含む実affected集合をrequest witnessへ固定した。
- `ChangeSetService.swift`の重複所有を競合として検出し、2 waveへ直列化した。
- sensorのCLI側だけが`Tests/`と`*Tests.swift`を認識しない二重実装を発見し、共有のrunnable test判定へ統合した。

## Disposable AIShell fixture

実製品と同じ`Sources/AIShellCore/ChangeSet*.swift` pathとsymbolを持つ一時git worktreeを作り、公開CLIだけで次を検証した。

1. shared path / symbol / resourceの競合をfresh compileで検出し、最低2 waveへ分ける。
2. `intentional_serial`で`ChangeSetService`側をstay、store側をcarryにする。
3. Coordinator seamを単一ownerへ移したsuccessorをfresh compileし、競合なし・1 waveを確認する。
4. conflict finding、hold、queued evidenceをactive epochへ束縛してrecompileする。
5. successor stage直後にmanaged supervisorを`SIGKILL`し、commit pointerがepoch 1のままなのを確認する。
6. 新しいPIDとsession nonceでactivateし、pending transactionをreprocessしてepoch 2へcommitする。
7. intake再開、runtime freeze解除、event chain検証、abandon後のprocess停止を確認する。

## Verification

- `node --test test/integration/aishell-runtime-conflict-dogfood.integration.mjs`: 1/1 green
- `node --test test/integration/aishell-runtime-conflict-dogfood.integration.mjs test/runtime-conflict-cli.test.mjs test/rc3-hold-recompile.test.mjs test/runtime-hold-public-contract.test.mjs`: 41/41 green
- `git diff --check`: green

この証拠は「競合を検出できる」だけでなく、stay、seam分割、process crash、durable recovery、再処理まで公開surfaceで閉じることを受入範囲とする。
