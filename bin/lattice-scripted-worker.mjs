#!/usr/bin/env node
/**
 * scripted executorのworker process（ADR 0143 Decision 9）。
 *
 * **別processであること自体が要件である。** holdは静止の証明を要求し、直接OS観測は
 * executorのprocessが実際に停止していることまで確かめる。controller自身のprocessで
 * 作業していると、止めれば応答できず、止めなければ証明できない。
 *
 * 書いたあとも生きたまま待つ。作業を終えて消えてしまうと、barrierが掛かった時に
 * 止めるべきprocessが存在せず、静止を証明する相手が居なくなる。
 */

import { readFile } from 'node:fs/promises';

import { executePacket } from '../src/runtime-scripted-adapter-controller.mjs';

const MAX_JOB_BYTES = 8_388_608;

function fail(reason) {
  process.stderr.write(`${JSON.stringify({
    schema: 'lattice.scripted_worker_error.v1', reason,
  })}\n`);
  process.exit(1);
}

const jobPath = process.argv[2];
if (typeof jobPath !== 'string' || jobPath.length === 0) fail('job pathが渡されていない');

let job;
try {
  const bytes = await readFile(jobPath);
  if (bytes.length > MAX_JOB_BYTES) fail('jobが上限byteを超える');
  job = JSON.parse(bytes.toString('utf8'));
} catch (error) {
  fail(`jobを読めない: ${String(error?.message ?? error)}`);
}
if (job?.schema !== 'lattice.scripted_worker_job.v1') fail('job schemaが不正');

let result;
try {
  result = await executePacket({
    packet: job.packet,
    repoRoot: job.worktree_path,
    extraWrites: job.extra_writes ?? [],
  });
} catch (error) {
  fail(`実行に失敗した: ${String(error?.detail?.reason ?? error?.message ?? error)}`);
}

// 完了はstdoutの1行で報せる。controllerはこれを受けてreceiptを組む。
process.stdout.write(`${JSON.stringify({
  schema: 'lattice.scripted_worker_result.v1',
  observed_diff: result.observedDiff,
  checkpoint_digest: result.checkpointDigest,
})}\n`);

// 生きたまま待つ。ここがrunの「作業中」であり、barrierはこのprocessを止めて静止を証明する。
const holdMs = Number.isSafeInteger(job.hold_ms) && job.hold_ms > 0 ? job.hold_ms : 0;
if (holdMs > 0) await new Promise((resolve) => { setTimeout(resolve, holdMs); });
