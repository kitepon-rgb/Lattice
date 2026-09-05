import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function parseWindowsCreationDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Windows CreationDateを解釈できない');
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new Error('Windows CreationDateを解釈できない');
    return parsed.toISOString();
  }
  const text = String(value ?? '').trim();
  const microsoft = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/u.exec(text);
  if (microsoft) return new Date(Number(microsoft[1])).toISOString();
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Windows CreationDateを解釈できない: ${text}`);
  return parsed.toISOString();
}

export function deliverWorkerSignal(pid, signal) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('pidが正整数でない');
  const jobControl = signal === 'SIGSTOP' || signal === 'SIGCONT';
  if (process.platform === 'win32' && jobControl) {
    return { delivered: false, recorded: true };
  }
  process.kill(pid, signal);
  return { delivered: true, recorded: true };
}

export async function observeWindowsWorkerProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    throw new Error('pidが正整数でない');
  }
  const filter = JSON.stringify(`ProcessId=${pid}`);
  const script = `Get-CimInstance Win32_Process -Filter ${filter} | Select-Object ProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  });
  const row = JSON.parse(stdout.trim() || 'null');
  if (!row || Number(row.ProcessId) !== pid) throw new Error(`Win32_Processを観測できない: ${pid}`);
  const argv = String(row.CommandLine || '').trim();
  const startedIdentity = parseWindowsCreationDate(row.CreationDate);
  if (!argv || !startedIdentity) throw new Error('Windows worker process identityを完全観測できない');
  return {
    pid,
    process_group_id: pid,
    started_identity: startedIdentity,
    argv,
  };
}
