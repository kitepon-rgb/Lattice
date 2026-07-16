import assert from 'node:assert/strict';
import test from 'node:test';

test('RC1 v6 canonical artifact root remains a valid 12-check disk replay', async () => {
  const { verifyRc1V6ArtifactsOnDisk } = await import('../src/rc1-v6-campaign.mjs');
  const verification = await verifyRc1V6ArtifactsOnDisk({ repoRoot: process.cwd() });

  assert.equal(verification.valid, true, JSON.stringify(verification.failed_conditions));
  assert.equal(verification.checks.length, 12);
  assert.equal(verification.checks.filter(({ passed }) => passed).length, 12);
  assert.deepEqual(verification.failed_conditions, []);
});
