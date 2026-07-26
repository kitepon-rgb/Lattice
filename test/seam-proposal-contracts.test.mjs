import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEAM_PROPOSAL_SCHEMA,
  deriveSeamProposalId,
  validateSeamProposal,
} from '../src/seam-proposal-contracts.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

const BASE_SHA = 'a'.repeat(40);
const DIGEST = (character) => character.repeat(64);

function seal(value, { deriveId = true } = {}) {
  for (const decision of value.decisions) {
    const candidate = decision.seam_candidate;
    if (candidate === null) continue;
    candidate.evidence.evidence_digest = todoSelfDigest(
      candidate.evidence, 'evidence_digest',
    );
    if (deriveId) {
      candidate.proposal_id = deriveSeamProposalId({
        conflicts: decision.conflicts,
        proposed_surfaces: candidate.proposed_surfaces,
      });
    }
    candidate.proposal_digest = todoSelfDigest(candidate, 'proposal_digest');
  }
  value.result_digest = todoSelfDigest(value, 'result_digest');
  return value;
}

function acceptedArtifact() {
  return seal({
    schema: SEAM_PROPOSAL_SCHEMA,
    project_id: 'lattice',
    plan_key: 'plan-a',
    source_binding: {
      independence_schema: 'lattice.todo_independence.v3',
      independence_result_digest: DIGEST('b'),
      witness_set_digest: DIGEST('c'),
      plan_version: 'v1',
      topology_digest: DIGEST('d'),
      base_sha: BASE_SHA,
    },
    compiled_at: '2026-07-26T00:00:00.000Z',
    decisions: [{
      component_id: 'component-001',
      task_ids: ['tip-001', 'tip-002', 'tip-003'],
      conflicts: [
        {
          resource_id: 'path-shared',
          kind: 'path',
          target: 'src/shared.mjs',
          task_pairs: [
            ['tip-001', 'tip-002'],
            ['tip-001', 'tip-003'],
            ['tip-002', 'tip-003'],
          ],
        },
        {
          resource_id: 'symbol-shared',
          kind: 'symbol',
          target: 'selectAll',
          task_pairs: [['tip-001', 'tip-002']],
        },
      ],
      verdict: 'seam_candidate',
      seam_candidate: {
        proposal_id: '',
        current_surfaces: [
          {
            kind: 'path',
            target: 'src/shared.mjs',
            path: 'src/shared.mjs',
            role: 'shared_source',
            owner_task_ids: ['tip-001', 'tip-002', 'tip-003'],
          },
          {
            kind: 'symbol',
            target: 'selectAll',
            path: 'src/shared.mjs',
            role: 'shared_symbol',
            owner_task_ids: ['tip-001', 'tip-002', 'tip-003'],
          },
        ],
        proposed_surfaces: [
          {
            kind: 'path',
            target: 'src/channels/',
            path: 'src/channels/',
            role: 'task_partition',
            owner_task_ids: ['tip-001'],
          },
          {
            kind: 'symbol',
            target: 'selectAll',
            path: 'src/shared.mjs',
            role: 'facade',
            owner_task_ids: [],
          },
          {
            kind: 'symbol',
            target: 'selectAlpha',
            path: 'src/channels/alpha.mjs',
            role: 'task_owned',
            owner_task_ids: ['tip-001'],
          },
          {
            kind: 'symbol',
            target: 'selectBeta',
            path: 'src/channels/beta.mjs',
            role: 'task_owned',
            owner_task_ids: ['tip-002'],
          },
          {
            kind: 'symbol',
            target: 'selectGamma',
            path: 'src/channels/gamma.mjs',
            role: 'task_owned',
            owner_task_ids: ['tip-003'],
          },
        ],
        affected_tests: [
          'test/alpha.test.mjs',
          'test/beta.test.mjs',
          'test/composition.test.mjs',
        ],
        verification: {
          virtual_compile_input_digest: DIGEST('e'),
          virtual_compile_result_digest: DIGEST('f'),
          residual_conflicts: [],
        },
        evidence: {
          query_set_digest: DIGEST('1'),
          evidence_digest: '',
          queries: [
            {
              query_id: 'q-impact',
              operation: 'impact',
              target: 'selectAll',
              outcome: 'resolved',
              resolved_name: 'selectAll',
              resolved_path: 'src/shared.mjs',
              result_digest: DIGEST('2'),
            },
            {
              query_id: 'q-new-symbol',
              operation: 'search',
              target: 'selectAlpha',
              outcome: 'absent',
              resolved_name: null,
              resolved_path: null,
              result_digest: DIGEST('3'),
            },
          ],
        },
        limits: ['structural_only'],
        proposal_digest: '',
      },
      reasons: [{ code: 'partitionable', detail: 'All resources have a structural code seam.' }],
      unknowns: [],
    }],
    result_digest: '',
  });
}

