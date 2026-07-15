import assert from 'node:assert/strict';
import test from 'node:test';

import { collectCodegraphEvidence } from '../src/codegraph-adapter.mjs';

const READY_STATUS = JSON.stringify({
  initialized: true,
  version: '1.4.1',
  pendingChanges: { added: 0, modified: 0, removed: 0 },
  worktreeMismatch: null,
  index: {
    builtWithVersion: '1.4.1',
    builtWithExtractionVersion: 7,
    currentExtractionVersion: 7,
    reindexRecommended: false,
    state: 'complete',
    pendingRefs: 0,
  },
});

function fakeExecutor(responses) {
  return async ({ operation, target }) => {
    const response = responses[`${operation}:${target ?? ''}`] ?? responses[operation];
    assert.ok(response, `missing fake response for ${operation}:${target ?? ''}`);
    return response;
  };
}

test('collects query operations in input order with typed ready outcomes', async () => {
  const evidence = await collectCodegraphEvidence({
    cwd: '/repo',
    querySet: {
      queries: [
        { id: 'status', operation: 'status' },
        { id: 'query', operation: 'query', target: 'buildDispatchRecord' },
        { id: 'affected', operation: 'affected', targets: ['fixture.mjs', 'test.mjs'] },
      ],
    },
    execute: fakeExecutor({
      status: { code: 0, stdout: READY_STATUS, stderr: '' },
      'query:buildDispatchRecord': {
        code: 0,
        stdout: '[{"node":{"name":"buildDispatchRecord","qualifiedName":"buildDispatchRecord"}}]',
        stderr: '',
      },
      'affected:fixture.mjs': { code: 0, stdout: '{"affectedTests":["test.mjs"]}', stderr: '' },
      'affected:test.mjs': { code: 0, stdout: '{"affectedTests":["test.mjs"]}', stderr: '' },
    }),
  });

  assert.equal(evidence.cwd, '/repo');
  assert.deepEqual(evidence.outcomes.map(({ id }) => id), ['status', 'query', 'affected']);
  assert.deepEqual(evidence.outcomes.map(({ outcome }) => outcome), ['ready', 'ready', 'ready']);
  assert.deepEqual(evidence.outcomes[2].targets.map(({ target }) => target), ['fixture.mjs', 'test.mjs']);
});

test('keeps query and affected empty results typed rather than independent', async () => {
  const evidence = await collectCodegraphEvidence({
    cwd: '/repo',
    querySet: {
      queries: [
        { id: 'query', operation: 'query', target: 'missingSymbol' },
        { id: 'affected', operation: 'affected', targets: ['missing.mjs'] },
      ],
    },
    execute: fakeExecutor({
      'query:missingSymbol': { code: 0, stdout: '[]', stderr: '' },
      'affected:missing.mjs': { code: 0, stdout: '{"affectedTests":[]}', stderr: '' },
    }),
  });

  assert.equal(evidence.outcomes[0].outcome, 'symbol_absent');
  assert.equal(evidence.outcomes[1].outcome, 'empty');
  assert.equal(evidence.outcomes[1].targets[0].outcome, 'empty');
});

test('does not promote fuzzy query and traversal matches to exact symbol presence', async () => {
  const fuzzyQuery = JSON.stringify([{
    node: {
      name: 'SEAM_BY_CONCERN',
      qualifiedName: 'SEAM_BY_CONCERN',
      signature: "{ symbol: 'selectDispatchChannel' }",
    },
  }]);
  const evidence = await collectCodegraphEvidence({
    cwd: '/repo',
    querySet: {
      queries: [
        { id: 'query', operation: 'query', target: 'selectDispatchChannel' },
        { id: 'impact', operation: 'impact', target: 'selectDispatchChannel' },
      ],
    },
    execute: fakeExecutor({
      'query:selectDispatchChannel': { code: 0, stdout: fuzzyQuery, stderr: '' },
      'impact:selectDispatchChannel': {
        code: 0,
        stdout: JSON.stringify({
          symbol: 'selectDispatchChannel',
          affected: [{ name: 'SEAM_BY_CONCERN', kind: 'constant' }],
        }),
        stderr: '',
      },
    }),
  });

  assert.deepEqual(evidence.outcomes.map(({ outcome }) => outcome), [
    'symbol_absent',
    'symbol_absent',
  ]);
});

