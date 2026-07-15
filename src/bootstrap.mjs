const SCHEMA = 'lattice.bootstrap_diagnostics.v1';
const STATUS = 'bootstrap_ready';
const CONTRACT_REF = 'docs/00_product-contract.md';
const PLAN_REF = 'docs/plan_lattice.md';
const MAX_NODE_VERSION_LENGTH = 64;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value, keys) {
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isNodeVersion(value) {
  return typeof value === 'string'
    && value.length > 1
    && value.length <= MAX_NODE_VERSION_LENGTH
    && /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

/**
 * Builds the bounded, canonical bootstrap diagnostics object used by the CLI.
 * @param {{ nodeVersion?: string }} options
 * @returns {object}
 */
export function buildBootstrapDiagnostics({ nodeVersion = process.version } = {}) {
  const diagnostics = {
    schema: SCHEMA,
    status: STATUS,
    runtime: { node_version: nodeVersion },
    references: {
      contract: CONTRACT_REF,
      plan: PLAN_REF,
    },
    implementation: {
      boundary_compile: false,
      recompile: false,
      transform: false,
    },
  };

  if (!validateBootstrapDiagnostics(diagnostics)) {
    throw new TypeError('invalid bootstrap diagnostics input');
  }

  return diagnostics;
}

/**
 * Strictly validates the public bootstrap diagnostics schema.
 * @param {unknown} value
 * @returns {boolean}
 */
export function validateBootstrapDiagnostics(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    'schema', 'status', 'runtime', 'references', 'implementation',
  ])) {
    return false;
  }

  if (value.schema !== SCHEMA || value.status !== STATUS) {
    return false;
  }

  if (!isPlainObject(value.runtime)
    || !hasExactKeys(value.runtime, ['node_version'])
    || !isNodeVersion(value.runtime.node_version)) {
    return false;
  }

  if (!isPlainObject(value.references)
    || !hasExactKeys(value.references, ['contract', 'plan'])
    || value.references.contract !== CONTRACT_REF
    || value.references.plan !== PLAN_REF) {
    return false;
  }

  return isPlainObject(value.implementation)
    && hasExactKeys(value.implementation, ['boundary_compile', 'recompile', 'transform'])
    && value.implementation.boundary_compile === false
    && value.implementation.recompile === false
    && value.implementation.transform === false;
}
