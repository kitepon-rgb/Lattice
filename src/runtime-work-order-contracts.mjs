import path from 'node:path';

import { selfDigest } from './runtime-contracts.mjs';

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_SHA1 = /^[0-9a-f]{40}$/u;
const ID = /^[0-9A-Za-z](?:[0-9A-Za-z._-]{0,127})$/u;
const MAX_ITEMS = 256;

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, fields) {
  if (!plain(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function safeWritePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === path.posix.normalize(value)
    && !path.posix.isAbsolute(value)
    && value !== '..'
    && !value.startsWith('../')
    && !value.includes('\\0')
    && !['.git', '.lattice'].includes(value.split('/')[0]);
}

function stringArray(value, { min = 0, paths = false } = {}) {
  return Array.isArray(value)
    && value.length >= min
    && value.length <= MAX_ITEMS
    && value.every((entry) => paths ? safeWritePath(entry) : typeof entry === 'string');
}

export function validateRunWorkOrder(value) {
  return exact(value, [
    'schema',
    'todo_id',
    'worktree_path',
    'base_sha',
    'scope_writes',
    'verifier_refs',
    'forbidden_operations',
    'packet_digest',
    'order_digest',
  ])
    && value.schema === 'lattice.run_work_order.v1'
    && ID.test(value.todo_id ?? '')
    && typeof value.worktree_path === 'string'
    && path.isAbsolute(value.worktree_path)
    && GIT_SHA1.test(value.base_sha ?? '')
    && stringArray(value.scope_writes, { paths: true })
    && stringArray(value.verifier_refs)
    && stringArray(value.forbidden_operations)
    && SHA256.test(value.packet_digest ?? '')
    && SHA256.test(value.order_digest ?? '')
    && selfDigest(value, 'order_digest') === value.order_digest;
}

export function createRunWorkOrder({ packet, worktreePath } = {}) {
  const value = {
    schema: 'lattice.run_work_order.v1',
    todo_id: packet?.todo_id,
    worktree_path: worktreePath,
    base_sha: packet?.base_sha,
    scope_writes: Array.isArray(packet?.scope?.writes) ? [...packet.scope.writes] : null,
    verifier_refs: Array.isArray(packet?.verifier_refs) ? [...packet.verifier_refs] : null,
    forbidden_operations: Array.isArray(packet?.forbidden_operations)
      ? [...packet.forbidden_operations] : null,
    packet_digest: packet?.packet_digest,
    order_digest: '',
  };
  value.order_digest = selfDigest(value, 'order_digest');
  if (!validateRunWorkOrder(value)) throw new TypeError('INVALID_RUN_WORK_ORDER');
  return value;
}

export function validateRunWorkReport(value) {
  return exact(value, ['schema', 'packet_digest', 'state', 'worker_pid'])
    && value.schema === 'lattice.run_work_report.v1'
    && SHA256.test(value.packet_digest ?? '')
    && ['working', 'done'].includes(value.state)
    && Number.isSafeInteger(value.worker_pid)
    && value.worker_pid > 0;
}