test('accepts traversal JSON only after an exact query identity resolves', async () => {
  const evidence = await collectCodegraphEvidence({
    cwd: '/repo',
    querySet: {
      queries: [{ id: 'callers', operation: 'callers', target: 'buildDispatchRecord' }],
    },
    execute: fakeExecutor({
      'query:buildDispatchRecord': {
        code: 0,
        stdout: JSON.stringify([{
          node: {
            name: 'buildDispatchRecord',
            qualifiedName: 'buildDispatchRecord',
          },
        }]),
        stderr: '',
      },
      'callers:buildDispatchRecord': {
        code: 0,
        stdout: JSON.stringify({
          symbol: 'buildDispatchRecord',
          callers: [{ name: 'fixture.test.mjs', kind: 'file' }],
        }),
        stderr: '',
      },
    }),
  });

  assert.equal(evidence.outcomes[0].outcome, 'ready');
  assert.equal(evidence.outcomes[0].resolution[0].node.name, 'buildDispatchRecord');
});

test('accepts only the observed ANSI info-prefixed Symbol not found output', async () => {
  const evidence = await collectCodegraphEvidence({
    cwd: '/repo',
    querySet: { queries: [{ id: 'impact', operation: 'impact', target: 'selectDispatchChannel' }] },
    execute: fakeExecutor({
      'impact:selectDispatchChannel': {
        code: 0,
        stdout: '\u001B[34mℹ\u001B[0m Symbol "selectDispatchChannel" not found\n',
        stderr: '',
      },
    }),
  });

  assert.equal(evidence.outcomes[0].outcome, 'symbol_absent');
});

test('rejects approximate non-JSON Symbol not found messages', async () => {
  const evidence = await collectCodegraphEvidence({
    cwd: '/repo',
    querySet: { queries: [{ id: 'impact', operation: 'impact', target: 'selectDispatchChannel' }] },
    execute: fakeExecutor({
      'impact:selectDispatchChannel': {
        code: 0,
        stdout: '\u001B[34mnotice\u001B[0m Symbol "selectDispatchChannel" not found later\n',
        stderr: '',
      },
    }),
  });

  assert.equal(evidence.outcomes[0].outcome, 'invalid_json');
});

test('fails loud for arbitrary non-JSON and nonzero command results', async () => {
  const evidence = await collectCodegraphEvidence({
    cwd: '/repo',
    querySet: {
      queries: [
        { id: 'invalid', operation: 'impact', target: 'knownSymbol' },
        { id: 'failed', operation: 'callees', target: 'knownSymbol' },
      ],
    },
    execute: fakeExecutor({
      'impact:knownSymbol': { code: 0, stdout: 'not JSON', stderr: '' },
      'callees:knownSymbol': { code: 2, stdout: '', stderr: 'boom' },
    }),
  });

  assert.equal(evidence.outcomes[0].outcome, 'invalid_json');
  assert.equal(evidence.outcomes[1].outcome, 'command_failure');
});

test('fails loud for stale, unresolved, and unsupported status', async () => {
  const cases = [
    ['stale', {
      ...JSON.parse(READY_STATUS),
      pendingChanges: { added: 1, modified: 0, removed: 0 },
    }],
    ['stale', { ...JSON.parse(READY_STATUS), worktreeMismatch: { expected: 'a', actual: 'b' } }],
    ['stale', {
      ...JSON.parse(READY_STATUS),
      index: { ...JSON.parse(READY_STATUS).index, reindexRecommended: true },
    }],
    ['unresolved', {
      ...JSON.parse(READY_STATUS),
      pendingChanges: { added: -1, modified: 0, removed: 0 },
    }],
    ['unresolved', {
      ...JSON.parse(READY_STATUS),
      index: { ...JSON.parse(READY_STATUS).index, state: 'indexing' },
    }],
    ['unresolved', { ...JSON.parse(READY_STATUS), worktreeMismatch: false }],
    ['unsupported', { ...JSON.parse(READY_STATUS), version: null }],
  ];

  for (const [expected, status] of cases) {
    const evidence = await collectCodegraphEvidence({
      cwd: '/repo',
      querySet: { queries: [{ id: 'status', operation: 'status' }] },
      execute: fakeExecutor({ status: { code: 0, stdout: JSON.stringify(status), stderr: '' } }),
    });

    assert.equal(evidence.outcomes[0].outcome, expected);
  }
});
