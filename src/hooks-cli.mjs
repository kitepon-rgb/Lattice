import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { mkdir, open, readFile, realpath, readdir, rename, lstat, link, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const INFO = 'INFO: このrepoにはLattice sensor index（.lattice/sensor/）があります。コード構造の調査はsensor入口（MCP: lattice_sensor_explore 等／CLI: lattice sensor）を優先できます。';
const HOSTS = new Set(['claude', 'codex']);
const binPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/lattice.mjs');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const failure = (stdout, code, message, exit = 1) => { stdout.write(`${JSON.stringify({ schema: 'lattice.hooks_error.v1', code, message })}\n`); return exit; };
const configPath = (home, host) => path.join(home, host === 'claude' ? '.claude/settings.json' : '.codex/hooks.json');
const stateBase = (env) => path.isAbsolute(env.XDG_STATE_HOME ?? '') ? env.XDG_STATE_HOME : path.join(env.HOME ?? os.homedir(), '.local/state');
const receiptPath = (env, host) => path.join(stateBase(env), 'lattice', 'hooks', 'installs', `${host}.json`);

function words(command) {
  const out = []; let word = ''; let quote = null; let escaped = false;
  for (const char of command) {
    if (escaped) { word += char; escaped = false; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if ((char === "'" || char === '"') && (!quote || quote === char)) { quote = quote ? null : char; continue; }
    if (/\s/u.test(char) && !quote) { if (word) out.push(word); word = ''; } else word += char;
  }
  if (quote || escaped) return null;
  if (word) out.push(word);
  return out;
}
function shell(argv) { return argv.map((item) => `'${item.replaceAll("'", "'\\\"'\\\"'")}'`).join(' '); }
function commandIs(command, identities) { const parsed = words(command); return parsed !== null && identities.some((identity) => identity.length === parsed.length && identity.every((part, index) => part === parsed[index])); }
async function readReceipt(env, host) { try { const value = JSON.parse(await readFile(receiptPath(env, host), 'utf8')); return Array.isArray(value.entries) ? value.entries.map((entry) => entry.argv).filter(Array.isArray) : []; } catch { return []; } }
async function saveReceipt(env, host, argv) {
  const target = receiptPath(env, host); await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const old = await readReceipt(env, host); const entries = [...old, argv].filter((item, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(item)) === index);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`; await writeFile(tmp, JSON.stringify({ schema: 'lattice.hooks_install_receipt.v1', entries: entries.map((item) => ({ argv: item, status: 'committed' })) }) + '\n', { mode: 0o600 }); await rename(tmp, target);
}
async function fsyncDir(directory) { const handle = await open(directory, fsConstants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }
async function readConfig(target) {
  try { const info = await lstat(target); if (info.isSymbolicLink()) throw Object.assign(new Error('symlink'), { code: 'SYMLINK' }); const bytes = await readFile(target); return { existed: true, mode: info.mode & 0o777, bytes, value: JSON.parse(bytes) }; } catch (error) {
    if (error?.code === 'ENOENT') return { existed: false, mode: 0o600, bytes: Buffer.alloc(0), value: {} };
    throw error;
  }
}
function hooksList(value) { if (!value.hooks || typeof value.hooks !== 'object' || Array.isArray(value.hooks)) value.hooks = {}; if (!Array.isArray(value.hooks.UserPromptSubmit)) value.hooks.UserPromptSubmit = []; return value.hooks.UserPromptSubmit; }
function stripIdentity(value, identities) {
  let removed = 0; const list = hooksList(value);
  value.hooks.UserPromptSubmit = list.flatMap((wrapper) => {
    if (!wrapper || !Array.isArray(wrapper.hooks)) return [wrapper];
    const hooks = wrapper.hooks.filter((handler) => { const owned = handler?.type === 'command' && typeof handler.command === 'string' && commandIs(handler.command, identities); if (owned) removed += 1; return !owned; });
    return hooks.length ? [{ ...wrapper, hooks }] : [];
  });
  return removed;
}
async function backup(target, prestate) {
  if (!prestate.existed) return null;
  const ref = `${target}.bak-lattice-hooks-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const handle = await open(ref, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600); try { await handle.writeFile(prestate.bytes); await handle.sync(); } finally { await handle.close(); } await fsyncDir(path.dirname(target)); return ref;
}
async function commitConfig(target, prestate, value) {
  const serialized = Buffer.from(`${JSON.stringify(value, null, 2)}\n`); JSON.parse(serialized);
  const tmp = `${target}.tmp-lattice-hooks-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const handle = await open(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, prestate.existed ? prestate.mode : 0o600);
  try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
  if (prestate.existed) {
    const now = await readFile(target); if (!now.equals(prestate.bytes)) { await unlink(tmp); throw Object.assign(new Error('preimage changed'), { code: 'PREIMAGE_CHANGED' }); }
    const displaced = `${target}.pre-lattice-hooks-${Date.now()}-${process.pid}`; await link(target, displaced); const before = await lstat(target); const saved = await lstat(displaced); if (before.dev !== saved.dev || before.ino !== saved.ino) { await unlink(tmp); throw Object.assign(new Error('target replaced'), { code: 'PREIMAGE_CHANGED' }); }
    await rename(tmp, target); await fsyncDir(path.dirname(target));
  } else { try { await link(tmp, target); } catch (error) { await unlink(tmp).catch(() => {}); throw error; } await unlink(tmp); await fsyncDir(path.dirname(target)); }
  const check = await readFile(target); if (!check.equals(serialized)) throw Object.assign(new Error('read-back failed'), { code: 'RESTORE_FAILED' });
}
async function canonical(host) { return [process.execPath, await realpath(binPath), 'hooks', 'emit', '--host', host]; }
function handler(host, command) { return host === 'claude' ? { type: 'command', command, timeout: 5 } : { type: 'command', command, timeout: 5, async: false, statusMessage: null }; }
async function mutate(host, env, stdout, uninstall) {
  const home = env.HOME ?? os.homedir(); const directory = path.dirname(configPath(home, host));
  try { if (!(await lstat(directory)).isDirectory()) return failure(stdout, 'HOST_NOT_PRESENT', 'host home directory is not present'); } catch { return failure(stdout, 'HOST_NOT_PRESENT', 'host home directory is not present'); }
  const target = configPath(home, host); let prestate;
  try { prestate = await readConfig(target); } catch (error) { return failure(stdout, error.code === 'SYMLINK' ? 'CONFIG_SYMLINK_UNSUPPORTED' : 'CONFIG_UNREADABLE', 'configuration cannot be read'); }
  const current = await canonical(host); const identities = [current, ...await readReceipt(env, host)]; const removed = stripIdentity(prestate.value, identities);
  if (!uninstall) hooksList(prestate.value).push({ hooks: [handler(host, shell(current))] });
  if ((uninstall && removed === 0) || (!uninstall && removed === 1 && JSON.stringify(prestate.value) === JSON.stringify((await readConfig(target)).value))) {
    stdout.write(`${JSON.stringify(uninstall ? { schema: 'lattice.hooks_uninstall_result.v1', host, removed_count: 0 } : { schema: 'lattice.hooks_install_result.v1', host, state: 'already_wired' })}\n`); return 0;
  }
  try { await backup(target, prestate); await commitConfig(target, prestate, prestate.value); if (!uninstall) await saveReceipt(env, host, current); } catch (error) { return failure(stdout, error.code === 'RESTORE_FAILED' ? 'RESTORE_FAILED' : 'CONFIG_WRITE_FAILED', 'configuration cannot be safely written'); }
  stdout.write(`${JSON.stringify(uninstall ? { schema: 'lattice.hooks_uninstall_result.v1', host, removed_count: removed } : { schema: 'lattice.hooks_install_result.v1', host, state: 'wired' })}\n`); return 0;
}
async function status(host, env, stdout) {
  const home = env.HOME ?? os.homedir(); const target = configPath(home, host); const argv = await canonical(host); let config;
  try { config = await readConfig(target); } catch { return failure(stdout, 'CONFIG_UNREADABLE', 'configuration cannot be read'); }
  const identities = [argv, ...await readReceipt(env, host)]; let matches = 0; let foreign = 0;
  for (const wrapper of hooksList(config.value)) for (const item of wrapper?.hooks ?? []) if (item?.type === 'command' && typeof item.command === 'string') { if (commandIs(item.command, identities)) matches += 1; else if (words(item.command)?.join(' ').includes('hooks emit --host')) foreign += 1; }
  const executableOk = await Promise.all(argv.slice(0, 2).map(async (entry) => { try { return (await lstat(entry)).isFile(); } catch { return false; } })).then((value) => value.every(Boolean));
  const state = matches === 1 && commandIs(shell(argv), [argv]) && executableOk && foreign === 0 ? 'wired' : matches ? 'drift' : 'not_wired';
  stdout.write(`${JSON.stringify({ schema: 'lattice.hooks_status_result.v1', host, config_path: target, state, canonical_command: shell(argv), matched_handler_count: matches, executable_ok: executableOk, next_action: state === 'wired' ? null : 'lattice hooks install --host ' + host })}\n`); return 0;
}
async function stateDirectory(env) { const root = stateBase(env); await mkdir(root, { recursive: true, mode: 0o700 }); let cursor = root; for (const component of ['lattice', 'hooks']) { cursor = path.join(cursor, component); try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error('symlink'); } catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(cursor, { mode: 0o700 }); } } return cursor; }
async function emit(host, env, stdin, stdout) {
  if (env.LATTICE_HOOKS === 'off') return 0; let state;
  try { state = await stateDirectory(env); } catch { stdout.write('Lattice hooks: state directory unavailable\n'); return 0; }
  let input = ''; for await (const chunk of stdin) { input += chunk; if (Buffer.byteLength(input) > 65536) break; }
  let event; try { event = JSON.parse(input); if (!event.session_id || !event.cwd || Buffer.byteLength(input) > 65536) throw new Error('invalid'); } catch { try { await writeFile(path.join(state, 'errors.log'), 'invalid hook stdin\n', { flag: 'a', mode: 0o600 }); } catch { stdout.write('Lattice hooks: cannot record invalid stdin\n'); } return 0; }
  const root = await new Promise((resolve, reject) => { const child = spawn('git', ['--no-optional-locks', '-C', event.cwd, 'rev-parse', '--show-toplevel']); let out = ''; child.stdout.on('data', (data) => { out += data; }); child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(out.trim()) : resolve(null)); setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 2000).unref(); }).catch(() => undefined);
  if (!root) return 0; try { await lstat(path.join(root, '.lattice', 'sensor')); } catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return 0; stdout.write('Lattice hooks: sensor index unavailable\n'); return 0; }
  const key = `${hash(event.session_id)}.${hash(root)}`; const shown = path.join(state, `${key}.shown`); try { if (Date.now() - (await lstat(shown)).mtimeMs < 7 * 864e5) return 0; } catch {}
  const claim = path.join(state, `${key}.claim`); try { await writeFile(claim, `${process.pid}\n`, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code === 'EEXIST') return 0; stdout.write('Lattice hooks: notification claim unavailable\n'); return 0; }
  try { if (Date.now() - (await lstat(shown)).mtimeMs < 7 * 864e5) { await unlink(claim); return 0; } } catch {}
  stdout.write(host === 'claude' ? `${INFO}\n` : `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: INFO } })}\n`); try { await rename(claim, shown); } catch { await writeFile(shown, '', { flag: 'wx', mode: 0o600 }).catch(() => {}); } return 0;
}
export async function runHooksCli({ argv, stdout, stdin = process.stdin, env = process.env }) {
  if (argv.length !== 3 || !['install', 'status', 'uninstall', 'emit'].includes(argv[0]) || argv[1] !== '--host' || !HOSTS.has(argv[2])) return failure(stdout, 'USAGE', 'usage: lattice hooks <install|status|uninstall|emit> --host <claude|codex>', 2);
  const [command, , host] = argv; if (process.platform === 'win32' && command !== 'emit') return failure(stdout, 'HOST_PLATFORM_UNSUPPORTED', 'native Windows hooks are unsupported');
  if (command === 'install') return mutate(host, env, stdout, false); if (command === 'uninstall') return mutate(host, env, stdout, true); if (command === 'status') return status(host, env, stdout); return emit(host, env, stdin, stdout);
}
