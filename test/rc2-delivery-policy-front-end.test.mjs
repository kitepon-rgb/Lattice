import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { digestArtifact } from '../src/artifact-contracts.mjs';
import { validateNormalizedBoundaryBundleV2 } from '../src/artifact-contracts-v2.mjs';
import { compileSchedulabilityGraphV2 } from '../src/schedulability-compiler-v2.mjs';

const FRONT_END = '../src/rc2-delivery-policy-front-end.mjs';
const PATHS = ['research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs', 'research/fixtures/delivery-policy-registry/src/email-policy.mjs', 'research/fixtures/delivery-policy-registry/src/push-policy.mjs', 'research/fixtures/delivery-policy-registry/src/sms-policy.mjs', 'src/rc2-delivery-policy-oracle.mjs', 'test/rc2-delivery-policy-email.test.mjs', 'test/rc2-delivery-policy-fixture.test.mjs', 'test/rc2-delivery-policy-push.test.mjs', 'test/rc2-delivery-policy-sms.test.mjs'];
const ORACLE = 'src/rc2-delivery-policy-oracle.mjs';
const MONOLITH = 'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs';
const SHARED_TEST = 'test/rc2-delivery-policy-fixture.test.mjs';
const SURFACE_PATHS = new Map([
  ['resolveDeliveryPolicy', MONOLITH],
  ['runRc2DeliveryPolicyOracle', ORACLE],
  ['resolveEmailPolicy', 'research/fixtures/delivery-policy-registry/src/email-policy.mjs'],
  ['resolveSmsPolicy', 'research/fixtures/delivery-policy-registry/src/sms-policy.mjs'],
  ['resolvePushPolicy', 'research/fixtures/delivery-policy-registry/src/push-policy.mjs'],
  ['emailPolicyContract', 'test/rc2-delivery-policy-email.test.mjs'],
  ['smsPolicyContract', 'test/rc2-delivery-policy-sms.test.mjs'],
  ['pushPolicyContract', 'test/rc2-delivery-policy-push.test.mjs'],
  ['deliveryPolicyCompositionContract', SHARED_TEST],
]);
const CONTROL_PATHS = new Set([MONOLITH, SHARED_TEST, ORACLE]);
const PROPOSED_QUERY = /^(?:email|sms|push|composition)-/;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
async function readInput(name) { return JSON.parse(await readFile(new URL(`../research/campaigns/rc2/inputs/${name}`, import.meta.url), 'utf8')); }

function snapshot(treatment) {
  return { schema_version: 'lattice.rc2.source_snapshot.v1', files: PATHS.map((path) => {
    const present = treatment || path === 'research/fixtures/delivery-policy-registry/src/delivery-policy-registry.mjs' || path === 'test/rc2-delivery-policy-fixture.test.mjs' || path === ORACLE;
    return { path, state: present ? 'file' : 'absent', content_digest: present ? (path === ORACLE ? 'c68a7ff9a7c9c4a181ceda6396d5fcbf27084de18680018d244a27998041652c' : sha256(`synthetic:${path}`)) : null };
  }) };
}

function node(target, { name, filePath } = {}) {
  const path = filePath ?? SURFACE_PATHS.get(target) ?? target;
  const kind = target.includes('/') ? 'file' : 'function';
  const observedName = name ?? (kind === 'file' ? path.split('/').at(-1) : target);
  const qualifiedName = kind === 'file' ? path : observedName;
  return {
    id: `${kind}:${sha256(`${kind}:${qualifiedName}`).slice(0, 32)}`,
    kind,
    name: observedName,
    qualifiedName,
    filePath: path,
    language: 'javascript',
    startLine: 1,
    endLine: kind === 'file' ? 80 : 20,
    startColumn: kind === 'file' ? 0 : 7,
    endColumn: kind === 'file' ? 0 : 1,
    visibility: null,
    isExported: kind === 'function',
    isAsync: target === 'runRc2DeliveryPolicyOracle',
    isStatic: false,
    isAbstract: false,
  };
}

function candidate(target, options) {
  return { node: node(target, options), score: 100 };
}

