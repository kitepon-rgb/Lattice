const INPUT_KEYS = ['priority', 'recipient', 'title'];

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactInputKeys(value) {
  if (!isPlainObject(value)) {
    return false;
  }

  const actual = Object.keys(value).sort();
  return actual.length === INPUT_KEYS.length
    && actual.every((key, index) => key === INPUT_KEYS[index]);
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function buildDispatchRecord(input) {
  if (!hasExactInputKeys(input)) {
    throw new TypeError(
      'dispatch input must be a plain object with exact keys: priority, recipient, title',
    );
  }

  if (input.priority !== 'urgent' && input.priority !== 'routine') {
    throw new TypeError('priority must be urgent or routine');
  }

  const recipient = nonEmptyString(input.recipient, 'recipient');
  const title = nonEmptyString(input.title, 'title');
  const channel = input.priority === 'urgent' ? 'pager' : 'queue';
  const label = `${recipient}:${title}`;

  return Object.freeze({ channel, label });
}
