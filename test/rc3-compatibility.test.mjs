import assert from 'node:assert/strict';
import test from 'node:test';

// RC3-B互換baseline（plan lattice-runtime-rc3-v1 成功条件1）:
// RC1 v6とRC2 v1〜v4のcanonical artifactを、RC3実装開始前のdisk replayとして一回固定する。
// checks件数はRC2最終full gateの保存receipt（12／14／15／15／15）と一致しなければならない。
const RC2_ARTIFACT_CHECKS = Object.freeze([
  ['v1', 14],
  ['v2', 15],
  ['v3', 15],
  ['v4', 15],
]);

test('RC1 v6 canonical artifactはRC3 baselineでも12-check disk replayが全件greenである', async () => {
  const { verifyRc1V6ArtifactsOnDisk } = await import('../src/rc1-v6-campaign.mjs');
  const verification = await verifyRc1V6ArtifactsOnDisk({ repoRoot: process.cwd() });

  assert.equal(verification.valid, true, JSON.stringify(verification.failed_conditions));
  assert.equal(verification.checks.length, 12);
  assert.equal(verification.checks.filter(({ passed }) => passed).length, 12);
  assert.deepEqual(verification.failed_conditions, []);
});

test('RC2 canonical artifact v1〜v4はRC3 baselineでもdisk replayが全件greenである', async () => {
  const { verifyRc2CampaignArtifactsOnDisk } = await import('../src/rc2-campaign.mjs');
  for (const [artifactVersion, checks] of RC2_ARTIFACT_CHECKS) {
    const verification = await verifyRc2CampaignArtifactsOnDisk({
      repoRoot: process.cwd(),
      artifactVersion,
    });

    assert.equal(
      verification.valid,
      true,
      `${artifactVersion}: ${JSON.stringify(verification.failed_conditions)}`,
    );
    assert.equal(verification.checks.length, checks, artifactVersion);
    assert.equal(verification.checks.filter(({ passed }) => passed).length, checks, artifactVersion);
    assert.deepEqual(verification.failed_conditions, []);
  }
});