function taskOwnedSurface(value) {
  return value.decisions[0].seam_candidate.proposed_surfaces
    .find(({ role }) => role === 'task_owned');
}

test('正しいN-task conflict componentのaccepted artifactが通る', () => {
  const value = acceptedArtifact();
  assert.equal(validateSeamProposal(value), true);
  assert.equal(value.decisions[0].task_ids.length, 3);
  assert.equal(value.decisions[0].conflicts.length, 2);
});

test('verdictとseam_candidateはexact sum typeになる', () => {
  const missingCandidate = acceptedArtifact();
  missingCandidate.decisions[0].seam_candidate = null;
  seal(missingCandidate);
  assert.equal(validateSeamProposal(missingCandidate), false);

  const candidateOnSerial = acceptedArtifact();
  candidateOnSerial.decisions[0].verdict = 'intentional_serial';
  seal(candidateOnSerial);
  assert.equal(validateSeamProposal(candidateOnSerial), false);
});

test('accepted candidateは残余conflictとblocking unknownを許さない', () => {
  const residual = acceptedArtifact();
  residual.decisions[0].seam_candidate.verification.residual_conflicts = [{
    resource_id: 'still-shared',
  }];
  seal(residual);
  assert.equal(validateSeamProposal(residual), false);

  const unknown = acceptedArtifact();
  unknown.decisions[0].unknowns = [{ kind: 'ambiguous_symbol', ref: 'selectAll' }];
  seal(unknown);
  assert.equal(validateSeamProposal(unknown), false);
});

test('state/effectを含むcomponentはseam_candidateを名乗れない', () => {
  for (const kind of ['state', 'effect']) {
    const value = acceptedArtifact();
    value.decisions[0].conflicts[0].kind = kind;
    value.decisions[0].conflicts[0].target = `${kind}-resource`;
    seal(value);
    assert.equal(validateSeamProposal(value), false, `${kind} must be serial`);
  }
});

test('proposed surface ownershipはcomponent内のtask 1件かstable 0件に閉じる', () => {
  const outside = acceptedArtifact();
  taskOwnedSurface(outside).owner_task_ids = ['tip-999'];
  seal(outside);
  assert.equal(validateSeamProposal(outside), false);

  const multiple = acceptedArtifact();
  taskOwnedSurface(multiple).owner_task_ids = ['tip-001', 'tip-002'];
  seal(multiple);
  assert.equal(validateSeamProposal(multiple), false);

  const missing = acceptedArtifact();
  taskOwnedSurface(missing).owner_task_ids = [];
  seal(missing);
  assert.equal(validateSeamProposal(missing), false);

  const ownedFacade = acceptedArtifact();
  ownedFacade.decisions[0].seam_candidate.proposed_surfaces
    .find(({ role }) => role === 'facade').owner_task_ids = ['tip-001'];
  seal(ownedFacade);
  assert.equal(validateSeamProposal(ownedFacade), false);

  const uncoveredTask = acceptedArtifact();
  uncoveredTask.decisions[0].seam_candidate.proposed_surfaces
    .find(({ target }) => target === 'selectGamma').owner_task_ids = ['tip-002'];
  seal(uncoveredTask);
  assert.equal(validateSeamProposal(uncoveredTask), false);
});

test('path/symbol surfaceはexact path規律を守る', () => {
  const pathMismatch = acceptedArtifact();
  pathMismatch.decisions[0].seam_candidate.proposed_surfaces[0].target = 'src/other/';
  seal(pathMismatch);
  assert.equal(validateSeamProposal(pathMismatch), false);

  const symbolPrefix = acceptedArtifact();
  taskOwnedSurface(symbolPrefix).path = 'src/channels/';
  seal(symbolPrefix);
  assert.equal(validateSeamProposal(symbolPrefix), false);
});

test('sort、duplicate、余分field、欠落fieldをruntime validatorが拒否する', () => {
  const unsortedTasks = acceptedArtifact();
  unsortedTasks.decisions[0].task_ids.reverse();
  seal(unsortedTasks);
  assert.equal(validateSeamProposal(unsortedTasks), false);

  const duplicateTasks = acceptedArtifact();
  duplicateTasks.decisions[0].task_ids = ['tip-001', 'tip-001', 'tip-002', 'tip-003'];
  seal(duplicateTasks);
  assert.equal(validateSeamProposal(duplicateTasks), false);

  const unsortedSurfaces = acceptedArtifact();
  unsortedSurfaces.decisions[0].seam_candidate.proposed_surfaces.reverse();
  seal(unsortedSurfaces);
  assert.equal(validateSeamProposal(unsortedSurfaces), false);

  const unsortedPairs = acceptedArtifact();
  unsortedPairs.decisions[0].conflicts[0].task_pairs.reverse();
  seal(unsortedPairs);
  assert.equal(validateSeamProposal(unsortedPairs), false);

  const extra = acceptedArtifact();
  extra.decisions[0].seam_candidate.evidence.unexpected = true;
  seal(extra);
  assert.equal(validateSeamProposal(extra), false);

  const missing = acceptedArtifact();
  delete missing.decisions[0].seam_candidate.evidence.queries[0].result_digest;
  seal(missing);
  assert.equal(validateSeamProposal(missing), false);
});

