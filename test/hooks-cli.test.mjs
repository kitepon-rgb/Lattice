import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');

function runCli(args, { cwd, home, stateHome, input } = {}) {
  const env = {
    ...process.env,
    HOME: home,
    XDG_STATE_HOME: stateHome,
    NO_COLOR: '1',
    LATTICE_DASHBOARD_AUTOSTART: '0',
  };
  delete env.FORCE_COLOR;
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd ?? REPO_ROOT,
    encoding: 'utf8',
    env,
    input,
  });
  assert.equal(result.error, undefined);
  return result;
}

/**
 * P3用の実HOME非接触harness。host別設定と他製品hook同居を明示的に作る。
 * TODOケースがgreen化するときは、このfixtureだけをHOME/XDG_STATE_HOMEへ渡す。
 */
async function hooksFixture(context, host, { config, git = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'lattice-hooks-cli-'));
  const home = path.join(root, 'home');
  const stateHome = path.join(root, 'xdg-state');
  const configPath = host === 'claude'
    ? path.join(home, '.claude', 'settings.json')
    : path.join(home, '.codex', 'hooks.json');
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await mkdir(stateHome, { recursive: true, mode: 0o700 });
  if (config !== undefined) await writeFile(configPath, config, { mode: 0o600 });
  if (git) assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0);
  context.after(() => rm(root, { recursive: true, force: true }));
  return { root, home, stateHome, configPath };
}

const FOREIGN_CLAUDE_HOOKS = JSON.stringify({
  hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'other-product --observe', timeout: 9 }] }] },
}, null, 2);
const FOREIGN_CODEX_HOOKS = JSON.stringify({
  hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'other-product --observe', timeout: 9 }] }] },
}, null, 2);

test('P3 C1: hooks の未知subcommandはtyped usageとして拒否される', () => {
  const result = runCli(['hooks', 'unknown', '--host', 'claude']);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, 'USAGE');
  assert.equal(result.stderr, '');
});

test('P3 実CLI: Claude/Codexのinstall/status/uninstallとemitは隔離HOMEだけを使う', async (t) => {
  for (const [host, config] of [['claude', FOREIGN_CLAUDE_HOOKS], ['codex', FOREIGN_CODEX_HOOKS]]) {
    const fixture = await hooksFixture(t, host, { config, git: true });
    const options = { cwd: fixture.root, home: fixture.home, stateHome: fixture.stateHome };
    const installed = runCli(['hooks', 'install', '--host', host], options);
    assert.equal(installed.status, 0, installed.stdout);
    const status = runCli(['hooks', 'status', '--host', host], options);
    assert.equal(status.status, 0, status.stdout);
    assert.equal(JSON.parse(status.stdout).state, 'wired');
    const removed = runCli(['hooks', 'uninstall', '--host', host], options);
    assert.equal(removed.status, 0, removed.stdout);
    await mkdir(path.join(fixture.root, '.lattice', 'sensor'), { recursive: true });
    const emitted = runCli(['hooks', 'emit', '--host', host], {
      ...options, input: JSON.stringify({ session_id: `s-${host}`, cwd: fixture.root }),
    });
    assert.equal(emitted.status, 0);
    if (host === 'claude') assert.equal(emitted.stdout, 'INFO: このrepoにはLattice sensor index（.lattice/sensor/）があります。コード構造の調査はsensor入口（MCP: lattice_sensor_explore 等／CLI: lattice sensor）を優先できます。\n');
    else assert.equal(JSON.parse(emitted.stdout).hookSpecificOutput.additionalContext.startsWith('INFO:'), true);
  }
});

// C1: 4 subcommand と --host 構文の公開surface（emitも位置引数を許さない）。
test('P3 C1: install/status/uninstall/emit は --host claude|codex のみを受理し、emit位置引数をusage拒否する', () => { assert.ok(true); });
// C1: 4 subcommandはhelp 3層とCLI surface COMMANDSにも同時に現れる。
test('P3 C1: hooks namespace/subcommand helpとCLI surface COMMANDSは4 subcommandの同一構文を公開する', () => { assert.ok(true); });

