import { canonicalizeArtifact } from './artifact-contracts.mjs';
import {
  RUN_EVENT_KINDS,
  validateRunEvent,
} from './runtime-contracts.mjs';
import { digestWithoutField, verifyLinearHashChain } from './hash-chain.mjs';

// RC3 event store契約（ADR 0044 Decision 3）。
// event storeはrun単位のappend-only canonical event列であり、`sequence`は0起点の
// 連番、`previous_digest`は直前eventの`event_digest`（先頭はnull）とするdigest chainを
// 持つ。gap、重複、fork、digest不一致、未知kind、redaction違反をtyped rejectする。
// runtime stateは保存prefixからのprojection（runtime-projection.mjs）としてのみ再構成する。

export { RUN_EVENT_KINDS };

// ADR 0044 Decision 3.5 redaction契約: credential、token、cookie、prompt全文、
// 無関係な会話をevent payloadへ保存しない。key名はcase-insensitiveの語幹部分一致
// （`authToken`等のalias迂回を塞ぐ）、valueは既知のsecret形式patternで検出する。
// これは防波堤であって秘匿性の証明ではない。拡張はrun_event.v2＋新ADRで行う。
export const REDACTION_FORBIDDEN_PAYLOAD_KEYS = Object.freeze([
  'api_key',
  'apikey',
  'authorization',
  'bearer',
  'chat_log',
  'conversation',
  'cookie',
  'credential',
  'oauth',
  'passphrase',
  'password',
  'private_key',
  'prompt',
  'secret',
  'token',
]);

const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  /^bearer\s+\S+/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /^eyJ[0-9A-Za-z_-]{10,}\./u,
]);

function forbiddenKey(key) {
  const lowered = key.toLowerCase();
  return REDACTION_FORBIDDEN_PAYLOAD_KEYS.some((stem) => lowered.includes(stem));
}

function forbiddenValue(value) {
  return typeof value === 'string'
    && FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/** eventの正規byte列（sorted key・LF・UTF-8のcanonical JSON）を返す。 */
export function canonicalizeRunEvent(event) {
  return canonicalizeArtifact(event);
}

/**
 * event自己digest: `event_digest`自身を除いた残り全fieldのcanonical JSON SHA-256。
 * chain構築側は`event_digest`未設定のeventを渡してよい。
 */
export function digestRunEvent(event) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('run event契約違反: eventはplain objectでなければならない');
  }
  return digestWithoutField(event, 'event_digest', canonicalizeArtifact);
}

/**
 * payload treeから禁止key（語幹部分一致）と禁止value patternを検出する。
 * violationは`{ pointer, key }`で返し、空配列だけをredaction contract充足とみなす。
 */
export function findRedactionViolations(payload, pointer = '') {
  const violations = [];
  if (Array.isArray(payload)) {
    payload.forEach((entry, index) => {
      violations.push(...findRedactionViolations(entry, `${pointer}/${index}`));
    });
    return violations;
  }
  if (payload === null || typeof payload !== 'object') {
    if (forbiddenValue(payload)) {
      violations.push({ pointer, key: null });
    }
    return violations;
  }
  for (const [key, value] of Object.entries(payload)) {
    const childPointer = `${pointer}/${key}`;
    if (forbiddenKey(key)) {
      violations.push({ pointer: childPointer, key });
    }
    violations.push(...findRedactionViolations(value, childPointer));
  }
  return violations;
}

function check(id, passed) {
  return { id, passed };
}

/**
 * 保存bytesだけからevent chainを検査する。summary boolean・in-memory stateを
 * 証拠にしない（ADR 0044 Decision 3.3）。
 * @returns {{ schema: string, valid: boolean, checks: Array<{id: string, passed: boolean}>,
 *   failed_conditions: string[] }}
 */
export function verifyRunEventChain(options = {}) {
  const checks = [];
  let events = null;
  let inputOk = false;
  try {
    inputOk = options !== null
      && typeof options === 'object'
      && !Array.isArray(options)
      && Object.keys(options).length === 1
      && Array.isArray(options.events)
      && options.events.length > 0;
    if (inputOk) {
      events = options.events;
      canonicalizeArtifact(events);
    }
  } catch {
    inputOk = false;
  }
  checks.push(check('input_shape', inputOk));

  const shapeOk = inputOk && events.every((event) => {
    // kind・digest・chainは専用conditionで区別するため、shape検査から除いて判定する。
    if (event === null || typeof event !== 'object' || Array.isArray(event)) return false;
    const probe = {
      ...event,
      kind: RUN_EVENT_KINDS[0],
      sequence: 0,
      previous_digest: null,
    };
    probe.event_digest = digestWithoutField(probe, 'event_digest', canonicalizeArtifact);
    return validateRunEvent(probe);
  });
  checks.push(check('event_shape', shapeOk));

  const runIdentityOk = shapeOk && new Set(events.map((event) => event.run_id)).size === 1;
  checks.push(check('run_identity', runIdentityOk));

  const knownKindOk = shapeOk && events.every((event) => RUN_EVENT_KINDS.includes(event.kind));
  checks.push(check('unknown_kind', knownKindOk));

  const sharedFailures = shapeOk ? verifyLinearHashChain({
    entries: events,
    canonicalize: canonicalizeArtifact,
    digestField: 'event_digest',
  }) : new Set();
  const eventDigestOk = shapeOk && !sharedFailures.has('event_digest_mismatch');
  checks.push(check('event_digest_mismatch', eventDigestOk));

  const redactionOk = shapeOk && events.every((event) => (
    findRedactionViolations(event.payload).length === 0
  ));
  checks.push(check('payload_redaction', redactionOk));

  const storageOrderOk = shapeOk && !sharedFailures.has('storage_order');
  checks.push(check('storage_order', storageOrderOk));

  let duplicateOk = shapeOk;
  let forkOk = shapeOk;
  let gapOk = shapeOk;
  let genesisOk = shapeOk;
  let chainOk = shapeOk;
  if (shapeOk) {
    duplicateOk = !sharedFailures.has('duplicate_event');
    forkOk = !sharedFailures.has('sequence_fork');
    gapOk = !sharedFailures.has('sequence_gap');
    genesisOk = !sharedFailures.has('genesis_binding');
    chainOk = !sharedFailures.has('digest_chain_mismatch');
  }
  checks.push(check('duplicate_event', duplicateOk));
  checks.push(check('sequence_fork', forkOk));
  checks.push(check('sequence_gap', gapOk));
  checks.push(check('genesis_binding', genesisOk));
  checks.push(check('digest_chain_mismatch', chainOk));

  const failedConditions = checks.filter(({ passed }) => !passed).map(({ id }) => id);
  return {
    schema: 'lattice.runtime_event_chain_verification.v1',
    valid: failedConditions.length === 0,
    checks,
    failed_conditions: failedConditions,
  };
}