test('proposal_idはreceiptから独立しsemantic keyだけで決まる', () => {
  const original = acceptedArtifact();
  const originalId = original.decisions[0].seam_candidate.proposal_id;

  const newReceipt = acceptedArtifact();
  newReceipt.compiled_at = '2026-07-26T01:00:00.000Z';
  newReceipt.source_binding.independence_result_digest = DIGEST('4');
  newReceipt.decisions[0].seam_candidate.evidence.query_set_digest = DIGEST('5');
  newReceipt.decisions[0].seam_candidate.evidence.queries[0].result_digest = DIGEST('6');
  seal(newReceipt);
  assert.equal(validateSeamProposal(newReceipt), true);
  assert.equal(newReceipt.decisions[0].seam_candidate.proposal_id, originalId);

  const semanticChange = acceptedArtifact();
  const alpha = semanticChange.decisions[0].seam_candidate.proposed_surfaces
    .find(({ target }) => target === 'selectAlpha');
  const beta = semanticChange.decisions[0].seam_candidate.proposed_surfaces
    .find(({ target }) => target === 'selectBeta');
  alpha.owner_task_ids = ['tip-002'];
  beta.owner_task_ids = ['tip-001'];
  seal(semanticChange);
  assert.equal(validateSeamProposal(semanticChange), true);
  assert.notEqual(semanticChange.decisions[0].seam_candidate.proposal_id, originalId);
});

test('query_set_digestは外部query set bindingでありevidence_digestがreceiptを自己封印する', () => {
  const original = acceptedArtifact();
  const originalCandidate = original.decisions[0].seam_candidate;

  const rebound = acceptedArtifact();
  const reboundCandidate = rebound.decisions[0].seam_candidate;
  reboundCandidate.evidence.query_set_digest = DIGEST('7');
  seal(rebound);
  assert.equal(validateSeamProposal(rebound), true);
  assert.notEqual(reboundCandidate.evidence.evidence_digest,
    originalCandidate.evidence.evidence_digest);
  assert.notEqual(reboundCandidate.proposal_digest, originalCandidate.proposal_digest);

  const changedReceipt = acceptedArtifact();
  const changedCandidate = changedReceipt.decisions[0].seam_candidate;
  changedCandidate.evidence.queries[0].result_digest = DIGEST('8');
  seal(changedReceipt);
  assert.equal(validateSeamProposal(changedReceipt), true);
  assert.notEqual(changedCandidate.evidence.evidence_digest,
    originalCandidate.evidence.evidence_digest);
  assert.notEqual(changedCandidate.proposal_digest, originalCandidate.proposal_digest);
});

test('evidence_digest不一致はouter digestを再封印しても拒否する', () => {
  const value = acceptedArtifact();
  const candidate = value.decisions[0].seam_candidate;
  candidate.evidence.evidence_digest = DIGEST('9');
  candidate.proposal_digest = todoSelfDigest(
    candidate, 'proposal_digest',
  );
  value.result_digest = todoSelfDigest(value, 'result_digest');
  assert.equal(validateSeamProposal(value), false);
});

test('proposal_id導出は入力array順ではなくcanonical semantic内容を見る', () => {
  const value = acceptedArtifact();
  const decision = value.decisions[0];
  const expected = decision.seam_candidate.proposal_id;
  assert.equal(deriveSeamProposalId({
    conflicts: structuredClone(decision.conflicts).reverse(),
    proposed_surfaces: structuredClone(decision.seam_candidate.proposed_surfaces).reverse(),
  }), expected);
});

test('proposal_digestとresult_digestの自己digest不一致を拒否する', () => {
  const badProposalDigest = acceptedArtifact();
  badProposalDigest.decisions[0].seam_candidate.proposal_digest = DIGEST('9');
  badProposalDigest.result_digest = todoSelfDigest(badProposalDigest, 'result_digest');
  assert.equal(validateSeamProposal(badProposalDigest), false);

  const badResultDigest = acceptedArtifact();
  badResultDigest.result_digest = DIGEST('9');
  assert.equal(validateSeamProposal(badResultDigest), false);
});
