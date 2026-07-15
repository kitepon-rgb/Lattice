import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { evaluateRc1Hypothesis } from '../src/rc1-comparison.mjs';

const digest = (character) => character.repeat(64);

function validComparison() {
  const fixed = {
    plan_input: digest('a'),
    candidate_spec: digest('b'),
    normal_manual_evidence: digest('c'),
    negative_manual_evidence: digest('d'),
    query_set: digest('e'),
    capacity_writers: 2,
    behavior_oracle: digest('f'),
  };
  const summary = ({ verdict, writes, tests, state, waves, unknowns = 0 }) => ({
    verdict,
    write_conflicts: writes,
    test_write_conflicts: tests,
    state_conflicts: state,
    hard_precedence: 0,
    unknowns,
    minimum_feasible_waves: waves,
  });
  return {
    schema: 'lattice.rc1.control_treatment_comparison.v2',
    fixed_inputs: { control: fixed, treatment: structuredClone(fixed) },
    compiler: {
      condition_selector: 'forbidden',
      control: { export_name: 'compileBoundaryCondition', source_digest: digest('1') },
      treatment: { export_name: 'compileBoundaryCondition', source_digest: digest('1') },
    },
    control: summary({ verdict: 'seam_candidate', writes: 3, tests: 1, state: 0, waves: 2 }),
    treatment: summary({ verdict: 'parallel_ready', writes: 0, tests: 0, state: 0, waves: 1 }),
    negative_control: summary({ verdict: 'intentional_serial', writes: 3, tests: 1, state: 1, waves: 2 }),
    negative_treatment: summary({ verdict: 'intentional_serial', writes: 0, tests: 0, state: 1, waves: 2 }),
    behavior: {
      control: { outcome: 'passed', oracle_digest: digest('f') },
      treatment: { outcome: 'passed', oracle_digest: digest('f') },
    },
    evidence: {
      control: {
        portable_preimages_complete: true,
        digests_recomputed: true,
        diagnostics_sanitized: true,
      },
      treatment: {
        portable_preimages_complete: true,
        digests_recomputed: true,
        diagnostics_sanitized: true,
      },
    },
    predecessor: {
      transform_status: 'accepted',
      same_base: true,
      fixed_inputs_bound: true,
    },
    version_barrier: {
      invalidated_contexts: [
        { kind: 'old_plan', ref: 'rc1-v3-plan' },
        { kind: 'agent_context', ref: 'rc1-v3-context' },
        { kind: 'partial_patch', ref: 'rc1-v3-patch' },
        { kind: 'interface_assumption', ref: 'shared-test-is-run-only' },
      ],
    },
    source_invariant: { control: 'passed', treatment: 'passed' },
  };
}

test('complete v4 predicate returns an explicit all-green truth table', () => {
  const evaluation = evaluateRc1Hypothesis(validComparison());
  assert.equal(evaluation.supported, true);
  assert.deepEqual(evaluation.failed_conditions, []);
  assert.equal(evaluation.checks.length, 15);
  assert.ok(evaluation.checks.every(({ passed }) => passed));
});

test('each single-field corruption rejects support at its declared condition', () => {
  const corruptions = [
    ['schema', (value) => { value.schema = 'lattice.rc1.control_treatment_comparison.v1'; }],
    ['compiler_identity', (value) => { value.compiler.treatment.source_digest = digest('2'); }],
    ['fixed_inputs', (value) => { value.fixed_inputs.treatment.query_set = digest('0'); }],
    ['control_conflict', (value) => { value.control.write_conflicts = 0; }],
    ['test_write_conflicts', (value) => { value.control.test_write_conflicts = 0; }],
    ['treatment_parallel', (value) => { value.treatment.write_conflicts = 1; }],
    ['unknowns', (value) => { value.treatment.unknowns = 1; }],
    ['hard_precedence', (value) => { value.treatment.hard_precedence = 1; }],
    ['negative_state', (value) => { value.negative_treatment.state_conflicts = 0; }],
    ['behavior', (value) => { value.behavior.treatment.outcome = 'failed'; }],
    ['portable_preimages', (value) => { value.evidence.control.portable_preimages_complete = false; }],
    ['sanitized_diagnostics', (value) => { value.evidence.treatment.diagnostics_sanitized = false; }],
    ['predecessor', (value) => { value.predecessor.same_base = false; }],
    ['version_barrier', (value) => { value.version_barrier.invalidated_contexts.pop(); }],
    ['source_invariant', (value) => { value.source_invariant.treatment = 'failed'; }],
  ];

  for (const [condition, corrupt] of corruptions) {
    const value = validComparison();
    corrupt(value);
    const evaluation = evaluateRc1Hypothesis(value);
    assert.equal(evaluation.supported, false, condition);
    assert.ok(evaluation.failed_conditions.includes(condition), condition);
  }
});

test('historical v3 supported result is fail-closed without v4 predicate fields', async () => {
  const comparison = JSON.parse(await readFile(new URL(
    '../research/campaigns/rc1/artifacts/treatment-v2/compiled/comparison.json',
    import.meta.url,
  ), 'utf8'));
  const evaluation = evaluateRc1Hypothesis(comparison);
  assert.equal(evaluation.supported, false);
  assert.ok(evaluation.failed_conditions.includes('compiler_identity'));
  assert.ok(evaluation.failed_conditions.includes('test_write_conflicts'));
  assert.ok(evaluation.failed_conditions.includes('portable_preimages'));
});
