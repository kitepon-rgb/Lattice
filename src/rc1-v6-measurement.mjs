import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  digestArtifact,
  validateTransformArtifact,
} from './artifact-contracts.mjs';
import { compileBoundaryCondition } from './boundary-compiler.mjs';
import { validateRc1EvidenceBundle } from './rc1-evidence-bundle.mjs';
import {
  createRc1V6EvidenceBundleDescriptor,
  verifyRc1V6RunEvidence,
} from './rc1-v6-causal-binding.mjs';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA1 = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const execFileAsync = promisify(execFile);

function exactRecord(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function repoPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').includes('..');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceSnapshot(files) {
  const snapshot = {
    schema: 'lattice.rc1.source_snapshot.v1',
    files,
  };
  digestArtifact(snapshot);
  return snapshot;
}

function validSnapshotFile(value, index, files) {
  return exactRecord(value, ['path', 'state', 'content_digest'])
    && repoPath(value.path)
    && (index === 0 || files[index - 1].path < value.path)
    && (value.state === 'file' || value.state === 'absent')
    && (value.state === 'file'
      ? typeof value.content_digest === 'string' && SHA256.test(value.content_digest)
      : value.content_digest === null);
}

function validateSourceSnapshot(value) {
  return exactRecord(value, ['schema', 'files'])
    && value.schema === 'lattice.rc1.source_snapshot.v1'
    && Array.isArray(value.files)
    && value.files.length > 0
    && value.files.length <= 256
    && value.files.every(validSnapshotFile);
}

/** behavior fixed surfaceをCodegraph measurement用source snapshotへ投影する。 */
export function sourceSnapshotFromRc1BehaviorSurface(surface) {
  if (!exactRecord(surface, ['schema', 'files'])
    || surface.schema !== 'lattice.rc1.behavior_surface_snapshot.v1'
    || !Array.isArray(surface.files)
    || surface.files.length === 0) {
    throw new TypeError('RC1 v6 behavior surface snapshotが不正');
  }
  const files = surface.files.map((file, index) => {
    if (!exactRecord(file, ['path', 'state', 'content_digest'])
      || !repoPath(file.path)
      || (index > 0 && surface.files[index - 1].path >= file.path)
      || (file.state !== 'present' && file.state !== 'absent')
      || (file.state === 'present' && !SHA256.test(file.content_digest))
      || (file.state === 'absent' && file.content_digest !== null)) {
      throw new TypeError('RC1 v6 behavior surface fileが不正');
    }
    return {
      path: file.path,
      state: file.state === 'present' ? 'file' : 'absent',
      content_digest: file.content_digest,
    };
  });
  return sourceSnapshot(files);
}

/** accepted transform outputをtreatmentの期待source snapshotへ投影する。 */
export function sourceSnapshotFromRc1TransformOutput(transformArtifact) {
  if (!validateTransformArtifact(transformArtifact)
    || transformArtifact.status !== 'accepted'
    || !Array.isArray(transformArtifact.output?.files)
    || transformArtifact.output.files.length === 0) {
    throw new TypeError('RC1 v6 accepted transform outputが不正');
  }
  const files = transformArtifact.output.files.map((file, index) => {
    if (!exactRecord(file, ['path', 'content_digest'])
      || !repoPath(file.path)
      || !SHA256.test(file.content_digest)
      || (index > 0 && transformArtifact.output.files[index - 1].path >= file.path)) {
      throw new TypeError('RC1 v6 transform output fileが不正');
    }
    return { path: file.path, state: 'file', content_digest: file.content_digest };
  });
  return sourceSnapshot(files);
}

/** 実repoのfixed path bytesからsorted source snapshotを取得する。 */
export async function captureRc1V6SourceSnapshot({ repoRoot, paths } = {}) {
  if (typeof repoRoot !== 'string'
    || repoRoot.length === 0
    || !Array.isArray(paths)
    || paths.length === 0
    || paths.length > 256
    || !paths.every((entry, index) => (
      repoPath(entry) && (index === 0 || paths[index - 1] < entry)
    ))) {
    throw new TypeError('RC1 v6 source snapshot inputが不正');
  }
  const root = await realpath(repoRoot);
  const files = [];
  for (const relativePath of paths) {
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new TypeError('RC1 v6 source snapshot pathがrepo外を指す');
    }
    try {
      const stat = await lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new TypeError(`RC1 v6 source snapshot pathが通常fileでない: ${relativePath}`);
      }
      files.push({
        path: relativePath,
        state: 'file',
        content_digest: sha256(await readFile(target)),
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      files.push({ path: relativePath, state: 'absent', content_digest: null });
    }
  }
  return sourceSnapshot(files);
}

async function resolveExecutable(command) {
  const pathEntries = String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const directory of pathEntries) {
    const candidate = path.join(directory, command);
    try {
      await access(candidate, fsConstants.X_OK);
      const resolved = await realpath(candidate);
      const stat = await lstat(resolved);
      if (stat.isFile()) return resolved;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'EACCES') throw error;
    }
  }
  throw new TypeError(`RC1 v6 executableをPATHから解決できない: ${command}`);
}

