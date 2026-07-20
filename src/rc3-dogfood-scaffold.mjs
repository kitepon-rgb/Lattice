import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { invokeSensorCli } from './sensor-runtime.mjs';

import { digestArtifact } from './artifact-contracts.mjs';

/**
 * RC3-D dogfood scaffold（ADR 0044 Decision 11.1〜11.3）。
 *
 * RC2 delivery-policy fixtureの3点（fixture entry・oracle・shared test）を
 * Lattice sourceからbyte-identicalに同一相対pathへ複製したdisposable git repoを、
 * tmpdir配下のworkRootへ新規作成する（Latticeのworktreeにしない）。
 *
 * - oracle bytesはaccepted candidate witness（epoch `delivery-policy-semantic-v2`）の
 *   `fixed_oracle.source_digest`とbindし、不成立はtyped rejection（TypeError）とする。
 *   bind不能を黙って別bytesへfallbackしない（Decision 11.3）。
 * - provenanceはlattice_source（adapter・runnerが属する）とtarget（fixture・changed
 *   pathsが属する）の2 namespaceへ分離して保存する（Decision 11.2）。
 * - 既存repoRootへの上書きscaffoldは拒否する（atomic no-overwrite規律の継承）。
 */

export const RC3_DOGFOOD_SCAFFOLD_PATHS = Object.freeze([
  'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs',
  'src/rc2-delivery-policy-oracle.mjs',
  'test/rc2-delivery-policy-fixture.test.mjs',
]);

const CANDIDATE_SPEC_PATH = 'research/campaigns/rc2/inputs/candidate-spec-v1.json';
const EXPECTED_CANDIDATE_ID = 'shard-delivery-policy-registry-by-channel';
const EXPECTED_CANDIDATE_DIGEST = '4cc5d7bb428a8899353d18524c25105742fa90f89ee55d36064c4be3c52e2907';
const EXPECTED_TREATMENT_EPOCH = 'delivery-policy-semantic-v2';
const ORACLE_PATH = 'src/rc2-delivery-policy-oracle.mjs';
const ADAPTER_PATH = 'src/rc2-delivery-policy-transform.mjs';
const TRANSFORM_ONLY_PATHS = Object.freeze([
  'research/fixtures/delivery-policy-registry/src/email-policy.mjs',
  'research/fixtures/delivery-policy-registry/src/push-policy.mjs',
  'research/fixtures/delivery-policy-registry/src/sms-policy.mjs',
  'test/rc2-delivery-policy-email.test.mjs',
  'test/rc2-delivery-policy-push.test.mjs',
  'test/rc2-delivery-policy-sms.test.mjs',
]);
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const GIT_IDENTITY = ['-c', 'user.email=rc3-dogfood@lattice.invalid', '-c', 'user.name=rc3-dogfood'];

function fail(reason) {
  throw new TypeError(`rc3 dogfood scaffold契約違反: ${reason}`);
}

function plainRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactRecord(value, keys) {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const result = {
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0 && signal === null) resolve(result);
      else reject(new TypeError(`${command} ${args[0]} failed (${signal ?? code}): ${result.stderr.trim()}`));
    });
  });
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function runRaw(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0 && signal === null) resolve(Buffer.concat(stdout));
      else {
        reject(new TypeError(
          `${command} ${args[0]} failed (${signal ?? code}): ${Buffer.concat(stderr).toString('utf8').trim()}`,
        ));
      }
    });
  });
}

// disposable repo自身のroot ignoreへ生成sensor stateを明示し、init後もtreeをcleanに保つ。
// Lattice sourceのtracked bytesとは別物なのでsource provenanceへ混ぜない。
const SENSOR_IGNORE_PATH = '.gitignore';
const SENSOR_IGNORE_BYTES = Buffer.from('.lattice/sensor/\n', 'utf8');

