import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ENTRYPOINT = 'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs';

const CASES = Object.freeze([
  ['email-routine', { channel: 'email', urgency: 'routine' }, { channel: 'email', transport: 'smtp', retry_limit: 3, delay_seconds: 60 }],
  ['email-urgent', { channel: 'email', urgency: 'urgent' }, { channel: 'email', transport: 'smtp', retry_limit: 5, delay_seconds: 0 }],
  ['sms-routine', { channel: 'sms', urgency: 'routine' }, { channel: 'sms', transport: 'sms', retry_limit: 2, delay_seconds: 30 }],
  ['sms-urgent', { channel: 'sms', urgency: 'urgent' }, { channel: 'sms', transport: 'sms', retry_limit: 4, delay_seconds: 0 }],
  ['push-routine', { channel: 'push', urgency: 'routine' }, { channel: 'push', transport: 'push', retry_limit: 1, delay_seconds: 10 }],
  ['push-urgent', { channel: 'push', urgency: 'urgent' }, { channel: 'push', transport: 'push', retry_limit: 3, delay_seconds: 0 }],
]);

const CHILD_PROGRAM = String.raw`
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [entrypoint, serializedCases] = process.argv.slice(1);
const cases = JSON.parse(serializedCases);
const targetModule = await import(pathToFileURL(entrypoint).href);
if (typeof targetModule.resolveDeliveryPolicy !== 'function') {
  throw new TypeError('resolveDeliveryPolicy export is not a function');
}
const case_results = cases.map(({ id, input }) => ({
  id,
  output_digest: createHash('sha256')
    .update(JSON.stringify(targetModule.resolveDeliveryPolicy(input)))
    .digest('hex'),
}));
process.stdout.write(JSON.stringify({ case_results }) + '\n');
`;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function exactRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function expectedDigest(value) {
  return sha256(JSON.stringify(value));
}

async function resolveEntrypoint(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('repoRoot must be a non-empty path');
  }
  const root = await realpath(repoRoot);
  const entrypoint = await realpath(path.resolve(root, ENTRYPOINT));
  if (!inside(root, entrypoint)) throw new TypeError('delivery policy entrypoint is outside repoRoot');
  return entrypoint;
}

function parseChildReceipt(stdout) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new TypeError('delivery policy oracle child returned invalid JSON');
  }
  if (!exactRecord(value, ['case_results'])
    || !Array.isArray(value.case_results)
    || value.case_results.length !== CASES.length) {
    throw new TypeError('delivery policy oracle child receipt shape is invalid');
  }
  return value.case_results;
}

/** 指定worktreeのfixtureをfresh Node processでblack-box照合する。 */
export async function runRc2DeliveryPolicyOracle({ repoRoot } = {}) {
  const entrypoint = await resolveEntrypoint(repoRoot);
  const childCases = CASES.map(([id, input]) => ({ id, input }));
  let stdout;
  let stderr;
  try {
    ({ stdout, stderr } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '--eval',
      CHILD_PROGRAM,
      entrypoint,
      JSON.stringify(childCases),
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 }));
  } catch (error) {
    throw new Error(`delivery policy oracle child failed: ${error.message}`, { cause: error });
  }
  if (stderr.length !== 0) throw new Error('delivery policy oracle child wrote stderr');

  const childResults = parseChildReceipt(stdout);
  const caseResults = childResults.map((result, index) => {
    const [id, _input, expected] = CASES[index];
    if (!exactRecord(result, ['id', 'output_digest'])
      || result.id !== id
      || typeof result.output_digest !== 'string'
      || !/^[0-9a-f]{64}$/.test(result.output_digest)) {
      throw new TypeError('delivery policy oracle child case receipt is invalid');
    }
    if (result.output_digest !== expectedDigest(expected)) {
      throw new Error(`delivery policy behavior mismatch: ${id}`);
    }
    return { id, outcome: 'passed', output_digest: result.output_digest };
  });
  return {
    schema: 'lattice.rc2.delivery_policy_oracle_receipt.v1',
    outcome: 'passed',
    case_results: caseResults,
  };
}