function summary(target, kind) {
  const filePath = SURFACE_PATHS.get(target) ?? target;
  return {
    name: kind === 'file' ? filePath.split('/').at(-1) : target,
    kind: kind ?? (target.includes('/') ? 'file' : 'function'),
    filePath,
    startLine: 1,
  };
}

function callersFor(id, treatment) {
  if (id === 'current-resolver-callers') return [summary(SHARED_TEST, 'file')];
  if (id === 'fixed-oracle-callers') return treatment ? [] : [summary(SHARED_TEST, 'file')];
  if (id === 'email-resolver-callers') return [summary('resolveDeliveryPolicy'), summary('emailPolicyContract')];
  if (id === 'sms-resolver-callers') return [summary('resolveDeliveryPolicy'), summary('smsPolicyContract')];
  if (id === 'push-resolver-callers') return [summary('resolveDeliveryPolicy'), summary('pushPolicyContract')];
  if (id === 'composition-callers') return [summary(SHARED_TEST, 'file')];
  return [];
}

function calleesFor(id, treatment) {
  if (id === 'current-resolver-callees') {
    return treatment
      ? ['resolveEmailPolicy', 'resolveSmsPolicy', 'resolvePushPolicy'].map((target) => summary(target))
      : [
        { name: 'hasExactInputKeys', kind: 'function', filePath: MONOLITH, startLine: 10 },
        { name: 'POLICIES', kind: 'constant', filePath: MONOLITH, startLine: 17 },
      ];
  }
  if (id === 'email-test-callees') return [summary('resolveEmailPolicy')];
  if (id === 'sms-test-callees') return [summary('resolveSmsPolicy')];
  if (id === 'push-test-callees') return [summary('resolvePushPolicy')];
  if (id === 'composition-test-callees') return [summary('resolveDeliveryPolicy')];
  return [];
}

function affectedFor(query, treatment) {
  if (query.id === 'current-resolver-impact') return [summary('resolveDeliveryPolicy'), summary(SHARED_TEST, 'file')];
  if (query.id === 'fixed-oracle-impact') return [summary(ORACLE, 'file'), ...(treatment ? [] : [summary(SHARED_TEST, 'file')])];
  if (query.id === 'current-shared-test-impact' || query.id === 'composition-impact') return [summary(SHARED_TEST, 'file')];
  const channel = ['email', 'sms', 'push'].find((value) => query.id.startsWith(value));
  if (channel) {
    const resolver = `resolve${channel[0].toUpperCase()}${channel.slice(1)}Policy`;
    const contract = `${channel}PolicyContract`;
    return query.id.includes('-test-')
      ? [summary(contract), summary(SURFACE_PATHS.get(contract), 'file')]
      : [summary(resolver), summary(SURFACE_PATHS.get(contract), 'file')];
  }
  return [];
}

function readyOutcome(query, treatment, fuzzy) {
  const base = { id: query.id, operation: query.operation, target: query.target, outcome: 'ready' };
  const options = fuzzy && query.id === 'email-resolver-query'
    ? { name: 'resolveEmailPolic', filePath: 'research/fixtures/delivery-policy-registry/src/email-polic.mjs' }
    : undefined;
  if (query.operation === 'query') return { ...base, data: [candidate(query.target, options)] };
  const resolution = [candidate(query.target)];
  if (query.operation === 'callers') {
    return { ...base, data: { symbol: query.target, callers: callersFor(query.id, treatment) }, resolution };
  }
  if (query.operation === 'callees') {
    return { ...base, data: { symbol: query.target, callees: calleesFor(query.id, treatment) }, resolution };
  }
  const affected = affectedFor(query, treatment);
  return {
    ...base,
    data: {
      symbol: query.target,
      depth: 2,
      nodeCount: affected.length,
      edgeCount: Math.max(0, affected.length - 1),
      affected,
    },
    resolution,
  };
}

