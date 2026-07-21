import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const testRoot = path.join(repoRoot, 'test');

// These suites replay immutable RC1/RC2 research artifacts. They remain available
// for historical forensics, but cannot decide the current Lattice product gate.
const retiredArtifactReplaySuites = new Set([
  'integration/rc1-v4-campaign.integration.mjs',
  'integration/rc2-sensor-artifact-scope.integration.mjs',
  'integration/rc3-actual-dogfood.integration.mjs',
  'integration/rc3-event-store-scope.integration.mjs',
  'integration/seam-transform.integration.mjs',
  'integration/treatment-recompile.integration.mjs',
  'rc1-black-box-oracle.test.mjs',
  'rc1-comparison.test.mjs',
  'rc1-evidence-bundle.test.mjs',
  'rc1-v4-campaign.test.mjs',
  'rc1-v4-characterization.test.mjs',
  'rc1-v5-behavior-evidence.test.mjs',
  'rc1-v5-campaign.test.mjs',
  'rc1-v6-behavior-evidence.test.mjs',
  'rc1-v6-campaign.test.mjs',
  'rc1-v6-causal-binding.test.mjs',
  'rc1-v6-measurement.test.mjs',
  'rc2-artifact-version-witness.test.mjs',
  'rc2-campaign.test.mjs',
  'rc2-rc1-transfer-front-end.test.mjs',
  'rc2-v6-compatibility.test.mjs',
  'rc3-compatibility.test.mjs',
  'seam-transform.test.mjs',
  'treatment-compiler.test.mjs',
  'treatment-runner.test.mjs',
]);

async function collectTests(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTests(path.join(directory, entry.name), relative));
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(relative);
    }
  }
  return files;
}

export function productTestEnvironment(parentEnv = process.env) {
  const env = { ...parentEnv, LATTICE_DASHBOARD_AUTOSTART: '0' };
  delete env.FORCE_COLOR;
  return env;
}

async function runProductTests() {
  const allTests = (await collectTests(testRoot)).sort();
  const missingRetired = [...retiredArtifactReplaySuites]
    .filter((relative) => !allTests.includes(relative));
  if (missingRetired.length > 0) {
    throw new Error(`retired artifact replay suite list drifted: ${missingRetired.join(', ')}`);
  }

  const productTests = allTests.filter((relative) => !retiredArtifactReplaySuites.has(relative));
  process.stdout.write([
    `Current product gate: ${productTests.length} suites`,
    `Retired immutable artifact replay (not used for product verdict): ${retiredArtifactReplaySuites.size} suites`,
    ...[...retiredArtifactReplaySuites].sort().map((relative) => `  - test/${relative}`),
    '',
  ].join('\n'));

  const result = spawnSync(
    process.execPath,
    ['--test', ...productTests.map((relative) => path.join('test', relative))],
    { cwd: repoRoot, encoding: 'utf8', stdio: 'inherit',
      env: productTestEnvironment() },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runProductTests();