/** 実行予定Codegraphのversionとresolved executable bytesをportable identityへ固定する。 */
export async function resolveRc1V6CodegraphIdentity() {
  const executablePath = await resolveExecutable('codegraph');
  const { stdout } = await execFileAsync(executablePath, ['--version'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
  const version = stdout.trim();
  if (!VERSION.test(version)) {
    throw new TypeError('RC1 v6 Codegraph versionがsemverでない');
  }
  return {
    schema: 'lattice.rc1.codegraph_identity.v1',
    version,
    executable_ref: 'codegraph',
    executable_digest: sha256(await readFile(executablePath)),
  };
}

/** v1 evidence bundleへsource／tool measurementを追加する。 */
export function bindRc1V6EvidenceBundle(options = {}) {
  if (!exactRecord(options, [
    'bundle',
    'base_sha',
    'patch_digest',
    'snapshot',
    'codegraph_identity',
    'query_set_digest',
  ])
    || !validateRc1EvidenceBundle(options.bundle)
    || !GIT_SHA1.test(options.base_sha)
    || (options.patch_digest !== null && !SHA256.test(options.patch_digest))
    || !validateSourceSnapshot(options.snapshot)
    || options.query_set_digest !== options.bundle.query_set_digest) {
    throw new TypeError('RC1 v6 evidence measurement inputが不正');
  }
  const measurement = {
    schema: 'lattice.rc1.codegraph_measurement.v1',
    base_sha: options.base_sha,
    patch_digest: options.patch_digest,
    snapshot: structuredClone(options.snapshot),
    snapshot_digest: digestArtifact(options.snapshot),
    codegraph_identity: structuredClone(options.codegraph_identity),
    codegraph_identity_digest: digestArtifact(options.codegraph_identity),
    query_set_digest: options.query_set_digest,
    raw_evidence_digest: options.bundle.raw.payload_digest,
  };
  const bundle = {
    ...structuredClone(options.bundle),
    schema: 'lattice.rc1.evidence_bundle.v2',
    measurement,
    measurement_digest: digestArtifact(measurement),
  };
  const run = createRc1V6ConditionRun(bundle);
  const verification = verifyRc1V6RunEvidence({
    run,
    bundle,
    expected: {
      base_sha: options.base_sha,
      patch_digest: options.patch_digest,
      snapshot: options.snapshot,
      codegraph_identity: options.codegraph_identity,
      query_set_digest: options.query_set_digest,
    },
  });
  if (!verification.valid) {
    throw new TypeError(
      `RC1 v6 evidence measurement binding failed: ${verification.failed_conditions.join(', ')}`,
    );
  }
  return bundle;
}

/** v2 bundleのbounded descriptorからcondition run identityを生成する。 */
export function createRc1V6ConditionRun(bundle) {
  if (bundle === null || typeof bundle !== 'object' || bundle.schema !== 'lattice.rc1.evidence_bundle.v2') {
    throw new TypeError('RC1 v6 condition run bundleが不正');
  }
  return {
    schema: 'lattice.rc1.condition_run.v2',
    condition: bundle.condition,
    run_id: bundle.run_id,
    evidence_bundle_descriptor_digest: digestArtifact(
      createRc1V6EvidenceBundleDescriptor(bundle),
    ),
    measurement_digest: bundle.measurement_digest,
  };
}

function decodeRawEvidence(bundle) {
  try {
    return JSON.parse(Buffer.from(bundle.raw.payload_base64, 'base64').toString('utf8'));
  } catch {
    throw new TypeError('RC1 v6 raw Codegraph evidenceをdecodeできない');
  }
}

/** verified bundle preimageだけからboundary compilerを実行する。 */
export function compileRc1V6BoundaryCondition(options = {}) {
  if (!exactRecord(options, [
    'planInput',
    'candidateSpec',
    'manualEvidence',
    'querySet',
    'run',
    'bundle',
    'expected',
    'planVersion',
  ])) {
    throw new TypeError('RC1 v6 boundary compile input shapeが不正');
  }
  const verification = verifyRc1V6RunEvidence({
    run: options.run,
    bundle: options.bundle,
    expected: options.expected,
  });
  if (!verification.valid) {
    throw new TypeError(
      `RC1 v6 measurement binding failed: ${verification.failed_conditions.join(', ')}`,
    );
  }
  if (digestArtifact(options.querySet) !== options.bundle.query_set_digest) {
    throw new TypeError('RC1 v6 compiler query setがbundleと一致しない');
  }
  const compiled = compileBoundaryCondition({
    planInput: options.planInput,
    candidateSpec: options.candidateSpec,
    manualEvidence: options.manualEvidence,
    querySet: options.querySet,
    codegraphEvidence: decodeRawEvidence(options.bundle),
    codeSnapshotDigest: options.bundle.measurement.snapshot_digest,
    planVersion: options.planVersion,
  });
  if (compiled.boundary_manifest.source.code_snapshot_digest
      !== options.bundle.measurement.snapshot_digest
    || compiled.boundary_manifest.source.codegraph_version
      !== options.bundle.measurement.codegraph_identity.version) {
    throw new TypeError('RC1 v6 compiler outputがmeasurement identityと一致しない');
  }
  return compiled;
}