function portable(querySet, treatment, fuzzy = false) {
  const outcomes = querySet.queries.map((query) => {
    if (query.operation === 'status') {
      return {
        id: query.id,
        operation: query.operation,
        outcome: 'ready',
        data: {
          initialized: true,
          version: '1.4.1',
          fileCount: treatment ? 12 : 3,
          nodeCount: treatment ? 96 : 24,
          edgeCount: treatment ? 180 : 42,
          backend: 'node-sqlite',
          journalMode: 'wal',
          nodesByKind: { file: treatment ? 12 : 3, function: treatment ? 18 : 4 },
          languages: ['javascript'],
          pendingChanges: { added: 0, modified: 0, removed: 0 },
          worktreeMismatch: null,
          index: {
            builtWithVersion: '1.4.1',
            builtWithExtractionVersion: 24,
            currentExtractionVersion: 24,
            reindexRecommended: false,
            engineBehindIndexFiles: 0,
            state: 'complete',
            pendingRefs: 0,
          },
        },
      };
    }
    if (query.operation === 'affected') {
      const targets = query.targets.map((target) => {
        const present = treatment || CONTROL_PATHS.has(target);
        const affectedTests = present
          ? [target.startsWith('test/') ? target : SHARED_TEST]
          : [];
        return {
          target,
          outcome: affectedTests.length === 0 ? 'empty' : 'ready',
          data: { changedFiles: [target], affectedTests, totalDependentsTraversed: affectedTests.length },
        };
      });
      return {
        id: query.id,
        operation: query.operation,
        outcome: targets.every(({ outcome }) => outcome === 'ready') ? 'ready' : 'unresolved',
        targets,
      };
    }
    if (!treatment && PROPOSED_QUERY.test(query.id)) {
      return {
        id: query.id,
        operation: query.operation,
        target: query.target,
        outcome: 'symbol_absent',
        ...(query.operation === 'query' ? { data: [] } : {}),
      };
    }
    return readyOutcome(query, treatment, fuzzy);
  });
  const per_query = outcomes.map((outcome) => ({ id: outcome.id, operation: outcome.operation, outcome: outcome.outcome, result_digest: digestArtifact(outcome) }));
  const preimage = { projection: 'lattice.sensor_portable_outcome.v1', query_set_digest: digestArtifact(querySet), outcomes };
  return { schema: 'lattice.sensor_portable_preimage.v1', ...preimage, per_query, aggregate_digest: digestArtifact(preimage) };
}

function collectQueryReferences(value, references = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) collectQueryReferences(entry, references);
    return references;
  }
  if (value === null || typeof value !== 'object') return references;
  for (const [key, entry] of Object.entries(value)) {
    if ((key === 'query_id' || key === 'impact_id' || key.endsWith('_query_id')) && typeof entry === 'string') {
      references.add(entry);
    }
    collectQueryReferences(entry, references);
  }
  return references;
}

async function invoke({ treatment = false, manual = 'manual-evidence.normal.json', capacity, mutate } = {}) {
  const { compileDeliveryPolicyBoundaryBundleV2 } = await import(FRONT_END);
  const [planInput, candidateSpec, manualEvidence, querySet] = await Promise.all(['plan-input.json', 'candidate-spec-v1.json', manual, 'query-set-v2.json'].map(readInput));
  if (capacity) planInput.capacity.writers = capacity;
  const args = { planInput, candidateSpec, manualEvidence, querySet, sourceSnapshot: snapshot(treatment), sensorEvidence: portable(querySet, treatment) };
  mutate?.(args);
  return { bundle: compileDeliveryPolicyBoundaryBundleV2(args), args };
}

test('front-end returns a validated bundle only', async () => {
  const { bundle, args } = await invoke();
  assert.equal(validateNormalizedBoundaryBundleV2(bundle), true);
  assert.equal(bundle.source.snapshot_digest, digestArtifact(args.sourceSnapshot));
  assert.equal(bundle.source.candidate_witness_digest, digestArtifact(args.candidateSpec));
  assert.equal(bundle.source.query_set_digest, digestArtifact(args.querySet));
  assert.equal(bundle.source.manual_evidence_digest, digestArtifact(args.manualEvidence));
  assert.equal(Object.hasOwn(bundle, 'plan'), false);
  assert.equal(Object.hasOwn(bundle, 'verdict'), false);
});

