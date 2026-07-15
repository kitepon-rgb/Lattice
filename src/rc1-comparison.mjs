import { canonicalizeArtifact, digestArtifact } from './artifact-contracts.mjs';

const REQUIRED_INVALIDATIONS = new Set([
  'old_plan',
  'agent_context',
  'partial_patch',
  'interface_assumption',
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function sameArtifact(left, right) {
  try {
    return digestArtifact(left) === digestArtifact(right);
  } catch {
    return false;
  }
}

function summary(value) {
  return isPlainObject(value) ? value : {};
}

function passed(value) {
  return value === 'passed';
}

/**
 * RC1 v4 comparisonを宣言済み全条件から再評価する。artifact内の自己申告resultは参照しない。
 * @param {unknown} comparison
 * @returns {{schema: string, supported: boolean, checks: object[], failed_conditions: string[]}}
 */
export function evaluateRc1Hypothesis(comparison) {
  try {
    canonicalizeArtifact(comparison);
  } catch {
    comparison = null;
  }
  const value = isPlainObject(comparison) ? comparison : {};
  const control = summary(value.control);
  const treatment = summary(value.treatment);
  const negativeControl = summary(value.negative_control);
  const negativeTreatment = summary(value.negative_treatment);
  const compiler = summary(value.compiler);
  const evidence = summary(value.evidence);
  const behavior = summary(value.behavior);
  const predecessor = summary(value.predecessor);
  const sourceInvariant = summary(value.source_invariant);
  const invalidations = Array.isArray(value.version_barrier?.invalidated_contexts)
    ? value.version_barrier.invalidated_contexts
    : [];
  const invalidationKinds = new Set(invalidations.map(({ kind }) => kind));

  const checks = [
    {
      id: 'schema',
      passed: value.schema === 'lattice.rc1.control_treatment_comparison.v2',
    },
    {
      id: 'compiler_identity',
      passed: compiler.condition_selector === 'forbidden'
        && compiler.control?.export_name === 'compileBoundaryCondition'
        && compiler.treatment?.export_name === 'compileBoundaryCondition'
        && typeof compiler.control?.source_digest === 'string'
        && compiler.control.source_digest === compiler.treatment?.source_digest,
    },
    {
      id: 'fixed_inputs',
      passed: sameArtifact(value.fixed_inputs?.control, value.fixed_inputs?.treatment),
    },
    {
      id: 'control_conflict',
      passed: control.verdict === 'seam_candidate'
        && Number.isSafeInteger(control.write_conflicts)
        && control.write_conflicts > 0
        && control.minimum_feasible_waves === 2,
    },
    {
      id: 'test_write_conflicts',
      passed: Number.isSafeInteger(control.test_write_conflicts)
        && control.test_write_conflicts > 0
        && treatment.test_write_conflicts === 0,
    },
    {
      id: 'treatment_parallel',
      passed: treatment.verdict === 'parallel_ready'
        && treatment.write_conflicts === 0
        && treatment.minimum_feasible_waves === 1,
    },
    {
      id: 'unknowns',
      passed: treatment.unknowns === 0,
    },
    {
      id: 'hard_precedence',
      passed: Number.isSafeInteger(control.hard_precedence)
        && treatment.hard_precedence === control.hard_precedence,
    },
    {
      id: 'negative_state',
      passed: negativeControl.state_conflicts > 0
        && negativeTreatment.state_conflicts > 0
        && negativeControl.minimum_feasible_waves === 2
        && negativeTreatment.minimum_feasible_waves === 2
        && negativeTreatment.verdict === 'intentional_serial',
    },
    {
      id: 'behavior',
      passed: passed(behavior.control?.outcome)
        && passed(behavior.treatment?.outcome)
        && behavior.control?.oracle_digest === behavior.treatment?.oracle_digest,
    },
    {
      id: 'portable_preimages',
      passed: evidence.control?.portable_preimages_complete === true
        && evidence.treatment?.portable_preimages_complete === true
        && evidence.control?.digests_recomputed === true
        && evidence.treatment?.digests_recomputed === true,
    },
    {
      id: 'sanitized_diagnostics',
      passed: evidence.control?.diagnostics_sanitized === true
        && evidence.treatment?.diagnostics_sanitized === true,
    },
    {
      id: 'predecessor',
      passed: predecessor.transform_status === 'accepted'
        && predecessor.same_base === true
        && predecessor.fixed_inputs_bound === true,
    },
    {
      id: 'version_barrier',
      passed: invalidations.length === REQUIRED_INVALIDATIONS.size
        && REQUIRED_INVALIDATIONS.size === invalidationKinds.size
        && [...REQUIRED_INVALIDATIONS].every((kind) => invalidationKinds.has(kind)),
    },
    {
      id: 'source_invariant',
      passed: passed(sourceInvariant.control) && passed(sourceInvariant.treatment),
    },
  ];
  const failedConditions = checks.filter((check) => !check.passed).map(({ id }) => id);
  return {
    schema: 'lattice.rc1.hypothesis_evaluation.v2',
    supported: failedConditions.length === 0,
    checks,
    failed_conditions: failedConditions,
  };
}
