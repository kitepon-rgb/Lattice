import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { explainRunRequest } from '../src/runtime-contracts.mjs';
import { todoSelfDigest } from '../src/todo-contracts.mjs';

// `lattice run request synthesize`はwitness setからrun requestを組むread-only surface。
// **推測しない**ことが契約なので、base shaとrequest idを渡さない形は受理しない。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'bin', 'lattice.mjs');
const BASE_SHA = 'a'.repeat(40);

function witnessSet(overrides = {}) {
  const value = {
    schema: 'lattice.todo_witness_set.v5',
    project_id: 'lattice',
    plan_key: 'probe-plan',
    capacity: { executors: 2 },
    sensor_query_set: { queries: [{ id: 'q-status', operation: 'status' }] },
    manual_witness: {
      t1: {
        owns: [{ kind: 'path', target: 'src/a.mjs' }],
        reads: [],
        writes: ['src/a.mjs'],
        resources: [],
        state_effects: [],
        sensor_provenance: { queries: [] },
        affected_tests: [],
        unknowns: [],
      },
    },
    witness_set_digest: '0'.repeat(64),
    ...overrides,
  };
  value.witness_set_digest = todoSelfDigest(value, 'witness_set_digest');
  return value;
}

function runCli(argv, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...argv], { cwd, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function withWitness(value, body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'synthesize-'));
  try {
    writeFileSync(path.join(dir, 'witness.json'), `${JSON.stringify(value)}\n`);
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('witness setからrun requestを組んで返す', () => {
  withWitness(witnessSet(), (dir) => {
    const result = runCli(
      ['run', 'request', 'synthesize', '--witness', 'witness.json', '--base-sha', BASE_SHA, '--id', 'req-probe'],
      dir,
    );
    assert.equal(result.code, 0, result.stderr);
    const request = JSON.parse(result.stdout);
    assert.equal(request.schema, 'lattice.run_request.v5');
    assert.equal(request.request_id, 'req-probe');
    assert.equal(request.repo.base_sha, BASE_SHA);
    assert.deepEqual(request.todos, [{ todo_id: 't1' }]);
    // 出したものがそのまま`run start`の入力契約を満たすこと（CLIの自己申告に頼らない）
    assert.equal(explainRunRequest(request).valid, true);
    assert.equal(result.stderr, '');
  });
});

test('lines宣言はrun requestまで写る', () => {
  const value = witnessSet();
  value.manual_witness.t1.lines = [{
    line_id: 'src.a.mjs--wire-shape',
    role: 'writes',
    anchors: [{ kind: 'path', path: 'src/a.mjs' }],
  }];
  value.witness_set_digest = todoSelfDigest(value, 'witness_set_digest');
  withWitness(value, (dir) => {
    const result = runCli(
      ['run', 'request', 'synthesize', '--witness', 'witness.json', '--base-sha', BASE_SHA, '--id', 'req-lines'],
      dir,
    );
    assert.equal(result.code, 0, result.stderr);
    const request = JSON.parse(result.stdout);
    assert.deepEqual(request.manual_witness.t1.lines, value.manual_witness.t1.lines);
  });
});

test('witness setが契約を満たさなければ理由とpointerつきで拒否する', () => {
  const broken = witnessSet();
  broken.manual_witness.t1.writes = ['../escape'];
  withWitness(broken, (dir) => {
    const result = runCli(
      ['run', 'request', 'synthesize', '--witness', 'witness.json', '--base-sha', BASE_SHA, '--id', 'req-broken'],
      dir,
    );
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    const error = JSON.parse(result.stderr);
    assert.equal(error.schema, 'lattice.cli_error.v2');
    assert.equal(error.code, 'WITNESS_SET_INVALID');
    assert.equal(typeof error.detail.reason, 'string');
  });
});

test('base shaを推測しない（40桁でなければ拒否）', () => {
  withWitness(witnessSet(), (dir) => {
    const result = runCli(
      ['run', 'request', 'synthesize', '--witness', 'witness.json', '--base-sha', 'HEAD', '--id', 'req-head'],
      dir,
    );
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'INVALID_BASE_SHA');
  });
});

test('request idは識別子でなければ拒否する', () => {
  withWitness(witnessSet(), (dir) => {
    const result = runCli(
      ['run', 'request', 'synthesize', '--witness', 'witness.json', '--base-sha', BASE_SHA, '--id', 'bad id'],
      dir,
    );
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'INVALID_REQUEST_ID');
  });
});

test('引数の欠落・順序違い・余剰はusage違反で拒否する', () => {
  withWitness(witnessSet(), (dir) => {
    const rejected = [
      ['run', 'request', 'synthesize'],
      ['run', 'request', 'synthesize', '--witness', 'witness.json'],
      ['run', 'request', 'synthesize', '--witness', 'witness.json', '--base-sha', BASE_SHA],
      ['run', 'request', 'synthesize', '--base-sha', BASE_SHA, '--witness', 'witness.json', '--id', 'req-x'],
      ['run', 'request', 'synthesize', '--witness', 'witness.json', '--base-sha', BASE_SHA, '--id', 'req-x', 'extra'],
    ];
    for (const argv of rejected) {
      const result = runCli(argv, dir);
      assert.equal(result.code, 2, `usage違反にならなかった: ${argv.join(' ')}`);
      assert.equal(result.stdout, '');
    }
  });
});

// `--request-id`はrun mutationのidempotency keyとして末尾2引数で横取りされる予約語である。
// 同じ綴りをsynthesizeのrequest id指定へ流用すると、正しく書いたつもりの人が
// `INVALID_REQUEST_ID`で弾かれる。だから旗は`--id`にしてある——この振る舞いを固定する。
test('末尾の--request-idは予約語として拒否され続ける', () => {
  withWitness(witnessSet(), (dir) => {
    const result = runCli(
      ['run', 'request', 'synthesize', '--witness', 'witness.json', '--base-sha', BASE_SHA, '--request-id', 'req-x'],
      dir,
    );
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'INVALID_REQUEST_ID');
  });
});