test('control is four resources, twelve records, three pairs, and three waves', async () => {
  const { bundle } = await invoke(); const compiled = compileSchedulabilityGraphV2(bundle.graph);
  assert.equal(bundle.resources.length, 4); assert.equal(bundle.graph.conflicts.length, 12);
  assert.equal(new Set(bundle.graph.conflicts.map(({ todo_ids }) => todo_ids.join(':'))).size, 3);
  assert.equal(compiled.plan.minimum_feasible_waves, 3);
});
test('treatment is twelve disjoint resources and one wave', async () => { const { bundle } = await invoke({ treatment: true }); assert.equal(bundle.resources.length, 12); assert.equal(bundle.graph.conflicts.length, 0); assert.equal(compileSchedulabilityGraphV2(bundle.graph).plan.minimum_feasible_waves, 1); });
test('partial-state treatment is thirteen resources with one state conflict and two waves', async () => { const { bundle } = await invoke({ treatment: true, manual: 'manual-evidence.partial-state-negative.json' }); assert.equal(bundle.resources.length, 13); assert.equal(bundle.graph.conflicts.length, 1); assert.equal(compileSchedulabilityGraphV2(bundle.graph).plan.minimum_feasible_waves, 2); });
test('capacity-two treatment requires two waves', async () => { const { bundle } = await invoke({ treatment: true, capacity: 2 }); assert.equal(compileSchedulabilityGraphV2(bundle.graph).plan.minimum_feasible_waves, 2); });
test('third-only unknown is non-dispatchable without a plan', async () => { const { bundle } = await invoke({ treatment: true, manual: 'manual-evidence.third-only-unknown.json' }); const result = compileSchedulabilityGraphV2(bundle.graph); assert.equal(result.outcome, 'unknown'); assert.equal(result.code, 'BOUNDARY_UNKNOWN'); assert.equal(Object.hasOwn(result, 'plan'), false); });

test('candidate query references are exact and exhaustive', async () => {
  await import(FRONT_END);
  const [candidateSpec, querySet] = await Promise.all(['candidate-spec-v1.json', 'query-set-v2.json'].map(readInput));
  assert.deepEqual(
    [...collectQueryReferences(candidateSpec)].sort(),
    querySet.queries.map(({ id }) => id).sort(),
  );
});

for (const [name, mutate] of [
  ['candidate oracle digest', ({ candidateSpec }) => { candidateSpec.fixed_oracle.source_digest = '0'.repeat(64); }],
  ['query-set binding', ({ querySet }) => { querySet.queries.pop(); }],
  ['manual TODO set', ({ manualEvidence }) => { manualEvidence.evidence[2].todo_id = 'wrong'; }],
  ['portable per-query digest', ({ sensorEvidence }) => { sensorEvidence.per_query[0].result_digest = '0'.repeat(64); }],
  ['sourceSnapshot oracle digest', ({ sourceSnapshot }) => { sourceSnapshot.files.find((file) => file.path === ORACLE).content_digest = '0'.repeat(64); }],
  ['fuzzy exact-name mismatch', ({ sensorEvidence, querySet }) => { Object.assign(sensorEvidence, portable(querySet, true, true)); }],
]) test(`front-end rejects isolated ${name} corruption`, async () => {
  await import(FRONT_END);
  await assert.rejects(() => invoke({ treatment: true, mutate }), /front-end|candidate|query|manual|portable|snapshot|exact/i);
});

test('artifacts contain no condition, mode, conflict, or expected-wave injection fields', async () => {
  await import(FRONT_END);
  for (const name of ['plan-input.json', 'candidate-spec-v1.json', 'query-set-v2.json', 'manual-evidence.normal.json', 'manual-evidence.partial-state-negative.json', 'manual-evidence.third-only-unknown.json']) {
    assert.doesNotMatch(JSON.stringify(await readInput(name)), /"(?:condition|mode|conflicts|expected_waves)"/);
  }
});