async function readLatticeSources(latticeRoot) {
  // bytesの正はHEAD blob（base commitへ束縛するため）。working treeが
  // HEADと食い違う場合は、dirty bytesをbase shaへ誤帰属させずrejectする。
  const bytesByPath = new Map();
  for (const relativePath of RC3_DOGFOOD_SCAFFOLD_PATHS) {
    let headBytes;
    try {
      headBytes = await runRaw('git', ['show', `HEAD:${relativePath}`], latticeRoot);
    } catch {
      fail(`Lattice HEAD blobを読めない: ${relativePath}`);
    }
    let workingBytes;
    try {
      workingBytes = await readFile(path.join(latticeRoot, relativePath));
    } catch {
      fail(`Lattice sourceを読めない: ${relativePath}`);
    }
    if (!workingBytes.equals(headBytes)) {
      fail(`Lattice working treeがHEADと一致しない（dirty sourceはscaffoldできない）: ${relativePath}`);
    }
    bytesByPath.set(relativePath, headBytes);
  }
  let candidateSpec;
  try {
    candidateSpec = JSON.parse(await readFile(path.join(latticeRoot, CANDIDATE_SPEC_PATH), 'utf8'));
  } catch {
    fail(`candidate specを読めない: ${CANDIDATE_SPEC_PATH}`);
  }
  const candidateDigest = digestArtifact(candidateSpec);
  if (candidateDigest !== EXPECTED_CANDIDATE_DIGEST
    || candidateSpec?.schema !== 'lattice.rc2.boundary_candidate_spec.v1'
    || candidateSpec?.candidate_id !== EXPECTED_CANDIDATE_ID
    || candidateSpec?.fixed_oracle?.path !== ORACLE_PATH) {
    fail('candidate specがaccepted RC2 witnessと一致しない');
  }
  const oracleDigest = sha256(bytesByPath.get(ORACLE_PATH));
  if (oracleDigest !== candidateSpec.fixed_oracle.source_digest) {
    fail(`oracle bytesがaccepted witnessのfixed_oracle.source_digestとbindできない: ${oracleDigest}`);
  }
  return { bytesByPath, candidateSpec, candidateDigest, oracleDigest };
}

function pathDigests(bytesByPath) {
  return Object.fromEntries([...bytesByPath.entries()]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([relativePath, bytes]) => [relativePath, sha256(bytes)]));
}

/**
 * disposable dogfood repoをworkRoot/repoへ新規作成し、scaffold recordを返す。
 */
export async function scaffoldRc3DogfoodRepo(options = {}) {
  if (!exactRecord(options, ['latticeRoot', 'workRoot'])) {
    fail('scaffoldRc3DogfoodRepo optionsがexact shapeでない');
  }
  const { latticeRoot, workRoot } = options;
  if (typeof latticeRoot !== 'string' || latticeRoot.length === 0
    || typeof workRoot !== 'string' || workRoot.length === 0) {
    fail('latticeRoot／workRootが不正');
  }
  const repoRoot = path.join(workRoot, 'repo');
  const { bytesByPath, candidateDigest, oracleDigest } = await readLatticeSources(latticeRoot);
  const targetBytesByPath = new Map(bytesByPath);
  targetBytesByPath.set(SENSOR_IGNORE_PATH, SENSOR_IGNORE_BYTES);
  const latticeHead = (await run('git', ['rev-parse', 'HEAD'], latticeRoot)).stdout.trim();
  if (!GIT_SHA1.test(latticeHead)) fail('Lattice HEADを解決できない');

  // no-overwriteをatomicにする: exclusive mkdirで作成と存在検査を一手にする。
  await mkdir(workRoot, { recursive: true });
  try {
    await mkdir(repoRoot);
  } catch (error) {
    if (error?.code === 'EEXIST') fail(`repoRootが既に存在する（上書き禁止）: ${repoRoot}`);
    throw error;
  }
  for (const [relativePath, bytes] of targetBytesByPath) {
    const absolutePath = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);
  }
  await run('git', ['init', '--quiet', '--initial-branch=main'], repoRoot);
  await run('git', [...GIT_IDENTITY, 'add', '.'], repoRoot);
  await run('git', [...GIT_IDENTITY, 'commit', '--quiet', '-m', 'rc3 dogfood scaffold'], repoRoot);
  const baseSha = (await run('git', ['rev-parse', 'HEAD'], repoRoot)).stdout.trim();
  if (!GIT_SHA1.test(baseSha)) fail('scaffold base shaを解決できない');
  await invokeSensorCli(run, ['init', '.'], repoRoot);

  const status = await run('git', ['status', '--porcelain=v1', '--untracked-files=all'], repoRoot);
  if (status.stdout !== '') fail(`scaffold直後のtreeがcleanではない: ${status.stdout.trim()}`);
  for (const absent of TRANSFORM_ONLY_PATHS) {
    if (await pathExists(path.join(repoRoot, absent))) {
      fail(`transform対象pathがscaffoldに存在してはならない: ${absent}`);
    }
  }

  return Object.freeze({
    schema: 'lattice.rc3.dogfood_scaffold.v1',
    repoRoot,
    lattice_source: Object.freeze({
      root_kind: 'lattice-source',
      base_sha: latticeHead,
      adapter_path: ADAPTER_PATH,
      path_digests: Object.freeze(pathDigests(bytesByPath)),
    }),
    target: Object.freeze({
      root_kind: 'disposable-dogfood',
      base_sha: baseSha,
      path_digests: Object.freeze(pathDigests(targetBytesByPath)),
    }),
    predeclared_treatment: Object.freeze({
      epoch: EXPECTED_TREATMENT_EPOCH,
      candidate_digest: candidateDigest,
      oracle_source_digest: oracleDigest,
      adapter_path: ADAPTER_PATH,
    }),
  });
}

