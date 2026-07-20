import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  runRc3ScriptedCampaign,
  verifyRc3CampaignArtifactsOnDisk,
} from '../../src/rc3-scripted-campaign.mjs';

// RC3-H integration（plan RC3-H、ADR 0044 Decision 10・11）。
// 8条件scripted campaignを実dogfood scaffold・実worktree・実LatticeSensorで完走させ、
// immutable artifact rootのartifact-only verificationとno-overwrite規律を固定する。

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let temporaryRoot;
let artifactRoot;
let campaign;

test.before(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), 'lattice-rc3h-test-'));
  artifactRoot = path.join(temporaryRoot, 'artifacts', 'v1');
  campaign = await runRc3ScriptedCampaign({ latticeRoot: REPO_ROOT, artifactRoot });
});

test.after(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test('8条件が全て期待集合とexact一致で完走する', () => {
  assert.deepEqual(campaign.conditions, [
    'clean_parallel',
    'late_path_conflict',
    'scope_violation',
    'semantic_unknown',
    'stale_receipt',
    'irreducible_conflict',
    'accepted_seam',
    'event_corruption',
  ]);
  assert.equal(campaign.verification.valid, true, JSON.stringify(campaign.verification.failed_conditions));
});

test('artifact rootは保存bytesだけから再検証できる', async () => {
  const verification = await verifyRc3CampaignArtifactsOnDisk({ artifactRoot });
  assert.equal(verification.valid, true, JSON.stringify(verification.failed_conditions));
  assert.ok(verification.checks.length >= 20);
});

test('campaign manifestはscaffold identityとpredeclared treatmentをbindする', async () => {
  const manifest = JSON.parse(await readFile(path.join(artifactRoot, 'campaign-manifest.json'), 'utf8'));
  assert.equal(manifest.schema, 'lattice.rc3.campaign_manifest.v1');
  assert.match(manifest.scaffold.target_base_sha, /^[0-9a-f]{40}$/);
  assert.equal(
    manifest.scaffold.predeclared_treatment.candidate_digest,
    '4cc5d7bb428a8899353d18524c25105742fa90f89ee55d36064c4be3c52e2907',
  );
  assert.equal(manifest.conditions.length, 8);
});

test('artifact rootへの再発行（上書き）はrejectされる', async () => {
  await assert.rejects(
    runRc3ScriptedCampaign({ latticeRoot: REPO_ROOT, artifactRoot }),
    /上書きは禁止/u,
  );
});

test('空manifestや条件欠落のartifactはverifierがrejectする', async () => {
  const manifestPath = path.join(artifactRoot, 'campaign-manifest.json');
  const original = await readFile(manifestPath, 'utf8');
  const { writeFile } = await import('node:fs/promises');
  try {
    const emptied = JSON.parse(original);
    emptied.conditions = [];
    await writeFile(manifestPath, `${JSON.stringify(emptied, null, 1)}\n`);
    const verification = await verifyRc3CampaignArtifactsOnDisk({ artifactRoot });
    assert.equal(verification.valid, false);
    assert.ok(verification.failed_conditions.includes('manifest:conditions_exact'));
  } finally {
    await writeFile(manifestPath, original);
  }
});

test('expected/actual/matched/digestの整合的書換えもeventsからの再計算で検出される', async () => {
  const { selfDigest } = await import('../../src/runtime-contracts.mjs');
  void selfDigest;
  const { digestArtifact } = await import('../../src/artifact-contracts.mjs');
  const recordPath = path.join(artifactRoot, 'clean_parallel', 'condition-record.json');
  const manifestPath = path.join(artifactRoot, 'campaign-manifest.json');
  const originalRecord = await readFile(recordPath, 'utf8');
  const originalManifest = await readFile(manifestPath, 'utf8');
  const { writeFile } = await import('node:fs/promises');
  try {
    // 主張を書き換え、expected==actual・matched=trueを保ち、record_digestと
    // manifestのrecord_digestまで再封印する。
    const tampered = JSON.parse(originalRecord);
    tampered.expected.accepted = ['TA'];
    tampered.actual.accepted = ['TA'];
    tampered.expected.continue = ['TA'];
    tampered.actual.continue = ['TA'];
    tampered.matched = true;
    await writeFile(recordPath, `${JSON.stringify(tampered, null, 1)}\n`);
    const manifest = JSON.parse(originalManifest);
    const entry = manifest.conditions.find(({ condition }) => condition === 'clean_parallel');
    entry.record_digest = digestArtifact(tampered);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);

    const verification = await verifyRc3CampaignArtifactsOnDisk({ artifactRoot });
    assert.equal(verification.valid, false);
    assert.ok(verification.failed_conditions.includes('clean_parallel:actual_recomputed_from_events'));
  } finally {
    await writeFile(recordPath, originalRecord);
    await writeFile(manifestPath, originalManifest);
  }
});

test('保存artifactの改竄はartifact-only verificationが検出する', async () => {
  const recordPath = path.join(artifactRoot, 'clean_parallel', 'condition-record.json');
  const original = await readFile(recordPath, 'utf8');
  const tampered = JSON.parse(original);
  tampered.actual.hold = ['TA'];
  const { writeFile } = await import('node:fs/promises');
  await writeFile(recordPath, `${JSON.stringify(tampered, null, 1)}\n`);
  try {
    const verification = await verifyRc3CampaignArtifactsOnDisk({ artifactRoot });
    assert.equal(verification.valid, false);
    assert.ok(verification.failed_conditions.some((id) => id.includes('clean_parallel')));
  } finally {
    await writeFile(recordPath, original);
  }
});
