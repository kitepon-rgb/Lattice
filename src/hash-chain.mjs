import { createHash } from 'node:crypto';

/** Hash bytes without imposing an artifact schema or serialization limit. */
export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Compute a self digest using the caller's canonical serializer. */
export function digestWithoutField(value, digestField, canonicalize) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('chain value must be a plain object');
  }
  const projection = {};
  for (const key of Object.keys(value)) {
    if (key !== digestField) projection[key] = value[key];
  }
  return sha256Bytes(Buffer.from(canonicalize(projection), 'utf8'));
}

/**
 * Verify the storage order, sequence, genesis, self digest and previous link of
 * a linear hash chain. Domain validators remain with each store family.
 */
export function verifyLinearHashChain({
  entries,
  canonicalize,
  digestField,
  sequenceField = 'sequence',
  previousField = 'previous_digest',
  genesisPrevious = null,
}) {
  const failures = new Set();
  const bySequence = new Map();
  for (const entry of entries) {
    const sequence = entry?.[sequenceField];
    let bytes;
    try {
      bytes = canonicalize(entry);
      if (entry[digestField] !== digestWithoutField(entry, digestField, canonicalize)) {
        failures.add('event_digest_mismatch');
      }
    } catch {
      failures.add('event_shape');
      continue;
    }
    const seen = bySequence.get(sequence);
    if (seen === undefined) bySequence.set(sequence, { entries: [entry], bytes: new Set([bytes]) });
    else {
      seen.entries.push(entry);
      seen.bytes.add(bytes);
    }
  }
  for (const seen of bySequence.values()) {
    if (seen.entries.length > 1 && seen.bytes.size === 1) failures.add('duplicate_event');
    if (seen.bytes.size > 1) failures.add('sequence_fork');
  }
  if (!entries.every((entry, index) => index === 0
    || entries[index - 1]?.[sequenceField] < entry?.[sequenceField])) {
    failures.add('storage_order');
  }
  const sequences = [...bySequence.keys()].sort((left, right) => left - right);
  if (sequences.length === 0 || sequences.some((sequence, index) => sequence !== index)) {
    failures.add('sequence_gap');
  }
  const genesis = bySequence.get(0)?.entries[0];
  if (genesis === undefined || genesis[previousField] !== genesisPrevious
    || entries.some((entry) => (entry[sequenceField] === 0) !== (entry[previousField] === genesisPrevious))) {
    failures.add('genesis_binding');
  }
  for (let index = 1; index < sequences.length; index += 1) {
    const previous = bySequence.get(sequences[index - 1]).entries[0];
    const current = bySequence.get(sequences[index]).entries[0];
    if (current[previousField] !== previous[digestField]) failures.add('digest_chain_mismatch');
  }
  return failures;
}