/**
 * scaffold recordに対するdisposable repoの現状をre-verifyする。
 * 違反は例外にせずtyped violationsとして列挙する（親が裁定するため）。
 */
export async function verifyRc3DogfoodScaffold(options = {}) {
  if (!exactRecord(options, ['latticeRoot', 'repoRoot', 'expected'])) {
    fail('verifyRc3DogfoodScaffold optionsがexact shapeでない');
  }
  const { latticeRoot, repoRoot, expected } = options;
  const violations = [];

  // expected record自体を偽造できないよう、predeclared treatment bindingを
  // Lattice sourceから再導出して照合する（保存値を鵜呑みにしない）。
  if (expected?.schema !== 'lattice.rc3.dogfood_scaffold.v1') {
    violations.push({ code: 'EXPECTED_RECORD_INVALID', detail: String(expected?.schema) });
  } else {
    try {
      const rederived = await readLatticeSources(latticeRoot);
      if (expected.predeclared_treatment?.candidate_digest !== rederived.candidateDigest
        || expected.predeclared_treatment?.oracle_source_digest !== rederived.oracleDigest
        || expected.predeclared_treatment?.epoch !== EXPECTED_TREATMENT_EPOCH
        || expected.predeclared_treatment?.adapter_path !== ADAPTER_PATH
        || expected.target?.path_digests?.[ORACLE_PATH] !== rederived.oracleDigest) {
        violations.push({ code: 'TREATMENT_BINDING_DRIFT' });
      }
    } catch (error) {
      violations.push({ code: 'TREATMENT_BINDING_DRIFT', detail: String(error?.message) });
    }
  }

  const head = (await run('git', ['rev-parse', 'HEAD'], repoRoot)).stdout.trim();
  if (head !== expected?.target?.base_sha) {
    violations.push({ code: 'BASE_DRIFT', detail: head });
  }

  // untracked混入を含むdirty treeをrejectする（対象3 path以外の追加も検出する）。
  const status = await run('git', ['status', '--porcelain=v1', '--untracked-files=all'], repoRoot);
  if (status.stdout !== '') {
    violations.push({ code: 'TREE_DIRTY', detail: status.stdout.trim().slice(0, 512) });
  }

  for (const relativePath of RC3_DOGFOOD_SCAFFOLD_PATHS) {
    let targetBytes = null;
    try {
      targetBytes = await readFile(path.join(repoRoot, relativePath));
    } catch {
      violations.push({ code: 'PATH_MISSING', path: relativePath });
      continue;
    }
    const digest = sha256(targetBytes);
    if (digest !== expected?.target?.path_digests?.[relativePath]) {
      violations.push({ code: 'PATH_BYTES_DRIFT', path: relativePath, detail: digest });
    }
    try {
      const latticeBytes = await readFile(path.join(latticeRoot, relativePath));
      if (!latticeBytes.equals(targetBytes)) {
        violations.push({ code: 'LATTICE_SOURCE_DRIFT', path: relativePath });
      }
    } catch {
      violations.push({ code: 'LATTICE_SOURCE_DRIFT', path: relativePath });
    }
  }

  for (const absent of TRANSFORM_ONLY_PATHS) {
    if (await pathExists(path.join(repoRoot, absent))) {
      violations.push({ code: 'TRANSFORM_PATH_PRESENT', path: absent });
    }
  }

  return violations.length === 0
    ? { outcome: 'verified' }
    : { outcome: 'rejected', violations };
}