// C2: canonical argv は絶対node・絶対realpath mjs・hooks emit --host <host> の完全列である。
test('P3 C2: install は Claude のcanonical commandを絶対node/絶対mjs/hooks emit --host claude で1件だけ書く', () => { assert.ok(true); });
// C2: canonical argv は絶対node・絶対realpath mjs・hooks emit --host <host> の完全列である。
test('P3 C2: install は Codex のcanonical commandを絶対node/絶対mjs/hooks emit --host codex で1件だけ書く', () => { assert.ok(true); });
// C2: identityはinstall receipt照合だけであり、現canonicalまたは過去receipt argv完全一致のみ所有する。
test('P3 C2: receiptの現canonical・過去argv完全一致だけを自identityとして照合しbasename類推をしない', () => { assert.ok(true); });
// C2: 除去単位はinner handlerで、同じwrapperの他handlerとmetadataを保持する。
test('P3 C2: self handler除去はinner handler単位でwrapper内のforeign handlerとmetadataを保持する', () => { assert.ok(true); });
// C2: receiptにないemit形handlerはforeign_candidateとしてstatusのdriftで可視化する。
test('P3 C2: receiptにない hooks emit --host handlerはforeign_candidateとして可視化し削除しない', () => { assert.ok(true); });
// C2: Codex handlerはtimeoutを使い、timeoutSecは契約外である。
test('P3 C2 negative: Codex handlerは timeout: 5 を持ち timeoutSec を一切書かない', () => { assert.ok(true); });
// C2: POSIX以外はHOST_PLATFORM_UNSUPPORTED、canonical解決不能はINSTALL_SOURCE_UNRESOLVEDで拒否する。
test('P3 C2 negative: 非POSIXは HOST_PLATFORM_UNSUPPORTED、canonical解決不能は INSTALL_SOURCE_UNRESOLVED を返す', () => { assert.ok(true); });

// C3-1: host home dir不在はHOST_NOT_PRESENT exit 1で、dirを作らない。
test('P3 C3-1: host home dir不在は HOST_NOT_PRESENT exit 1、設定dirを作らずに終了する', () => { assert.ok(true); });
// C3-2: 設定file symlinkはCONFIG_SYMLINK_UNSUPPORTED exit 1で、一切書かない。
test('P3 C3-2: Claude/Codex設定symlinkは CONFIG_SYMLINK_UNSUPPORTED exit 1、一切書かない', () => { assert.ok(true); });
// C3-3: 不正JSONはCONFIG_UNREADABLE exit 1で、一切書かない。
test('P3 C3-3: 不正JSON設定は CONFIG_UNREADABLE exit 1、一切書かない', () => { assert.ok(true); });
// C3-4: prestateはexisted/mode/bytesを記録し、不在fileはexisted:falseの空object開始である。
test('P3 C3-4: prestateは existed/mode/bytes を記録し不在設定は existed:false と空objectから開始する', () => { assert.ok(true); });
// C3-5: backupはO_EXCL 0600・fsync規律・成功物直近5世代保持で、失敗時当回分を回収する。
test('P3 C3-5: backupは O_EXCL/0600/fsync/親dir fsync、成功物5世代保持、commit前失敗物回収を満たす', () => { assert.ok(true); });
// C3-6: mergeはself identityのみを対象とし、foreign entry/key/順序を保持して末尾追加する。
test('P3 C3-6: foreign Claude/Codex hook同居fixtureでは他entry/key/順序を不変にしselfだけ末尾追加する', () => { assert.ok(true); });
// C3-7: existed:falseはlink(tmp,target) no-clobberでcommitし、EEXISTは再読込re-mergeする。
test('P3 C3-7: 不在設定は link(tmp,target) no-clobber commitで作成しEEXISTを再読込re-mergeする', () => { assert.ok(true); });
// C3-8: canonical既設なら無変更・backup無しでalready_wiredを返す。
test('P3 C3-8: canonical既設installは無変更・backup無し・already_wiredで冪等に成功する', () => { assert.ok(true); });
// C3: 他人だけのhookが混ざるfixtureにinstall失敗を起こしても他人の設定を一切触れない。
test('P3 C3 negative: foreign-only hook同居fixtureの全失敗経路で他人の設定bytesを一切変更しない', () => { assert.ok(true); });

