import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalizeArtifact } from '../src/artifact-contracts.mjs';
import { selfDigest } from '../src/runtime-contracts.mjs';
import { validateRuntimeAdapterCapabilities } from '../src/runtime-controller-protocol.mjs';
import { validateRunWorkOrder } from '../src/runtime-work-order-contracts.mjs';
import {
  createWorkOrderAdapterCapabilities,
  runtimeWorkOrderControllerInternal,
  spawnWorkOrderWorker,
} from '../src/runtime-work-order-controller.mjs';
import { reapDaemonsUnder } from './helpers/managed-daemon-fixture.mjs';

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
}

function packet(baseSha) {
  const value = {
    schema: 'lattice.executor_packet.v1',
    packet_id: 'packet-a',
    todo_id: 'T1',
    task_ref: 'task-a',
    scope: { writes: ['src/a.mjs'] },
    base_sha: baseSha,
    plan_ref: 'plan-a',
    plan_epoch: 1,
    verifier_refs: ['node --test test/a.test.mjs'],
    forbidden_operations: ['push', 'branch', 'merge', 'rebase', 'reset', 'stash'],
    context_content_digest: 'c'.repeat(64),
    packet_digest: '',
  };
  value.packet_digest = selfDigest(value, 'packet_digest');
  return value;
}

async function waitForFile(filePath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return await readFile(filePath, 'utf8'); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`file did not appear: ${filePath}`);
}

async function publishReport(reportPath, value) {
  const temporary = `${reportPath}.publish`;
  await writeFile(temporary, `${canonicalizeArtifact(value)}\n`, { mode: 0o600 });
  await rename(temporary, reportPath);
}

test('work-order controllerはhost駆動managed epochをv2能力で宣言する', () => {
  const capabilities = createWorkOrderAdapterCapabilities();
  assert.equal(validateRuntimeAdapterCapabilities(capabilities), true);
  assert.equal(capabilities.schema, 'lattice.runtime_adapter_capabilities.v2');
  assert.equal(capabilities.host_driven_epoch, true);
  assert.equal(selfDigest(capabilities, 'capabilities_digest'), capabilities.capabilities_digest);
});

test('work-order workerはreportを合図にしdiffをLattice自身で観測する', async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'lattice-work-order-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worktreePath = path.join(root, 'tree');
  const spoolDir = path.join(root, 'spool');
  await mkdir(path.join(worktreePath, 'src'), { recursive: true });
  await mkdir(path.join(spoolDir, 'orders'), { recursive: true });
  await mkdir(path.join(spoolDir, 'reports'), { recursive: true });
  await writeFile(path.join(worktreePath, 'src', 'a.mjs'), 'export const a = 1;\n');
  git(['init', '--quiet', '--initial-branch=main'], worktreePath);
  git(['-c', 'user.name=a', '-c', 'user.email=a@example.invalid', 'add', '.'], worktreePath);
  git(['-c', 'user.name=a', '-c', 'user.email=a@example.invalid',
    'commit', '--quiet', '-m', 'base'], worktreePath);
  const baseSha = git(['rev-parse', 'HEAD'], worktreePath);
  const executorPacket = packet(baseSha);
  const orderPath = path.join(spoolDir, 'orders', `${executorPacket.packet_digest}.json`);
  const reportPath = path.join(spoolDir, 'reports', `${executorPacket.packet_digest}.json`);

  const seatScript = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],",
    "  { detached: true, stdio: 'ignore' });",
    'child.unref();',
    "process.stdout.write(String(child.pid) + '\\n');",
    'setInterval(() => {}, 1000);',
  ].join('\n');
  const seat = spawn(process.execPath, ['-e', seatScript], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  assert.equal(Number.isSafeInteger(seat.pid), true);
  const [childPidBytes] = await once(seat.stdout, 'data');
  const detachedChildPid = Number(String(childPidBytes).trim());
  assert.equal(Number.isSafeInteger(detachedChildPid), true);
  seat.stdout.destroy();
  t.after(() => reapDaemonsUnder(root, [detachedChildPid, seat.pid]));

  if (process.platform === 'win32') {
    await assert.rejects(
      runtimeWorkOrderControllerInternal.observeWorkerProcessTree(seat.pid),
      (error) => error.code === 'WORK_ORDER_REPORT_INVALID'
        && error.message.includes('worker_pidをOS観測できない'),
    );
    return;
  }

  const dispatchObservation = await runtimeWorkOrderControllerInternal.observeWorkerProcessTree(
    seat.pid,
    { requireDescendantsInRootGroup: false },
  );
  assert.equal(dispatchObservation.processGroupId, seat.pid);
  await assert.rejects(
    runtimeWorkOrderControllerInternal.observeWorkerProcessTree(seat.pid),
    (error) => error.code === 'WORK_ORDER_REPORT_INVALID'
      && error.message.includes('worker childがrootと別process groupに居る'),
  );

  // 前runのdoneが残っていても、新orderより前に消されて誤受理されない。
  await writeFile(reportPath, `${canonicalizeArtifact({
    schema: 'lattice.run_work_report.v1',
    packet_digest: executorPacket.packet_digest,
    state: 'done',
    worker_pid: seat.pid,
  })}\n`, { mode: 0o600 });

  const workerPromise = spawnWorkOrderWorker({
    packet: executorPacket,
    worktreePath,
    spoolDir,
  });
  const order = JSON.parse(await waitForFile(orderPath));
  assert.equal(validateRunWorkOrder(order), true);
  assert.deepEqual(order.scope_writes, executorPacket.scope.writes);

  const report = (state) => ({
    schema: 'lattice.run_work_report.v1',
    packet_digest: executorPacket.packet_digest,
    state,
    worker_pid: seat.pid,
  });
  await publishReport(reportPath, report('working'));
  const worker = await workerPromise;
  assert.equal(worker.pid, seat.pid);
  assert.equal(worker.process_membership, 'dynamic_group');
  await writeFile(path.join(worktreePath, 'src', 'a.mjs'), 'export const a = 2;\n');
  await publishReport(reportPath, report('done'));
  const completed = await worker.completed;
  assert.deepEqual(completed.observedDiff, [{ path: 'src/a.mjs', change: 'modified' }]);
  assert.match(completed.checkpointDigest, /^[0-9a-f]{64}$/u);
});