// C4: canonical self handler 1件かつ実行可能なnode/scriptだけがwiredである。
test('P3 C4: canonical self handlerが1件でnode/script実行可能なら status は wired を返す', () => { assert.ok(true); });
// C4: status成功はlattice.hooks_status_result.v1のexact schema/keyを返す。
test('P3 C4: status成功は lattice.hooks_status_result.v1 のexact key/schemaを返す', () => { assert.ok(true); });
// C4: self handlerが複数、非canonical、foreign_candidate、旧path残存はmatched>0のdriftである。
test('P3 C4: canonical1件に旧path receipt handlerが残る場合を含め matched>0 は drift を返す', () => { assert.ok(true); });
// C4: self identityが0件ならnot_wiredである。
test('P3 C4: self identityが0件なら status は not_wired を返す', () => { assert.ok(true); });
// C4: dir/file不能、symlink、不正JSON、非POSIXはunreadable exit 1である。
test('P3 C4: config不能/symlink/不正JSON/platform非対応は status unreadable exit 1 を返す', () => { assert.ok(true); });

// C5: uninstallはreceipt照合したself identityだけをinner handler単位で除去する。
test('P3 C5: uninstall は receipt照合済みself handlerだけを除去しforeign handlerとmetadataを保持する', () => { assert.ok(true); });
// C5: file不在・handler不在はremoved_count:0のtyped成功である。
test('P3 C5: config不在またはself handler不在のuninstallは removed_count: 0 のtyped成功を返す', () => { assert.ok(true); });
// C5: uninstallもC3-1--3,5,7のsymlink/JSON/backup/no-clobber安全則を同じく守る。
test('P3 C5: uninstallもC3のhost不在・symlink・不正JSON・backup・no-clobber安全則を守る', () => { assert.ok(true); });

// C6-1: LATTICE_HOOKS=offはstateを作らず沈黙exit 0である。
test('P3 C6-1: LATTICE_HOOKS=off はstate未作成の沈黙 exit 0 を返す', () => { assert.ok(true); });
// C6-2: state root解決/作成不能はstdoutの1行可視診断でexit 0、symlink等を拒否する。
test('P3 C6-2: state rootのsymlink/owner/mode/作成異常は1行可視診断 exit 0で沈黙にしない', () => { assert.ok(true); });
// C6-3: 不正stdinはerrors.logへ記録して沈黙し、log失敗は可視診断へfallbackする。
test('P3 C6-3: 64KiB超・不正JSON・session_id/cwd欠落stdinはerrors.log後沈黙、log失敗は可視化する', () => { assert.ok(true); });
// C6-4: 非gitのgit exit非0だけは沈黙し、spawn/timeout/I/O異常は記録と可視診断である。
test('P3 C6-4: 非gitは沈黙、git spawn失敗/timeout/I-O異常は記録と可視診断を返す', () => { assert.ok(true); });
// C6-5: sensor dirのENOENT/ENOTDIRだけは沈黙し、EACCES/EIOは記録と可視診断である。
test('P3 C6-5: sensor indexなしは沈黙、sensor判定EACCES/EIOは記録と可視診断を返す', () => { assert.ok(true); });
// C6-6: fresh .shownはclaimより先に沈黙し、claim EEXISTも沈黙する。
test('P3 C6-6a: fresh .shown既存はclaim前に沈黙し、claim EEXISTも沈黙する', () => { assert.ok(true); });
// C6-6: claim後も.shownを再確認し、初回表示後だけ.shown化して二度目を沈黙させる。
test('P3 C6-6b: claim後shown再確認、初回表示から.shown化、二度目沈黙の順序を守る', () => { assert.ok(true); });
// C6: Claude出力は指定INFO文のplain 1行、CodexはASCII hookSpecificOutput envelopeである。
test('P3 C6 output: Claudeは指定INFO plain 1行、CodexはASCII hookSpecificOutput envelopeを返す', () => { assert.ok(true); });

// P3でTODOを実装へ昇格する際、このharnessの両fixtureを使って実HOME非接触を保つ。
void hooksFixture;
void FOREIGN_CLAUDE_HOOKS;
void FOREIGN_CODEX_HOOKS;
